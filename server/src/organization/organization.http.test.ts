import { HttpStatus, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthService } from "../auth/auth.service.js";
import type { CurrentUser } from "../auth/auth.types.js";
import { ApiError } from "../common/api-error.js";
import { ApiExceptionFilter } from "../common/api-exception.filter.js";
import { ApiResponseInterceptor } from "../common/api-response.interceptor.js";
import { RequestIdMiddleware } from "../common/request-id.middleware.js";
import { PrismaService } from "../database/prisma.service.js";
import {
  AccountStatus,
  OrganizationMembershipRole,
  OrganizationMembershipStatus,
  RoleVerificationStatus,
} from "../generated/prisma/enums.js";
import { listenForHttpTest } from "../test-utils/listen-test-app.js";
import { OrganizationModule } from "./organization.module.js";

const users = {
  student: {
    id: "student-user",
    email: "student@example.com",
    emailVerified: true,
    displayName: "학생",
    roles: ["student"],
  },
  pending: {
    id: "pending-instructor",
    email: "pending@example.com",
    emailVerified: true,
    displayName: "인증 대기 지도자",
    roles: ["instructor"],
  },
  inactive: {
    id: "inactive-instructor",
    email: "inactive@example.com",
    emailVerified: true,
    displayName: "휴면 기관 지도자",
    roles: ["instructor"],
  },
  active: {
    id: "active-instructor",
    email: "active@example.com",
    emailVerified: true,
    displayName: "담당 지도자",
    roles: ["instructor"],
  },
  organizationAdmin: {
    id: "organization-admin-user",
    email: "organization-admin@example.com",
    emailVerified: true,
    displayName: "기관 관리자",
    roles: ["organization_admin"],
  },
  organizationAdminWithoutMembership: {
    id: "organization-admin-without-membership",
    email: "organization-admin-no-membership@example.com",
    emailVerified: true,
    displayName: "소속 없는 기관 관리자",
    roles: ["organization_admin"],
  },
} satisfies Record<string, CurrentUser>;
const sessionUsers: Record<string, CurrentUser> = users;
const assignedClassId = "30000000-0000-4000-8000-000000000001";
const unassignedClassId = "30000000-0000-4000-8000-000000000002";
const crossOrganizationClassId = "30000000-0000-4000-8000-000000000003";

const roleVerification = new Map([
  [users.pending.id, RoleVerificationStatus.PENDING],
  [users.inactive.id, RoleVerificationStatus.VERIFIED],
  [users.active.id, RoleVerificationStatus.VERIFIED],
]);

const membershipFindMany = vi.fn(async ({ where }: {
  where: { userId: string; role?: OrganizationMembershipRole };
}) => {
  if (
    where.userId === users.organizationAdmin.id
    && where.role === OrganizationMembershipRole.ADMIN
  ) {
    return [{
      id: "membership-organization-admin",
      startsAt: new Date("2026-01-01T00:00:00.000Z"),
      endsAt: null,
      organization: { id: "organization-1", name: "한빛초등학교" },
    }];
  }
  if (where.userId !== users.active.id) return [];
  return [{
    id: "membership-active",
    organizationId: "organization-1",
    status: OrganizationMembershipStatus.ACTIVE,
  }];
});

const assignmentFindMany = vi.fn(async ({ where }: { where: { organizationClassId?: string } }) => {
  if (where.organizationClassId === unassignedClassId) return [];
  if (where.organizationClassId === crossOrganizationClassId) {
    return [{
      id: "assignment-cross-organization",
      teacherMembershipId: "membership-active",
      startsAt: new Date("2026-03-01T00:00:00.000Z"),
      endsAt: null,
      teacherMembership: { organizationId: "organization-2" },
      organizationClass: {
        id: crossOrganizationClassId,
        organizationId: "organization-1",
        name: "잘못 연결된 반",
        academicYear: 2026,
        organization: { id: "organization-1", name: "한빛초등학교" },
      },
    }];
  }
  if (where.organizationClassId === assignedClassId) {
    return [{
      id: "assignment-active",
      teacherMembershipId: "membership-active",
      startsAt: new Date("2026-03-01T00:00:00.000Z"),
      endsAt: null,
      teacherMembership: { organizationId: "organization-1" },
      organizationClass: {
        id: assignedClassId,
        organizationId: "organization-1",
        name: "햇살반",
        academicYear: 2026,
        organization: { id: "organization-1", name: "한빛초등학교" },
      },
    }];
  }
  return [{
    startsAt: new Date("2026-03-01T00:00:00.000Z"),
    endsAt: null,
    teacherMembershipId: "membership-active",
    organizationClass: {
      id: assignedClassId,
      organizationId: "organization-1",
      name: "햇살반",
      academicYear: 2026,
      organization: { id: "organization-1", name: "한빛초등학교" },
    },
  },
  {
    startsAt: new Date("2026-03-01T00:00:00.000Z"),
    endsAt: null,
    teacherMembershipId: "membership-active",
    organizationClass: {
      id: crossOrganizationClassId,
      organizationId: "organization-2",
      name: "다른 기관 반",
      academicYear: 2026,
      organization: { id: "organization-2", name: "다른학교" },
    },
  }];
});

const enrollmentFindMany = vi.fn(async () => [
  {
    startsAt: new Date("2026-03-05T00:00:00.000Z"),
    student: { id: "student-2", displayName: "강하늘" },
  },
  {
    startsAt: new Date("2026-03-04T00:00:00.000Z"),
    student: { id: "student-1", displayName: "김바둑" },
  },
]);
const auditCreate = vi.fn(async () => ({ id: "audit-1" }));

const prisma = {
  userRoleAssignment: {
    findUnique: vi.fn(async ({ where }: { where: { userId_role: { userId: string } } }) => {
      const verificationStatus = roleVerification.get(where.userId_role.userId);
      return verificationStatus ? { verificationStatus } : null;
    }),
  },
  organizationMembership: { findMany: membershipFindMany },
  organizationClassTeacherAssignment: { findMany: assignmentFindMany },
  organizationClassEnrollment: { findMany: enrollmentFindMany },
  auditLog: { create: auditCreate },
} as unknown as PrismaService;

const authService = {
  getConfig: () => ({ sessionCookieName: "baduk_session" }),
  authenticate: vi.fn(async (token?: string | null) => {
    if (!token) {
      throw new ApiError("AUTH_REQUIRED", "로그인이 필요합니다.", HttpStatus.UNAUTHORIZED);
    }
    const user = sessionUsers[token];
    if (!user) {
      throw new ApiError("SESSION_INVALID", "세션이 만료되었거나 유효하지 않습니다.", HttpStatus.UNAUTHORIZED);
    }
    return user;
  }),
};

describe("teacher organization class access HTTP API", () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5432/test";
    const moduleRef = await Test.createTestingModule({ imports: [OrganizationModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(AuthService)
      .useValue(authService)
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    const requestId = new RequestIdMiddleware();
    app.use(requestId.use.bind(requestId));
    app.useGlobalFilters(new ApiExceptionFilter());
    app.useGlobalInterceptors(new ApiResponseInterceptor());
    baseUrl = await listenForHttpTest(app);
  });

  afterAll(async () => app?.close());
  beforeEach(() => vi.clearAllMocks());

  it("requires a signed-in instructor role", async () => {
    const signedOut = await fetch(`${baseUrl}/api/v1/teacher/classes`);
    const wrongRole = await fetch(`${baseUrl}/api/v1/teacher/classes`, {
      headers: { cookie: "baduk_session=student" },
    });
    const wrongRoleBody = await wrongRole.json() as { error: { code: string } };

    expect(signedOut.status).toBe(401);
    expect(wrongRole.status).toBe(403);
    expect(wrongRoleBody.error.code).toBe("ROLE_FORBIDDEN");
  });

  it("rejects an instructor whose verification is not complete", async () => {
    const response = await fetch(`${baseUrl}/api/v1/teacher/classes`, {
      headers: { cookie: "baduk_session=pending" },
    });
    const body = await response.json() as { error: { code: string } };

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("INSTRUCTOR_VERIFICATION_REQUIRED");
    expect(membershipFindMany).not.toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ userId: users.pending.id }),
    }));
  });

  it("rejects a verified instructor without an active organization membership", async () => {
    const response = await fetch(`${baseUrl}/api/v1/teacher/classes`, {
      headers: { cookie: "baduk_session=inactive" },
    });
    const body = await response.json() as { error: { code: string } };

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("ORGANIZATION_MEMBERSHIP_REQUIRED");
    expect(membershipFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        userId: users.inactive.id,
        status: OrganizationMembershipStatus.ACTIVE,
      }),
    }));
  });

  it("returns only currently assigned classes in the instructor's active organization", async () => {
    const response = await fetch(`${baseUrl}/api/v1/teacher/classes`, {
      headers: { cookie: "baduk_session=active" },
    });
    const body = await response.json() as {
      data: { items: Array<{ id: string; name: string; organization: { id: string; name: string } }> };
    };

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(body.data.items).toEqual([expect.objectContaining({
      id: assignedClassId,
      name: "햇살반",
      organization: { id: "organization-1", name: "한빛초등학교" },
    })]);
    expect(assignmentFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        teacherMembershipId: { in: ["membership-active"] },
      }),
    }));
  });

  it("requires a signed-in instructor to list class students", async () => {
    const signedOut = await fetch(`${baseUrl}/api/v1/teacher/classes/${assignedClassId}/students`);
    const wrongRole = await fetch(`${baseUrl}/api/v1/teacher/classes/${assignedClassId}/students`, {
      headers: { cookie: "baduk_session=student" },
    });
    const wrongRoleBody = await wrongRole.json() as { error: { code: string } };

    expect(signedOut.status).toBe(401);
    expect(wrongRole.status).toBe(403);
    expect(wrongRoleBody.error.code).toBe("ROLE_FORBIDDEN");
    expect(enrollmentFindMany).not.toHaveBeenCalled();
  });

  it("blocks student data for an unassigned or cross-organization class", async () => {
    const unassigned = await fetch(
      `${baseUrl}/api/v1/teacher/classes/${unassignedClassId}/students`,
      { headers: { cookie: "baduk_session=active" } },
    );
    const crossOrganization = await fetch(
      `${baseUrl}/api/v1/teacher/classes/${crossOrganizationClassId}/students`,
      { headers: { cookie: "baduk_session=active" } },
    );
    const unassignedBody = await unassigned.json() as { error: { code: string } };
    const crossOrganizationBody = await crossOrganization.json() as { error: { code: string } };

    expect(unassigned.status).toBe(403);
    expect(unassignedBody.error.code).toBe("CLASS_STUDENTS_FORBIDDEN");
    expect(crossOrganization.status).toBe(403);
    expect(crossOrganizationBody.error.code).toBe("CLASS_STUDENTS_FORBIDDEN");
    expect(enrollmentFindMany).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it("returns active students only after validating the current class assignment", async () => {
    const response = await fetch(`${baseUrl}/api/v1/teacher/classes/${assignedClassId}/students`, {
      headers: { cookie: "baduk_session=active" },
    });
    const body = await response.json() as {
      data: { class: { id: string; name: string }; items: Array<{ id: string; displayName: string }> };
    };

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toContain("Cookie");
    expect(body.data.class).toEqual(expect.objectContaining({ id: assignedClassId, name: "햇살반" }));
    expect(body.data.items).toEqual([
      expect.objectContaining({ id: "student-2", displayName: "강하늘" }),
      expect.objectContaining({ id: "student-1", displayName: "김바둑" }),
    ]);
    expect(assignmentFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationClassId: assignedClassId,
        teacherMembership: expect.objectContaining({
          userId: users.active.id,
          status: OrganizationMembershipStatus.ACTIVE,
        }),
      }),
    }));
    expect(enrollmentFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationClassId: assignedClassId,
        student: { status: AccountStatus.ACTIVE, deletedAt: null },
      }),
    }));
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        actorId: users.active.id,
        action: "organization.class_students.viewed",
        resourceId: assignedClassId,
      }),
    }));
  });

  it("keeps organization billing permissions hidden from signed-out users and instructors", async () => {
    const signedOut = await fetch(`${baseUrl}/api/v1/organization-admin/organizations`);
    const instructor = await fetch(`${baseUrl}/api/v1/organization-admin/organizations`, {
      headers: { cookie: "baduk_session=active" },
    });
    const instructorBody = await instructor.json() as { error: { code: string } };

    expect(signedOut.status).toBe(401);
    expect(instructor.status).toBe(403);
    expect(instructorBody.error.code).toBe("ROLE_FORBIDDEN");
    expect(membershipFindMany).not.toHaveBeenCalled();
  });

  it("requires an active ADMIN membership after the organization_admin role check", async () => {
    const response = await fetch(`${baseUrl}/api/v1/organization-admin/organizations`, {
      headers: { cookie: "baduk_session=organizationAdminWithoutMembership" },
    });
    const body = await response.json() as { error: { code: string } };

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("ORGANIZATION_ADMIN_MEMBERSHIP_REQUIRED");
    expect(membershipFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        userId: users.organizationAdminWithoutMembership.id,
        role: OrganizationMembershipRole.ADMIN,
        status: OrganizationMembershipStatus.ACTIVE,
      }),
    }));
  });

  it("returns institution-scoped license, seat, and refund-request permissions to active admins", async () => {
    const response = await fetch(`${baseUrl}/api/v1/organization-admin/organizations`, {
      headers: { cookie: "baduk_session=organizationAdmin" },
    });
    const body = await response.json() as {
      data: {
        items: Array<{
          organization: { id: string; name: string };
          permissions: Record<string, string[]>;
        }>;
        paymentExecutionRoles: string[];
      };
    };

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(body.data.items).toEqual([expect.objectContaining({
      organization: { id: "organization-1", name: "한빛초등학교" },
      permissions: {
        license: ["read", "manage"],
        seats: ["read", "manage"],
        refunds: ["read", "request"],
      },
    })]);
    expect(body.data.paymentExecutionRoles).toEqual(["operator", "admin"]);
  });
});
