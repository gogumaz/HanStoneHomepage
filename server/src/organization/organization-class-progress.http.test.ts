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
import { LessonStatus, RoleVerificationStatus } from "../generated/prisma/enums.js";
import { listenForHttpTest } from "../test-utils/listen-test-app.js";
import { OrganizationAccessService } from "./organization-access.service.js";
import { OrganizationController } from "./organization.controller.js";

const classId = "40000000-0000-4000-8000-000000000001";
const otherClassId = "40000000-0000-4000-8000-000000000002";
const users = {
  teacher: {
    id: "teacher-progress", email: "teacher@example.test", emailVerified: true,
    displayName: "담당 지도자", roles: ["instructor"],
  },
  student: {
    id: "student-progress", email: "student@example.test", emailVerified: true,
    displayName: "학생", roles: ["student"],
  },
} satisfies Record<string, CurrentUser>;
const organizationClass = {
  id: classId,
  organizationId: "organization-1",
  name: "햇살반",
  academicYear: 2026,
  organization: { id: "organization-1", name: "한빛초등학교" },
};
const lessons = [{
  id: "PRE-01",
  status: LessonStatus.PUBLISHED,
  order: 1,
  course: "입문 1권",
  title: "주먹도끼에서 배운 첫 수",
  durationMinutes: 8,
  era: { id: "era_prehistoric", name: "선사시대", order: 1 },
}];
let storedSetting: null | { updatedAt: Date; currentLesson: typeof lessons[number] };
const progressFindUnique = vi.fn(async () => storedSetting);
const progressUpsert = vi.fn(async () => ({
  organizationClassId: classId,
  currentLessonId: lessons[0]!.id,
  updatedByUserId: users.teacher.id,
  updatedAt: new Date("2026-09-13T05:00:00.000Z"),
}));
const progressDeleteMany = vi.fn(async () => ({ count: storedSetting ? 1 : 0 }));
const auditCreate = vi.fn(async () => ({ id: "audit-progress" }));
const assignmentFindMany = vi.fn(async ({ where }: { where: { organizationClassId?: string } }) => (
  where.organizationClassId === classId ? [{
    id: "assignment-progress",
    organizationClass,
    teacherMembership: { organizationId: "organization-1" },
  }] : []
));
const transaction = {
  organizationClassProgressSetting: { upsert: progressUpsert, deleteMany: progressDeleteMany },
  auditLog: { create: auditCreate },
};
const prisma = {
  userRoleAssignment: { findUnique: vi.fn(async () => ({ verificationStatus: RoleVerificationStatus.VERIFIED })) },
  organizationClassTeacherAssignment: { findMany: assignmentFindMany },
  organizationClassProgressSetting: { findUnique: progressFindUnique },
  lesson: {
    findMany: vi.fn(async () => lessons),
    findFirst: vi.fn(async ({ where }: { where: { id: string } }) => (
      where.id === lessons[0]!.id ? lessons[0]! : null
    )),
  },
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

describe("organization class progress setting HTTP API", () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5432/test";
    const moduleRef = await Test.createTestingModule({
      controllers: [OrganizationController],
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
    storedSetting = { updatedAt: new Date("2026-09-13T04:00:00.000Z"), currentLesson: lessons[0]! };
  });

  it("returns the current target and published lesson choices only to an assigned instructor", async () => {
    const wrongRole = await fetch(`${baseUrl}/api/v1/teacher/classes/${classId}/progress-setting`, {
      headers: { cookie: "baduk_session=student" },
    });
    const unassigned = await fetch(`${baseUrl}/api/v1/teacher/classes/${otherClassId}/progress-setting`, {
      headers: { cookie: "baduk_session=teacher" },
    });
    const response = await fetch(`${baseUrl}/api/v1/teacher/classes/${classId}/progress-setting`, {
      headers: { cookie: "baduk_session=teacher" },
    });
    const body = await response.json() as { data: { progressSetting: {
      currentLesson: { id: string }; availableLessons: Array<{ id: string }>;
    } } };

    expect(wrongRole.status).toBe(403);
    expect(unassigned.status).toBe(403);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(body.data.progressSetting.currentLesson.id).toBe("PRE-01");
    expect(body.data.progressSetting.availableLessons).toEqual([expect.objectContaining({ id: "PRE-01" })]);
  });

  it("sets a published lesson as the class target and records an audit event", async () => {
    const response = await fetch(`${baseUrl}/api/v1/teacher/classes/${classId}/progress-setting`, {
      method: "PUT",
      headers: { cookie: "baduk_session=teacher", "content-type": "application/json" },
      body: JSON.stringify({ lessonId: "PRE-01" }),
    });
    const body = await response.json() as { data: { progressSetting: { currentLesson: { id: string } } } };

    expect(response.status).toBe(200);
    expect(body.data.progressSetting.currentLesson.id).toBe("PRE-01");
    expect(progressUpsert).toHaveBeenCalledWith(expect.objectContaining({
      update: { currentLessonId: "PRE-01", updatedByUserId: users.teacher.id },
    }));
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      action: "organization.class_progress_setting.updated",
      metadata: { currentLessonId: "PRE-01" },
    }) }));
  });

  it("rejects an unknown or unpublished lesson before writing", async () => {
    const response = await fetch(`${baseUrl}/api/v1/teacher/classes/${classId}/progress-setting`, {
      method: "PUT",
      headers: { cookie: "baduk_session=teacher", "content-type": "application/json" },
      body: JSON.stringify({ lessonId: "DRAFT-01" }),
    });
    const body = await response.json() as { error: { code: string } };

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("CLASS_PROGRESS_LESSON_INVALID");
    expect(progressUpsert).not.toHaveBeenCalled();
  });

  it("clears the class target without deleting learning history", async () => {
    const response = await fetch(`${baseUrl}/api/v1/teacher/classes/${classId}/progress-setting`, {
      method: "PUT",
      headers: { cookie: "baduk_session=teacher", "content-type": "application/json" },
      body: JSON.stringify({ lessonId: null }),
    });
    const body = await response.json() as { data: { progressSetting: { currentLesson: null } } };

    expect(response.status).toBe(200);
    expect(body.data.progressSetting.currentLesson).toBeNull();
    expect(progressDeleteMany).toHaveBeenCalledWith({ where: { organizationClassId: classId } });
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      action: "organization.class_progress_setting.cleared",
      metadata: {},
    }) }));
  });
});
