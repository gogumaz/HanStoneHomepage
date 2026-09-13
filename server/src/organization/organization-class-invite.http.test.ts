import { HttpStatus, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthService } from "../auth/auth.service.js";
import { RolesGuard } from "../auth/roles.guard.js";
import { SessionAuthGuard } from "../auth/session-auth.guard.js";
import type { CurrentUser } from "../auth/auth.types.js";
import { ApiError } from "../common/api-error.js";
import { ApiExceptionFilter } from "../common/api-exception.filter.js";
import { ApiResponseInterceptor } from "../common/api-response.interceptor.js";
import { RateLimitGuard } from "../common/rate-limit.guard.js";
import { MemoryRateLimitStore, RATE_LIMIT_STORE } from "../common/rate-limit.store.js";
import { RequestIdMiddleware } from "../common/request-id.middleware.js";
import { PrismaService } from "../database/prisma.service.js";
import { OrganizationClassStatus, RoleVerificationStatus } from "../generated/prisma/enums.js";
import { listenForHttpTest } from "../test-utils/listen-test-app.js";
import { hashClassInviteCode } from "./class-invite-code.js";
import { OrganizationAccessService } from "./organization-access.service.js";
import { OrganizationController, OrganizationEnrollmentController } from "./organization.controller.js";

const classId = "30000000-0000-4000-8000-000000000001";
const otherClassId = "30000000-0000-4000-8000-000000000002";
const rawCode = "ABCD-EFGH-JKLM";
const users = {
  teacher: {
    id: "teacher-user", email: "teacher@example.test", emailVerified: true,
    displayName: "담당 지도자", roles: ["instructor"],
  },
  student: {
    id: "student-user", email: "student@example.test", emailVerified: true,
    displayName: "학생", roles: ["student"],
  },
  guardian: {
    id: "guardian-user", email: "guardian@example.test", emailVerified: true,
    displayName: "보호자", roles: ["guardian"],
  },
} satisfies Record<string, CurrentUser>;

const organizationClass = {
  id: classId,
  organizationId: "organization-1",
  name: "햇살반",
  academicYear: 2026,
  status: OrganizationClassStatus.ACTIVE,
  organization: { id: "organization-1", name: "한빛초등학교" },
};
const assignmentFindMany = vi.fn(async ({ where }: { where: { organizationClassId?: string } }) => (
  where.organizationClassId === classId ? [{
    id: "assignment-1",
    organizationClass,
    teacherMembership: { organizationId: "organization-1" },
  }] : []
));
const inviteCreate = vi.fn(async ({ data }: { data: { expiresAt: Date } }) => ({
  id: "invite-code-1",
  expiresAt: data.expiresAt,
}));
let inviteRecord: null | Record<string, unknown>;
let claimCount: number;
let existingEnrollment: null | { id: string; startsAt: Date; endsAt: Date | null };
const inviteFindUnique = vi.fn(async () => inviteRecord);
const inviteUpdateMany = vi.fn(async ({ data }: { data: Record<string, unknown> }) => (
  "consumedAt" in data ? { count: claimCount } : { count: 1 }
));
const enrollmentFindUnique = vi.fn(async () => existingEnrollment);
const enrollmentUpsert = vi.fn(async ({ create }: { create: { startsAt: Date } }) => ({
  id: "enrollment-1",
  startsAt: create.startsAt,
  endsAt: null,
}));
const auditCreate = vi.fn(async () => ({ id: "audit-1" }));
const transaction = {
  organizationClassInviteCode: { create: inviteCreate, updateMany: inviteUpdateMany },
  organizationClassEnrollment: { findUnique: enrollmentFindUnique, upsert: enrollmentUpsert },
  auditLog: { create: auditCreate },
};
const prisma = {
  userRoleAssignment: { findUnique: vi.fn(async () => ({ verificationStatus: RoleVerificationStatus.VERIFIED })) },
  organizationClassTeacherAssignment: { findMany: assignmentFindMany },
  organizationClassInviteCode: { findUnique: inviteFindUnique },
  $transaction: vi.fn(async (callback: (client: typeof transaction) => unknown) => callback(transaction)),
} as unknown as PrismaService;
const authService = {
  getConfig: () => ({ sessionCookieName: "baduk_session" }),
  authenticate: vi.fn(async (token?: string | null) => {
    const user = token ? users[token as keyof typeof users] : undefined;
    if (!user) throw new ApiError("AUTH_REQUIRED", "로그인이 필요합니다.", HttpStatus.UNAUTHORIZED);
    return user;
  }),
};

describe("organization class invite HTTP API", () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5432/test";
    process.env.ORGANIZATION_CLASS_INVITE_TTL_HOURS = "72";
    const moduleRef = await Test.createTestingModule({
      controllers: [OrganizationController, OrganizationEnrollmentController],
      providers: [
        OrganizationAccessService,
        SessionAuthGuard,
        RolesGuard,
        RateLimitGuard,
        { provide: RATE_LIMIT_STORE, useValue: new MemoryRateLimitStore() },
        { provide: PrismaService, useValue: prisma },
        { provide: AuthService, useValue: authService },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    const requestId = new RequestIdMiddleware();
    app.use(requestId.use.bind(requestId));
    app.useGlobalFilters(new ApiExceptionFilter());
    app.useGlobalInterceptors(new ApiResponseInterceptor());
    baseUrl = await listenForHttpTest(app);
  });

  afterAll(async () => app.close());
  beforeEach(() => {
    vi.clearAllMocks();
    claimCount = 1;
    existingEnrollment = null;
    inviteRecord = {
      id: "invite-code-1",
      organizationClassId: classId,
      codeHash: hashClassInviteCode(rawCode),
      expiresAt: new Date(Date.now() + 60 * 60_000),
      consumedAt: null,
      consumedByStudentId: null,
      revokedAt: null,
      organizationClass,
    };
  });

  it("lets only the currently assigned instructor create a one-time code", async () => {
    const wrongRole = await fetch(`${baseUrl}/api/v1/teacher/classes/${classId}/invite-codes`, {
      method: "POST", headers: { cookie: "baduk_session=student" },
    });
    const unassigned = await fetch(`${baseUrl}/api/v1/teacher/classes/${otherClassId}/invite-codes`, {
      method: "POST", headers: { cookie: "baduk_session=teacher" },
    });
    const response = await fetch(`${baseUrl}/api/v1/teacher/classes/${classId}/invite-codes`, {
      method: "POST", headers: { cookie: "baduk_session=teacher" },
    });
    const body = await response.json() as { data: { inviteCode: { code: string; class: { id: string } } } };

    expect(wrongRole.status).toBe(403);
    expect(unassigned.status).toBe(403);
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(body.data.inviteCode.code).toMatch(/^[A-HJ-NP-Z2-9]{4}(?:-[A-HJ-NP-Z2-9]{4}){2}$/u);
    expect(body.data.inviteCode.class.id).toBe(classId);
    const createdData = inviteCreate.mock.calls[0]![0].data as { codeHash: string; expiresAt: Date };
    expect(createdData.codeHash).toBe(hashClassInviteCode(body.data.inviteCode.code));
    expect(JSON.stringify(inviteCreate.mock.calls)).not.toContain(body.data.inviteCode.code);
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      action: "organization.class_invite_code.created",
      metadata: { organizationClassId: classId },
    }) }));
  });

  it("atomically consumes a valid code and enrolls only a student", async () => {
    const wrongRole = await fetch(`${baseUrl}/api/v1/me/class-invite-codes/claim`, {
      method: "POST",
      headers: { cookie: "baduk_session=guardian", "content-type": "application/json" },
      body: JSON.stringify({ code: rawCode }),
    });
    const response = await fetch(`${baseUrl}/api/v1/me/class-invite-codes/claim`, {
      method: "POST",
      headers: { cookie: "baduk_session=student", "content-type": "application/json" },
      body: JSON.stringify({ code: "abcd efgh jklm" }),
    });
    const body = await response.json() as { data: { enrollment: { class: { name: string } } } };

    expect(wrongRole.status).toBe(403);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(body.data.enrollment.class.name).toBe("햇살반");
    expect(inviteFindUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { codeHash: hashClassInviteCode(rawCode) },
    }));
    expect(inviteUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      consumedByStudentId: users.student.id,
    }) }));
    expect(enrollmentUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationClassId_studentId: { organizationClassId: classId, studentId: users.student.id } },
    }));
  });

  it("rejects malformed, expired, reused, and concurrently consumed codes", async () => {
    const request = (code: string) => fetch(`${baseUrl}/api/v1/me/class-invite-codes/claim`, {
      method: "POST",
      headers: { cookie: "baduk_session=student", "content-type": "application/json" },
      body: JSON.stringify({ code }),
    });

    const malformed = await request("1234");
    expect(malformed.status).toBe(404);
    expect(inviteFindUnique).not.toHaveBeenCalled();

    inviteRecord = { ...inviteRecord, expiresAt: new Date(Date.now() - 1_000) };
    expect((await request(rawCode)).status).toBe(410);

    inviteRecord = { ...inviteRecord, expiresAt: new Date(Date.now() + 60_000), consumedAt: new Date() };
    expect((await request(rawCode)).status).toBe(409);

    inviteRecord = { ...inviteRecord, consumedAt: null };
    claimCount = 0;
    expect((await request(rawCode)).status).toBe(409);
    expect(enrollmentUpsert).not.toHaveBeenCalled();
  });

  it("does not spend a code when the student already has an active enrollment", async () => {
    existingEnrollment = { id: "existing", startsAt: new Date(Date.now() - 60_000), endsAt: null };
    const response = await fetch(`${baseUrl}/api/v1/me/class-invite-codes/claim`, {
      method: "POST",
      headers: { cookie: "baduk_session=student", "content-type": "application/json" },
      body: JSON.stringify({ code: rawCode }),
    });

    expect(response.status).toBe(409);
    expect(inviteUpdateMany).not.toHaveBeenCalled();
    expect(enrollmentUpsert).not.toHaveBeenCalled();
  });
});
