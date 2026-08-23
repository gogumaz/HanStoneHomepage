import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "../app.module.js";
import { hashSessionToken } from "../auth/session-cookie.js";
import { ApiExceptionFilter } from "../common/api-exception.filter.js";
import { ApiResponseInterceptor } from "../common/api-response.interceptor.js";
import { RequestIdMiddleware } from "../common/request-id.middleware.js";
import { PrismaService } from "../database/prisma.service.js";
import {
  AccountStatus,
  ConsentStatus,
  GuardianLinkStatus,
  InvitationStatus,
  LessonProgressStatus,
  LessonStatus,
  RoleType,
} from "../generated/prisma/enums.js";

type RecordValue = Record<string, any>;

function createPrismaMock() {
  const users: RecordValue[] = [
    { id: "student-1", email: "student@example.com", displayName: "초대 학생", passwordHash: null, status: AccountStatus.ACTIVE, roles: [{ role: RoleType.STUDENT }] },
    { id: "guardian-1", email: "guardian@example.com", displayName: "초대 보호자", passwordHash: null, status: AccountStatus.ACTIVE, roles: [{ role: RoleType.GUARDIAN }] },
    { id: "guardian-2", email: "other@example.com", displayName: "다른 보호자", passwordHash: null, status: AccountStatus.ACTIVE, roles: [{ role: RoleType.GUARDIAN }] },
  ];
  const sessions: RecordValue[] = [
    { id: "session-student", userId: "student-1", tokenHash: hashSessionToken("student-token"), expiresAt: new Date(Date.now() + 60_000), revokedAt: null },
    { id: "session-guardian", userId: "guardian-1", tokenHash: hashSessionToken("guardian-token"), expiresAt: new Date(Date.now() + 60_000), revokedAt: null },
    { id: "session-other", userId: "guardian-2", tokenHash: hashSessionToken("other-token"), expiresAt: new Date(Date.now() + 60_000), revokedAt: null },
  ];
  const invitations: RecordValue[] = [];
  const links: RecordValue[] = [];
  const consents: RecordValue[] = [];
  const lessons: RecordValue[] = [
    {
      id: "PRE-01", eraId: "era_prehistoric", order: 1, course: "입문 1권",
      title: "첫 강의", durationMinutes: 8, status: LessonStatus.PUBLISHED,
      era: { id: "era_prehistoric", name: "선사시대", order: 1 }, totalSteps: 2,
    },
    {
      id: "PRE-02", eraId: "era_prehistoric", order: 2, course: "입문 1권",
      title: "둘째 강의", durationMinutes: 10, status: LessonStatus.PUBLISHED,
      era: { id: "era_prehistoric", name: "선사시대", order: 1 }, totalSteps: 2,
    },
    {
      id: "DRAFT-01", eraId: "era_prehistoric", order: 3, course: "입문 1권",
      title: "비공개 강의", durationMinutes: 10, status: LessonStatus.DRAFT,
      era: { id: "era_prehistoric", name: "선사시대", order: 1 }, totalSteps: 2,
    },
  ];
  const progressByLesson: Record<string, RecordValue> = {
    "PRE-01": {
      status: LessonProgressStatus.IN_PROGRESS,
      startedAt: new Date("2026-08-20T00:00:00.000Z"), completedAt: null,
      updatedAt: new Date("2026-08-21T00:00:00.000Z"), lastPositionSeconds: 120, completedSteps: 1,
    },
    "PRE-02": {
      status: LessonProgressStatus.COMPLETED,
      startedAt: new Date("2026-08-18T00:00:00.000Z"), completedAt: new Date("2026-08-19T00:00:00.000Z"),
      updatedAt: new Date("2026-08-19T00:00:00.000Z"), lastPositionSeconds: 0, completedSteps: 2,
    },
  };

  function invitationMatches(item: RecordValue, where: RecordValue): boolean {
    if (where.id && item.id !== where.id) return false;
    if (where.studentId && item.studentId !== where.studentId) return false;
    if (where.inviteeEmail && item.inviteeEmail !== where.inviteeEmail) return false;
    if (where.status && item.status !== where.status) return false;
    if (where.expiresAt?.gt && item.expiresAt.getTime() <= where.expiresAt.gt.getTime()) return false;
    return true;
  }

  function withStudent(item: RecordValue): RecordValue {
    return { ...item, student: users.find((user) => user.id === item.studentId) };
  }

  const prisma = {
    user: { findUnique: vi.fn(async () => null) },
    session: {
      findUnique: vi.fn(async ({ where, include }: RecordValue) => {
        const session = sessions.find((item) => item.tokenHash === where.tokenHash);
        return session && include
          ? { ...session, user: users.find((user) => user.id === session.userId) }
          : session ?? null;
      }),
    },
    guardianInvitation: {
      create: vi.fn(async ({ data, include }: RecordValue) => {
        const invitation = {
          id: `invitation-${invitations.length + 1}`,
          ...data,
          inviteePhone: null,
          status: InvitationStatus.PENDING,
          acceptedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        invitations.push(invitation);
        return include ? withStudent(invitation) : invitation;
      }),
      findUnique: vi.fn(async ({ where, include }: RecordValue) => {
        const invitation = invitations.find((item) => item.tokenHash === where.tokenHash);
        return invitation && include ? withStudent(invitation) : invitation ?? null;
      }),
      updateMany: vi.fn(async ({ where, data }: RecordValue) => {
        const matches = invitations.filter((item) => invitationMatches(item, where));
        matches.forEach((item) => Object.assign(item, data, { updatedAt: new Date() }));
        return { count: matches.length };
      }),
    },
    guardianLink: {
      upsert: vi.fn(async ({ where, create, update, include }: RecordValue) => {
        const key = where.studentId_guardianId;
        const existing = links.find((item) => item.studentId === key.studentId && item.guardianId === key.guardianId);
        let link: RecordValue;
        if (existing) {
          Object.assign(existing, update, { updatedAt: new Date() });
          link = existing;
        } else {
          link = {
            id: `link-${links.length + 1}`,
            ...create,
            revokedAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          links.push(link);
        }
        return include ? withStudent(link) : link;
      }),
      findMany: vi.fn(async ({ where }: RecordValue) =>
        links.filter((item) => item.guardianId === where.guardianId && item.status === where.status).map(withStudent)),
      findFirst: vi.fn(async ({ where, include }: RecordValue) => {
        const link = links.find((item) => {
          if (item.guardianId !== where.guardianId || item.studentId !== where.studentId || item.status !== where.status) return false;
          const consentWhere = where.consents?.some;
          return consents.some((consent) =>
            consent.guardianLinkId === item.id
            && consent.guardianId === consentWhere.guardianId
            && consent.studentId === consentWhere.studentId
            && consent.status === consentWhere.status
            && consent.consentType === consentWhere.consentType
            && consent.policyVersion === consentWhere.policyVersion
            && consentWhere.scope.hasEvery.every((scope: string) => consent.scope.includes(scope)));
        });
        return link && include ? withStudent(link) : link ?? null;
      }),
      findUnique: vi.fn(async ({ where, include }: RecordValue) => {
        const link = links.find((item) => item.id === where.id);
        return link && include ? withStudent(link) : link ?? null;
      }),
      update: vi.fn(async ({ where, data, include }: RecordValue) => {
        const link = links.find((item) => item.id === where.id);
        Object.assign(link ?? {}, data, { updatedAt: new Date() });
        return include && link ? withStudent(link) : link;
      }),
    },
    guardianConsent: {
      create: vi.fn(async ({ data }: RecordValue) => {
        const consent = { id: `consent-${consents.length + 1}`, status: ConsentStatus.ACTIVE, ...data };
        consents.push(consent);
        return consent;
      }),
      updateMany: vi.fn(async ({ where, data }: RecordValue) => {
        const matches = consents.filter((item) => item.guardianLinkId === where.guardianLinkId && item.status === where.status);
        matches.forEach((item) => Object.assign(item, data));
        return { count: matches.length };
      }),
    },
    lesson: {
      findMany: vi.fn(async ({ where }: RecordValue) => lessons
        .filter((lesson) => lesson.status === where.status)
        .map((lesson) => {
          const progress = progressByLesson[lesson.id];
          return {
            ...lesson,
            era: { id: lesson.era.id, name: lesson.era.name },
            _count: { steps: lesson.totalSteps },
            progress: progress ? [{ ...progress, _count: { stepCompletions: progress.completedSteps } }] : [],
          };
        })),
    },
    auditLog: { create: vi.fn(async () => ({ id: "audit" })) },
    isReady: vi.fn(async () => true),
    $transaction: vi.fn(async (input: unknown) => {
      if (typeof input === "function") return (input as (transaction: typeof prisma) => unknown)(prisma);
      return Promise.all(input as Promise<unknown>[]);
    }),
  };
  return { prisma: prisma as unknown as PrismaService, invitations, links, consents };
}

describe("guardian invitation HTTP flow", () => {
  let app: INestApplication;
  let baseUrl: string;
  let state: ReturnType<typeof createPrismaMock>;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5432/test";
    process.env.SESSION_COOKIE_NAME = "baduk_session";
    process.env.GUARDIAN_INVITATION_TTL_HOURS = "72";
    state = createPrismaMock();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(state.prisma)
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    const requestId = new RequestIdMiddleware();
    app.use(requestId.use.bind(requestId));
    app.useGlobalFilters(new ApiExceptionFilter());
    app.useGlobalInterceptors(new ApiResponseInterceptor());
    await app.listen(0, "127.0.0.1");
    baseUrl = await app.getUrl();
  });

  afterAll(async () => app.close());

  it("keeps an invitation pending until the matching guardian consents, then allows revocation", async () => {
    const guardianCannotInvite = await fetch(`${baseUrl}/api/v1/me/guardian-invitations`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: "baduk_session=guardian-token" },
      body: JSON.stringify({ email: "guardian@example.com" }),
    });
    expect(guardianCannotInvite.status).toBe(403);

    const invitationResponse = await fetch(`${baseUrl}/api/v1/me/guardian-invitations`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: "baduk_session=student-token" },
      body: JSON.stringify({ email: "guardian@example.com" }),
    });
    const created = await invitationResponse.json() as {
      data: { invitation: { inviteeEmail: string; status: string }; developmentToken: string };
    };
    expect(invitationResponse.status).toBe(201);
    expect(created.data.invitation.status).toBe("pending");
    expect(created.data.invitation.inviteeEmail).not.toBe("guardian@example.com");
    expect(state.links).toHaveLength(0);

    const publicResponse = await fetch(
      `${baseUrl}/api/v1/guardian-invitations/${created.data.developmentToken}`,
    );
    expect(publicResponse.status).toBe(200);

    const mismatchResponse = await fetch(
      `${baseUrl}/api/v1/guardian-invitations/${created.data.developmentToken}/accept`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie: "baduk_session=other-token" },
        body: JSON.stringify({
          consent: true,
          policyVersion: "guardian-link-v1",
          scopes: ["learning_progress", "learning_reports"],
        }),
      },
    );
    expect(mismatchResponse.status).toBe(403);
    expect(state.links).toHaveLength(0);

    const pendingListResponse = await fetch(`${baseUrl}/api/v1/guardians/me/students`, {
      headers: { cookie: "baduk_session=guardian-token" },
    });
    const pendingList = await pendingListResponse.json() as { data: { students: unknown[] } };
    expect(pendingList.data.students).toHaveLength(0);

    const incompleteConsentResponse = await fetch(
      `${baseUrl}/api/v1/guardian-invitations/${created.data.developmentToken}/accept`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie: "baduk_session=guardian-token" },
        body: JSON.stringify({
          consent: true,
          policyVersion: "guardian-link-v1",
          scopes: ["learning_progress"],
        }),
      },
    );
    expect(incompleteConsentResponse.status).toBe(400);
    expect(state.links).toHaveLength(0);

    const acceptResponse = await fetch(
      `${baseUrl}/api/v1/guardian-invitations/${created.data.developmentToken}/accept`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie: "baduk_session=guardian-token" },
        body: JSON.stringify({
          consent: true,
          policyVersion: "guardian-link-v1",
          scopes: ["learning_progress", "learning_reports"],
        }),
      },
    );
    const accepted = await acceptResponse.json() as { data: { link: { id: string; status: string } } };
    expect(acceptResponse.status).toBe(200);
    expect(accepted.data.link.status).toBe("active");
    expect(state.consents).toHaveLength(1);

    const reusedResponse = await fetch(
      `${baseUrl}/api/v1/guardian-invitations/${created.data.developmentToken}`,
    );
    expect(reusedResponse.status).toBe(409);

    const listResponse = await fetch(`${baseUrl}/api/v1/guardians/me/students`, {
      headers: { cookie: "baduk_session=guardian-token" },
    });
    const list = await listResponse.json() as { data: { students: unknown[] } };
    expect(list.data.students).toHaveLength(1);

    const activeConsent = state.consents[0];
    if (activeConsent) activeConsent.scope = ["learning_progress"];
    const insufficientScopeReport = await fetch(`${baseUrl}/api/v1/guardians/me/students/student-1/report`, {
      headers: { cookie: "baduk_session=guardian-token" },
    });
    expect(insufficientScopeReport.status).toBe(403);
    if (activeConsent) activeConsent.scope = ["learning_progress", "learning_reports"];

    const otherGuardianReport = await fetch(`${baseUrl}/api/v1/guardians/me/students/student-1/report`, {
      headers: { cookie: "baduk_session=other-token" },
    });
    expect(otherGuardianReport.status).toBe(403);

    const reportResponse = await fetch(`${baseUrl}/api/v1/guardians/me/students/student-1/report`, {
      headers: { cookie: "baduk_session=guardian-token" },
    });
    const report = await reportResponse.json() as {
      data: {
        student: { displayName: string };
        summary: {
          totalLessons: number; startedLessons: number; completedLessons: number;
          completionRate: number; completedSteps: number; totalSteps: number; stepCompletionRate: number;
        };
        items: Array<{ lesson: { id: string }; progress: { status: string; completedSteps: number } }>;
      };
    };
    expect(reportResponse.status).toBe(200);
    expect(reportResponse.headers.get("cache-control")).toBe("private, no-store");
    expect(reportResponse.headers.get("vary")).toContain("Cookie");
    expect(report.data.student.displayName).toBe("초대 학생");
    expect(report.data.summary).toMatchObject({
      totalLessons: 2,
      startedLessons: 2,
      completedLessons: 1,
      completionRate: 50,
      completedSteps: 3,
      totalSteps: 4,
      stepCompletionRate: 75,
    });
    expect(report.data.items).toEqual([
      expect.objectContaining({ lesson: expect.objectContaining({ id: "PRE-01" }), progress: expect.objectContaining({ status: "in_progress", completedSteps: 1 }) }),
      expect.objectContaining({ lesson: expect.objectContaining({ id: "PRE-02" }), progress: expect.objectContaining({ status: "completed", completedSteps: 2 }) }),
    ]);

    const forbiddenRevoke = await fetch(
      `${baseUrl}/api/v1/me/guardian-links/${accepted.data.link.id}/revoke`,
      { method: "POST", headers: { cookie: "baduk_session=other-token" } },
    );
    expect(forbiddenRevoke.status).toBe(403);

    const revokeResponse = await fetch(
      `${baseUrl}/api/v1/me/guardian-links/${accepted.data.link.id}/revoke`,
      { method: "POST", headers: { cookie: "baduk_session=guardian-token" } },
    );
    expect(revokeResponse.status).toBe(200);
    expect(state.consents[0]?.status).toBe(ConsentStatus.WITHDRAWN);

    const revokedReport = await fetch(`${baseUrl}/api/v1/guardians/me/students/student-1/report`, {
      headers: { cookie: "baduk_session=guardian-token" },
    });
    expect(revokedReport.status).toBe(403);

    const emptyListResponse = await fetch(`${baseUrl}/api/v1/guardians/me/students`, {
      headers: { cookie: "baduk_session=guardian-token" },
    });
    const emptyList = await emptyListResponse.json() as { data: { students: unknown[] } };
    expect(emptyList.data.students).toHaveLength(0);
  });

  it("rejects expired invitations and marks them expired", async () => {
    const response = await fetch(`${baseUrl}/api/v1/me/guardian-invitations`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: "baduk_session=student-token" },
      body: JSON.stringify({ email: "expired@example.com" }),
    });
    const created = await response.json() as { data: { developmentToken: string } };
    const invitation = state.invitations.find((item) => item.inviteeEmail === "expired@example.com");
    if (invitation) invitation.expiresAt = new Date(Date.now() - 1);

    const expiredResponse = await fetch(
      `${baseUrl}/api/v1/guardian-invitations/${created.data.developmentToken}`,
    );
    const expired = await expiredResponse.json() as { error: { code: string } };
    expect(expiredResponse.status).toBe(410);
    expect(expired.error.code).toBe("INVITATION_EXPIRED");
    expect(invitation?.status).toBe(InvitationStatus.EXPIRED);
  });
});
