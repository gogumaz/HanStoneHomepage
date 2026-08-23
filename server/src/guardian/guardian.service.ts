import { HttpStatus, Injectable } from "@nestjs/common";
import { ApiError } from "../common/api-error.js";
import { loadAppConfig, type AppConfig } from "../config/app-config.js";
import { PrismaService } from "../database/prisma.service.js";
import {
  ConsentStatus,
  GuardianLinkStatus,
  InvitationStatus,
  LessonStatus,
} from "../generated/prisma/enums.js";
import type { CurrentUser } from "../auth/auth.types.js";
import {
  GUARDIAN_CONSENT_POLICY_VERSION,
  GUARDIAN_CONSENT_SCOPES,
  type GuardianInvitationView,
  type GuardianLinkView,
} from "./guardian.types.js";
import { generateInvitationToken, hashInvitationToken } from "./invitation-token.js";

function readEmail(body: unknown): string {
  const email = body && typeof body === "object" && "email" in body && typeof body.email === "string"
    ? body.email.trim().toLowerCase()
    : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new ApiError("INVALID_GUARDIAN_EMAIL", "초대할 보호자의 이메일을 확인해 주세요.", HttpStatus.BAD_REQUEST);
  }
  return email;
}

function validateConsent(body: unknown): void {
  if (!body || typeof body !== "object") {
    throw new ApiError("CONSENT_REQUIRED", "보호자 연결 동의가 필요합니다.", HttpStatus.BAD_REQUEST);
  }
  const value = body as Record<string, unknown>;
  const scopes = Array.isArray(value.scopes)
    ? value.scopes.filter((scope): scope is string => typeof scope === "string")
    : [];
  if (value.consent !== true) {
    throw new ApiError("CONSENT_REQUIRED", "보호자 연결 동의가 필요합니다.", HttpStatus.BAD_REQUEST);
  }
  if (value.policyVersion !== GUARDIAN_CONSENT_POLICY_VERSION) {
    throw new ApiError("CONSENT_VERSION_MISMATCH", "최신 보호자 동의 내용을 다시 확인해 주세요.", HttpStatus.CONFLICT);
  }
  if (!GUARDIAN_CONSENT_SCOPES.every((scope) => scopes.includes(scope))) {
    throw new ApiError("CONSENT_SCOPE_REQUIRED", "필수 학습정보 조회 범위에 동의해 주세요.", HttpStatus.BAD_REQUEST);
  }
}

function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"*".repeat(Math.max(2, local.length - visible.length))}@${domain}`;
}

@Injectable()
export class GuardianService {
  private readonly config: AppConfig;

  constructor(private readonly prisma: PrismaService) {
    this.config = loadAppConfig();
  }

  async createInvitation(
    student: CurrentUser,
    body: unknown,
    requestId?: string,
  ): Promise<{ invitation: GuardianInvitationView; developmentToken?: string }> {
    const inviteeEmail = readEmail(body);
    if (student.email?.toLowerCase() === inviteeEmail) {
      throw new ApiError("SELF_GUARDIAN_INVITATION", "본인 계정은 보호자로 초대할 수 없습니다.", HttpStatus.BAD_REQUEST);
    }

    const token = generateInvitationToken();
    const tokenHash = hashInvitationToken(token);
    const expiresAt = new Date(
      Date.now() + this.config.guardianInvitationTtlHours * 60 * 60 * 1000,
    );
    const invitation = await this.prisma.$transaction(async (transaction) => {
      await transaction.guardianInvitation.updateMany({
        where: {
          studentId: student.id,
          inviteeEmail,
          status: InvitationStatus.PENDING,
        },
        data: { status: InvitationStatus.REVOKED },
      });
      const created = await transaction.guardianInvitation.create({
        data: { studentId: student.id, inviteeEmail, tokenHash, expiresAt },
        include: { student: { select: { id: true, displayName: true } } },
      });
      await transaction.auditLog.create({
        data: {
          actorId: student.id,
          action: "guardian.invitation.created",
          resourceType: "GuardianInvitation",
          resourceId: created.id,
          requestId: requestId ?? null,
          metadata: { inviteeEmail },
        },
      });
      return created;
    });

    const result: { invitation: GuardianInvitationView; developmentToken?: string } = {
      invitation: this.toInvitationView(invitation),
    };
    if (this.config.nodeEnv !== "production") result.developmentToken = token;
    return result;
  }

  async getInvitation(token: string): Promise<GuardianInvitationView> {
    if (!/^[A-Za-z0-9_-]{32,100}$/.test(token)) {
      throw new ApiError("INVITATION_NOT_FOUND", "유효한 보호자 초대를 찾을 수 없습니다.", HttpStatus.NOT_FOUND);
    }
    const tokenHash = hashInvitationToken(token);
    const invitation = await this.prisma.guardianInvitation.findUnique({
      where: { tokenHash },
      include: { student: { select: { id: true, displayName: true } } },
    });
    if (!invitation) {
      throw new ApiError("INVITATION_NOT_FOUND", "유효한 보호자 초대를 찾을 수 없습니다.", HttpStatus.NOT_FOUND);
    }
    if (invitation.status === InvitationStatus.PENDING && invitation.expiresAt.getTime() <= Date.now()) {
      await this.prisma.guardianInvitation.updateMany({
        where: { id: invitation.id, status: InvitationStatus.PENDING },
        data: { status: InvitationStatus.EXPIRED },
      });
      throw new ApiError("INVITATION_EXPIRED", "보호자 초대가 만료되었습니다.", HttpStatus.GONE);
    }
    if (invitation.status !== InvitationStatus.PENDING) {
      throw new ApiError("INVITATION_UNAVAILABLE", "이미 사용했거나 취소된 보호자 초대입니다.", HttpStatus.CONFLICT);
    }
    return this.toInvitationView(invitation);
  }

  async acceptInvitation(
    token: string,
    guardian: CurrentUser,
    body: unknown,
    requestId?: string,
  ): Promise<{ link: GuardianLinkView }> {
    validateConsent(body);
    const invitation = await this.getInvitation(token);
    const stored = await this.prisma.guardianInvitation.findUnique({
      where: { tokenHash: hashInvitationToken(token) },
    });
    if (!stored) {
      throw new ApiError("INVITATION_NOT_FOUND", "유효한 보호자 초대를 찾을 수 없습니다.", HttpStatus.NOT_FOUND);
    }
    if (!guardian.email || guardian.email.toLowerCase() !== stored.inviteeEmail?.toLowerCase()) {
      throw new ApiError("INVITATION_EMAIL_MISMATCH", "초대받은 이메일의 보호자 계정으로 로그인해 주세요.", HttpStatus.FORBIDDEN);
    }
    if (invitation.student.id === guardian.id) {
      throw new ApiError("SELF_GUARDIAN_LINK", "본인 계정을 보호자로 연결할 수 없습니다.", HttpStatus.BAD_REQUEST);
    }

    const now = new Date();
    const link = await this.prisma.$transaction(async (transaction) => {
      const claimed = await transaction.guardianInvitation.updateMany({
        where: {
          id: stored.id,
          status: InvitationStatus.PENDING,
          expiresAt: { gt: now },
        },
        data: { status: InvitationStatus.ACCEPTED, acceptedAt: now },
      });
      if (claimed.count !== 1) {
        throw new ApiError("INVITATION_UNAVAILABLE", "이미 사용했거나 만료된 보호자 초대입니다.", HttpStatus.CONFLICT);
      }

      const activeLink = await transaction.guardianLink.upsert({
        where: {
          studentId_guardianId: {
            studentId: invitation.student.id,
            guardianId: guardian.id,
          },
        },
        create: {
          studentId: invitation.student.id,
          guardianId: guardian.id,
          status: GuardianLinkStatus.ACTIVE,
          consentVersion: GUARDIAN_CONSENT_POLICY_VERSION,
          consentedAt: now,
        },
        update: {
          status: GuardianLinkStatus.ACTIVE,
          consentVersion: GUARDIAN_CONSENT_POLICY_VERSION,
          consentedAt: now,
          revokedAt: null,
        },
        include: { student: { select: { id: true, displayName: true } } },
      });
      await transaction.guardianConsent.updateMany({
        where: { guardianLinkId: activeLink.id, status: ConsentStatus.ACTIVE },
        data: { status: ConsentStatus.WITHDRAWN, withdrawnAt: now },
      });
      await transaction.guardianConsent.create({
        data: {
          guardianLinkId: activeLink.id,
          studentId: invitation.student.id,
          guardianId: guardian.id,
          consentType: "guardian_learning_access",
          policyVersion: GUARDIAN_CONSENT_POLICY_VERSION,
          scope: [...GUARDIAN_CONSENT_SCOPES],
          verificationMethod: "authenticated_email",
          consentedAt: now,
          auditMetadata: { invitationId: stored.id, requestId: requestId ?? null },
        },
      });
      await transaction.auditLog.create({
        data: {
          actorId: guardian.id,
          action: "guardian.invitation.accepted",
          resourceType: "GuardianLink",
          resourceId: activeLink.id,
          requestId: requestId ?? null,
          metadata: { studentId: invitation.student.id, invitationId: stored.id },
        },
      });
      return activeLink;
    });

    return { link: this.toLinkView(link) };
  }

  async listStudents(guardian: CurrentUser): Promise<{ students: GuardianLinkView[] }> {
    const links = await this.prisma.guardianLink.findMany({
      where: { guardianId: guardian.id, status: GuardianLinkStatus.ACTIVE },
      include: { student: { select: { id: true, displayName: true } } },
      orderBy: { createdAt: "asc" },
    });
    return { students: links.map((link) => this.toLinkView(link)) };
  }

  async getStudentReport(guardian: CurrentUser, studentId: string, requestId?: string) {
    if (!studentId || studentId.length > 100) {
      throw new ApiError("GUARDIAN_REPORT_FORBIDDEN", "학생 학습정보를 조회할 권한이 없습니다.", HttpStatus.FORBIDDEN);
    }
    const link = await this.prisma.guardianLink.findFirst({
      where: {
        guardianId: guardian.id,
        studentId,
        status: GuardianLinkStatus.ACTIVE,
        consents: {
          some: {
            guardianId: guardian.id,
            studentId,
            status: ConsentStatus.ACTIVE,
            consentType: "guardian_learning_access",
            policyVersion: GUARDIAN_CONSENT_POLICY_VERSION,
            scope: { hasEvery: [...GUARDIAN_CONSENT_SCOPES] },
          },
        },
      },
      include: { student: { select: { id: true, displayName: true } } },
    });
    if (!link) {
      throw new ApiError(
        "GUARDIAN_REPORT_FORBIDDEN",
        "활성 보호자 연결과 학습정보 조회 동의를 확인해 주세요.",
        HttpStatus.FORBIDDEN,
      );
    }

    const lessons = await this.prisma.lesson.findMany({
      where: { status: LessonStatus.PUBLISHED },
      orderBy: [{ era: { order: "asc" } }, { order: "asc" }],
      include: {
        era: { select: { id: true, name: true } },
        _count: { select: { steps: true } },
        progress: {
          where: { userId: studentId },
          select: {
            status: true,
            startedAt: true,
            completedAt: true,
            updatedAt: true,
            lastPositionSeconds: true,
            _count: { select: { stepCompletions: true } },
          },
        },
      },
    });
    const items = lessons.map((lesson) => {
      const progress = lesson.progress[0] ?? null;
      return {
        lesson: {
          id: lesson.id,
          era: lesson.era,
          order: lesson.order,
          course: lesson.course,
          title: lesson.title,
          durationMinutes: lesson.durationMinutes,
        },
        progress: {
          status: progress?.status.toLowerCase() ?? "not_started",
          completedSteps: progress?._count.stepCompletions ?? 0,
          totalSteps: lesson._count.steps,
          lastPositionSeconds: progress?.lastPositionSeconds ?? 0,
          startedAt: progress?.startedAt ?? null,
          completedAt: progress?.completedAt ?? null,
          lastActivityAt: progress?.updatedAt ?? null,
        },
      };
    });
    const startedItems = items.filter((item) => item.progress.status !== "not_started");
    const completedItems = items.filter((item) => item.progress.status === "completed");
    const totalSteps = items.reduce((sum, item) => sum + item.progress.totalSteps, 0);
    const completedSteps = items.reduce((sum, item) => sum + item.progress.completedSteps, 0);
    const lastActivityAt = startedItems.reduce<Date | null>((latest, item) => {
      const current = item.progress.lastActivityAt;
      return current && (!latest || current > latest) ? current : latest;
    }, null);
    await this.prisma.auditLog.create({
      data: {
        actorId: guardian.id,
        action: "guardian.student_report.viewed",
        resourceType: "User",
        resourceId: studentId,
        requestId: requestId ?? null,
        metadata: { guardianLinkId: link.id },
      },
    });
    return {
      student: link.student,
      generatedAt: new Date(),
      summary: {
        totalLessons: items.length,
        startedLessons: startedItems.length,
        completedLessons: completedItems.length,
        completionRate: items.length ? Math.round((completedItems.length / items.length) * 100) : 0,
        completedSteps,
        totalSteps,
        stepCompletionRate: totalSteps ? Math.round((completedSteps / totalSteps) * 100) : 0,
        lastActivityAt,
      },
      items,
    };
  }

  async revokeLink(
    linkId: string,
    actor: CurrentUser,
    requestId?: string,
  ): Promise<{ link: GuardianLinkView }> {
    const link = await this.prisma.guardianLink.findUnique({
      where: { id: linkId },
      include: { student: { select: { id: true, displayName: true } } },
    });
    if (!link) {
      throw new ApiError("GUARDIAN_LINK_NOT_FOUND", "보호자 연결을 찾을 수 없습니다.", HttpStatus.NOT_FOUND);
    }
    if (link.studentId !== actor.id && link.guardianId !== actor.id) {
      throw new ApiError("GUARDIAN_LINK_FORBIDDEN", "이 보호자 연결을 해제할 권한이 없습니다.", HttpStatus.FORBIDDEN);
    }
    if (link.status === GuardianLinkStatus.REVOKED) {
      return { link: this.toLinkView(link) };
    }

    const now = new Date();
    const revoked = await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.guardianLink.update({
        where: { id: link.id },
        data: { status: GuardianLinkStatus.REVOKED, revokedAt: now },
        include: { student: { select: { id: true, displayName: true } } },
      });
      await transaction.guardianConsent.updateMany({
        where: { guardianLinkId: link.id, status: ConsentStatus.ACTIVE },
        data: { status: ConsentStatus.WITHDRAWN, withdrawnAt: now },
      });
      await transaction.auditLog.create({
        data: {
          actorId: actor.id,
          action: "guardian.link.revoked",
          resourceType: "GuardianLink",
          resourceId: link.id,
          requestId: requestId ?? null,
          metadata: { studentId: link.studentId, guardianId: link.guardianId },
        },
      });
      return updated;
    });
    return { link: this.toLinkView(revoked) };
  }

  private toInvitationView(invitation: {
    id: string;
    inviteeEmail: string | null;
    status: InvitationStatus;
    expiresAt: Date;
    student: { id: string; displayName: string };
  }): GuardianInvitationView {
    return {
      id: invitation.id,
      student: invitation.student,
      inviteeEmail: maskEmail(invitation.inviteeEmail ?? ""),
      status: "pending",
      expiresAt: invitation.expiresAt,
      consent: {
        policyVersion: GUARDIAN_CONSENT_POLICY_VERSION,
        scopes: [...GUARDIAN_CONSENT_SCOPES],
      },
    };
  }

  private toLinkView(link: {
    id: string;
    status: GuardianLinkStatus;
    consentedAt: Date | null;
    student: { id: string; displayName: string };
  }): GuardianLinkView {
    return {
      id: link.id,
      student: link.student,
      status: link.status.toLowerCase() as GuardianLinkView["status"],
      consentedAt: link.consentedAt,
    };
  }
}
