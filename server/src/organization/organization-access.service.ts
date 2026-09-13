import { HttpStatus, Injectable } from "@nestjs/common";
import type { CurrentUser } from "../auth/auth.types.js";
import { ApiError } from "../common/api-error.js";
import { readInputObject } from "../common/input-validation.js";
import { loadAppConfig, type AppConfig } from "../config/app-config.js";
import { PrismaService } from "../database/prisma.service.js";
import {
  AccountStatus,
  OrganizationClassStatus,
  OrganizationMembershipRole,
  OrganizationMembershipStatus,
  RoleType,
  RoleVerificationStatus,
} from "../generated/prisma/enums.js";
import {
  generateClassInviteCode,
  hashClassInviteCode,
  isClassInviteCode,
} from "./class-invite-code.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

@Injectable()
export class OrganizationAccessService {
  private readonly config: AppConfig;

  constructor(private readonly prisma: PrismaService) {
    this.config = loadAppConfig();
  }

  async listAdminOrganizations(user: CurrentUser) {
    const now = new Date();
    const memberships = await this.prisma.organizationMembership.findMany({
      where: {
        userId: user.id,
        role: OrganizationMembershipRole.ADMIN,
        status: OrganizationMembershipStatus.ACTIVE,
        startsAt: { lte: now },
        OR: [{ endsAt: null }, { endsAt: { gt: now } }],
      },
      select: {
        id: true,
        startsAt: true,
        endsAt: true,
        organization: { select: { id: true, name: true } },
      },
    });
    if (memberships.length === 0) {
      throw new ApiError(
        "ORGANIZATION_ADMIN_MEMBERSHIP_REQUIRED",
        "활성 기관 관리자 멤버십이 필요합니다.",
        HttpStatus.FORBIDDEN,
      );
    }

    return {
      items: memberships
        .map((membership) => ({
          membershipId: membership.id,
          organization: membership.organization,
          membership: { startsAt: membership.startsAt, endsAt: membership.endsAt },
          permissions: {
            license: ["read", "manage"] as const,
            seats: ["read", "manage"] as const,
            refunds: ["read", "request"] as const,
          },
        }))
        .sort((left, right) => (
          left.organization.name.localeCompare(right.organization.name, "ko")
          || left.organization.id.localeCompare(right.organization.id)
        )),
      paymentExecutionRoles: ["operator", "admin"] as const,
    };
  }

  async listAssignedClasses(user: CurrentUser) {
    const now = new Date();
    await this.requireVerifiedInstructor(user.id);

    const memberships = await this.prisma.organizationMembership.findMany({
      where: {
        userId: user.id,
        role: OrganizationMembershipRole.INSTRUCTOR,
        status: OrganizationMembershipStatus.ACTIVE,
        startsAt: { lte: now },
        OR: [{ endsAt: null }, { endsAt: { gt: now } }],
      },
      select: { id: true, organizationId: true },
    });
    if (memberships.length === 0) {
      throw new ApiError(
        "ORGANIZATION_MEMBERSHIP_REQUIRED",
        "활성 기관 멤버십이 있는 지도자만 담당 반을 조회할 수 있습니다.",
        HttpStatus.FORBIDDEN,
      );
    }

    const membershipIds = memberships.map((membership) => membership.id);
    const organizationByMembership = new Map(
      memberships.map((membership) => [membership.id, membership.organizationId]),
    );
    const assignments = await this.prisma.organizationClassTeacherAssignment.findMany({
      where: {
        teacherMembershipId: { in: membershipIds },
        startsAt: { lte: now },
        OR: [{ endsAt: null }, { endsAt: { gt: now } }],
        organizationClass: { status: OrganizationClassStatus.ACTIVE },
      },
      select: {
        startsAt: true,
        endsAt: true,
        teacherMembershipId: true,
        organizationClass: {
          select: {
            id: true,
            organizationId: true,
            name: true,
            academicYear: true,
            organization: { select: { id: true, name: true } },
          },
        },
      },
    });

    const items = assignments
      .filter((assignment) => (
        organizationByMembership.get(assignment.teacherMembershipId)
        === assignment.organizationClass.organizationId
      ))
      .map((assignment) => ({
        id: assignment.organizationClass.id,
        name: assignment.organizationClass.name,
        academicYear: assignment.organizationClass.academicYear,
        organization: assignment.organizationClass.organization,
        assignment: { startsAt: assignment.startsAt, endsAt: assignment.endsAt },
      }))
      .sort((left, right) => (
        right.academicYear - left.academicYear
        || left.organization.name.localeCompare(right.organization.name, "ko")
        || left.name.localeCompare(right.name, "ko")
      ));

    return { items };
  }

  async listAssignedClassStudents(user: CurrentUser, classId: string, requestId?: string) {
    const now = new Date();
    const assignment = await this.requireCurrentClassAssignment(user.id, classId, now);

    const enrollments = await this.prisma.organizationClassEnrollment.findMany({
      where: {
        organizationClassId: classId,
        startsAt: { lte: now },
        OR: [{ endsAt: null }, { endsAt: { gt: now } }],
        student: { status: AccountStatus.ACTIVE, deletedAt: null },
      },
      select: {
        startsAt: true,
        student: { select: { id: true, displayName: true } },
      },
    });
    const items = enrollments
      .map((enrollment) => ({ ...enrollment.student, enrolledAt: enrollment.startsAt }))
      .sort((left, right) => (
        left.displayName.localeCompare(right.displayName, "ko") || left.id.localeCompare(right.id)
      ));

    await this.prisma.auditLog.create({
      data: {
        actorId: user.id,
        action: "organization.class_students.viewed",
        resourceType: "OrganizationClass",
        resourceId: classId,
        requestId: requestId ?? null,
        metadata: { assignmentId: assignment.id, studentCount: items.length },
      },
    });

    return {
      class: assignment.organizationClass,
      items,
    };
  }

  async createClassInviteCode(user: CurrentUser, classId: string, requestId?: string) {
    const now = new Date();
    const assignment = await this.requireCurrentClassAssignment(user.id, classId, now);
    const code = generateClassInviteCode();
    const expiresAt = new Date(
      now.getTime() + this.config.organizationClassInviteTtlHours * 60 * 60_000,
    );

    const created = await this.prisma.$transaction(async (transaction) => {
      await transaction.organizationClassInviteCode.updateMany({
        where: {
          organizationClassId: classId,
          createdByUserId: user.id,
          consumedAt: null,
          revokedAt: null,
        },
        data: { revokedAt: now },
      });
      const inviteCode = await transaction.organizationClassInviteCode.create({
        data: {
          organizationClassId: classId,
          createdByUserId: user.id,
          codeHash: hashClassInviteCode(code),
          expiresAt,
        },
      });
      await transaction.auditLog.create({
        data: {
          actorId: user.id,
          action: "organization.class_invite_code.created",
          resourceType: "OrganizationClassInviteCode",
          resourceId: inviteCode.id,
          requestId: requestId ?? null,
          metadata: { organizationClassId: classId },
        },
      });
      return inviteCode;
    });

    return {
      inviteCode: {
        code,
        expiresAt: created.expiresAt,
        class: {
          id: assignment.organizationClass.id,
          name: assignment.organizationClass.name,
          academicYear: assignment.organizationClass.academicYear,
          organization: assignment.organizationClass.organization,
        },
      },
    };
  }

  async claimClassInviteCode(student: CurrentUser, body: unknown, requestId?: string) {
    const rawCode = body && typeof body === "object" && "code" in body
      && typeof body.code === "string" ? body.code : "";
    if (!isClassInviteCode(rawCode)) throw this.classInviteCodeNotFound();

    const inviteCode = await this.prisma.organizationClassInviteCode.findUnique({
      where: { codeHash: hashClassInviteCode(rawCode) },
      include: {
        organizationClass: {
          include: { organization: { select: { id: true, name: true } } },
        },
      },
    });
    if (!inviteCode) throw this.classInviteCodeNotFound();
    const now = new Date();
    if (inviteCode.expiresAt <= now) {
      throw new ApiError("CLASS_INVITE_CODE_EXPIRED", "학생 등록 코드가 만료되었습니다.", HttpStatus.GONE);
    }
    if (inviteCode.consumedAt || inviteCode.revokedAt) {
      throw new ApiError(
        "CLASS_INVITE_CODE_UNAVAILABLE",
        "이미 사용했거나 새 코드로 교체된 학생 등록 코드입니다.",
        HttpStatus.CONFLICT,
      );
    }
    if (inviteCode.organizationClass.status !== OrganizationClassStatus.ACTIVE) {
      throw new ApiError("CLASS_INVITE_CODE_UNAVAILABLE", "현재 사용할 수 없는 학생 등록 코드입니다.", HttpStatus.CONFLICT);
    }

    const enrollment = await this.prisma.$transaction(async (transaction) => {
      const existing = await transaction.organizationClassEnrollment.findUnique({
        where: {
          organizationClassId_studentId: {
            organizationClassId: inviteCode.organizationClassId,
            studentId: student.id,
          },
        },
      });
      if (existing && existing.startsAt <= now && (!existing.endsAt || existing.endsAt > now)) {
        throw new ApiError("CLASS_ENROLLMENT_EXISTS", "이미 등록된 학급입니다.", HttpStatus.CONFLICT);
      }

      const claimed = await transaction.organizationClassInviteCode.updateMany({
        where: {
          id: inviteCode.id,
          consumedAt: null,
          consumedByStudentId: null,
          revokedAt: null,
          expiresAt: { gt: now },
          organizationClass: { status: OrganizationClassStatus.ACTIVE },
        },
        data: { consumedAt: now, consumedByStudentId: student.id },
      });
      if (claimed.count !== 1) {
        throw new ApiError(
          "CLASS_INVITE_CODE_UNAVAILABLE",
          "이미 사용했거나 만료된 학생 등록 코드입니다.",
          HttpStatus.CONFLICT,
        );
      }

      const activeEnrollment = await transaction.organizationClassEnrollment.upsert({
        where: {
          organizationClassId_studentId: {
            organizationClassId: inviteCode.organizationClassId,
            studentId: student.id,
          },
        },
        create: {
          organizationClassId: inviteCode.organizationClassId,
          studentId: student.id,
          startsAt: now,
        },
        update: { startsAt: now, endsAt: null },
      });
      await transaction.auditLog.create({
        data: {
          actorId: student.id,
          action: "organization.class_invite_code.claimed",
          resourceType: "OrganizationClassEnrollment",
          resourceId: activeEnrollment.id,
          requestId: requestId ?? null,
          metadata: {
            organizationClassId: inviteCode.organizationClassId,
            inviteCodeId: inviteCode.id,
          },
        },
      });
      return activeEnrollment;
    });

    return {
      enrollment: {
        id: enrollment.id,
        enrolledAt: enrollment.startsAt,
        class: {
          id: inviteCode.organizationClass.id,
          name: inviteCode.organizationClass.name,
          academicYear: inviteCode.organizationClass.academicYear,
          organization: inviteCode.organizationClass.organization,
        },
      },
    };
  }

  async getClassProgressSetting(user: CurrentUser, classId: string) {
    const assignment = await this.requireCurrentClassAssignment(user.id, classId, new Date());
    const [setting, lessons] = await Promise.all([
      this.prisma.organizationClassProgressSetting.findUnique({
        where: { organizationClassId: classId },
        include: {
          currentLesson: {
            include: { era: { select: { id: true, name: true, order: true } } },
          },
        },
      }),
      this.prisma.lesson.findMany({
        where: { status: "PUBLISHED" },
        include: { era: { select: { id: true, name: true, order: true } } },
        orderBy: [{ era: { order: "asc" } }, { order: "asc" }],
      }),
    ]);

    return {
      progressSetting: {
        class: this.classView(assignment.organizationClass),
        currentLesson: setting ? {
          ...this.progressLessonView(setting.currentLesson),
          updatedAt: setting.updatedAt,
        } : null,
        availableLessons: lessons.map((lesson) => this.progressLessonView(lesson)),
      },
    };
  }

  async updateClassProgressSetting(
    user: CurrentUser,
    classId: string,
    body: unknown,
    requestId?: string,
  ) {
    const now = new Date();
    const assignment = await this.requireCurrentClassAssignment(user.id, classId, now);
    const data = readInputObject(
      body,
      ["lessonId"],
      "CLASS_PROGRESS_SETTING_INVALID",
      "현재 수업으로 지정할 강의를 확인해 주세요.",
    );
    const lessonId = data.lessonId;
    if (lessonId !== null && (
      typeof lessonId !== "string"
      || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/u.test(lessonId)
    )) {
      throw new ApiError(
        "CLASS_PROGRESS_SETTING_INVALID",
        "현재 수업으로 지정할 강의를 확인해 주세요.",
        HttpStatus.BAD_REQUEST,
      );
    }

    if (lessonId === null) {
      await this.prisma.$transaction(async (transaction) => {
        await transaction.organizationClassProgressSetting.deleteMany({
          where: { organizationClassId: classId },
        });
        await transaction.auditLog.create({
          data: {
            actorId: user.id,
            action: "organization.class_progress_setting.cleared",
            resourceType: "OrganizationClass",
            resourceId: classId,
            requestId: requestId ?? null,
            metadata: {},
          },
        });
      });
      return {
        progressSetting: {
          class: this.classView(assignment.organizationClass),
          currentLesson: null,
        },
      };
    }

    const lesson = await this.prisma.lesson.findFirst({
      where: { id: lessonId, status: "PUBLISHED" },
      include: { era: { select: { id: true, name: true, order: true } } },
    });
    if (!lesson) {
      throw new ApiError(
        "CLASS_PROGRESS_LESSON_INVALID",
        "공개된 강의만 현재 수업으로 지정할 수 있습니다.",
        HttpStatus.BAD_REQUEST,
      );
    }

    const setting = await this.prisma.$transaction(async (transaction) => {
      const saved = await transaction.organizationClassProgressSetting.upsert({
        where: { organizationClassId: classId },
        create: {
          organizationClassId: classId,
          currentLessonId: lesson.id,
          updatedByUserId: user.id,
        },
        update: { currentLessonId: lesson.id, updatedByUserId: user.id },
      });
      await transaction.auditLog.create({
        data: {
          actorId: user.id,
          action: "organization.class_progress_setting.updated",
          resourceType: "OrganizationClass",
          resourceId: classId,
          requestId: requestId ?? null,
          metadata: { currentLessonId: lesson.id },
        },
      });
      return saved;
    });

    return {
      progressSetting: {
        class: this.classView(assignment.organizationClass),
        currentLesson: {
          ...this.progressLessonView(lesson),
          updatedAt: setting.updatedAt,
        },
      },
    };
  }

  private async requireVerifiedInstructor(userId: string): Promise<void> {
    const role = await this.prisma.userRoleAssignment.findUnique({
      where: { userId_role: { userId, role: RoleType.INSTRUCTOR } },
      select: { verificationStatus: true },
    });
    if (role?.verificationStatus !== RoleVerificationStatus.VERIFIED) {
      throw new ApiError(
        "INSTRUCTOR_VERIFICATION_REQUIRED",
        "인증이 완료된 지도자만 기관 반에 접근할 수 있습니다.",
        HttpStatus.FORBIDDEN,
      );
    }
  }

  private async requireCurrentClassAssignment(userId: string, classId: string, now: Date) {
    if (!UUID_PATTERN.test(classId)) throw this.classStudentsForbidden();
    await this.requireVerifiedInstructor(userId);
    const assignments = await this.prisma.organizationClassTeacherAssignment.findMany({
      where: {
        organizationClassId: classId,
        startsAt: { lte: now },
        OR: [{ endsAt: null }, { endsAt: { gt: now } }],
        organizationClass: { status: OrganizationClassStatus.ACTIVE },
        teacherMembership: {
          userId,
          role: OrganizationMembershipRole.INSTRUCTOR,
          status: OrganizationMembershipStatus.ACTIVE,
          startsAt: { lte: now },
          OR: [{ endsAt: null }, { endsAt: { gt: now } }],
        },
      },
      select: {
        id: true,
        organizationClass: {
          select: {
            id: true,
            organizationId: true,
            name: true,
            academicYear: true,
            organization: { select: { id: true, name: true } },
          },
        },
        teacherMembership: { select: { organizationId: true } },
      },
    });
    const assignment = assignments.find((item) => (
      item.organizationClass.organizationId === item.teacherMembership.organizationId
    ));
    if (!assignment) throw this.classStudentsForbidden();
    return assignment;
  }

  private classStudentsForbidden(): ApiError {
    return new ApiError(
      "CLASS_STUDENTS_FORBIDDEN",
      "담당 반의 학생만 조회할 수 있습니다.",
      HttpStatus.FORBIDDEN,
    );
  }

  private classInviteCodeNotFound(): ApiError {
    return new ApiError(
      "CLASS_INVITE_CODE_NOT_FOUND",
      "학생 등록 코드를 확인해 주세요.",
      HttpStatus.NOT_FOUND,
    );
  }

  private classView(organizationClass: {
    id: string;
    name: string;
    academicYear: number;
    organization: { id: string; name: string };
  }) {
    return {
      id: organizationClass.id,
      name: organizationClass.name,
      academicYear: organizationClass.academicYear,
      organization: organizationClass.organization,
    };
  }

  private progressLessonView(lesson: {
    id: string;
    order: number;
    course: string;
    title: string;
    durationMinutes: number;
    era: { id: string; name: string; order: number };
  }) {
    return {
      id: lesson.id,
      order: lesson.order,
      course: lesson.course,
      title: lesson.title,
      durationMinutes: lesson.durationMinutes,
      era: lesson.era,
    };
  }
}
