import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "../app.module.js";
import { hashSessionToken } from "../auth/session-cookie.js";
import { ApiExceptionFilter } from "../common/api-exception.filter.js";
import { ApiResponseInterceptor } from "../common/api-response.interceptor.js";
import { RequestIdMiddleware } from "../common/request-id.middleware.js";
import { PrismaService } from "../database/prisma.service.js";
import { listenForHttpTest } from "../test-utils/listen-test-app.js";
import { AccountStatus, ConsultationStatus, RoleType } from "../generated/prisma/enums.js";
import { CONSULTATION_PRIVACY_VERSION } from "./consultation.types.js";

const user = {
  id: "00000000-0000-0000-0000-000000000301",
  email: "consultation@example.test",
  displayName: "상담 신청자",
  passwordHash: null,
  emailVerifiedAt: new Date(),
  status: AccountStatus.ACTIVE,
  roles: [{ role: RoleType.ORGANIZATION_ADMIN }],
};

const operator = {
  ...user,
  id: "00000000-0000-0000-0000-000000000302",
  email: "operator@example.test",
  displayName: "상담 운영자",
  roles: [{ role: RoleType.OPERATOR }],
};

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    category: "학교",
    organizationName: "한빛초등학교",
    contactName: "홍길동",
    phone: "010-1234-5678",
    email: "teacher@example.test",
    expectedStudents: 30,
    title: "방과후 수업 도입 문의",
    content: "다음 학기 방과후 바둑 수업 도입을 상담하고 싶습니다.",
    privacyConsent: true,
    ...overrides,
  };
}

function createPrismaMock() {
  const records: Array<Record<string, any>> = [];
  const auditCreate = vi.fn(async () => ({ id: "audit-consultation" }));
  const consultation = {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const created = {
        id: `00000000-0000-0000-0000-${String(records.length + 1).padStart(12, "0")}`,
        ...data,
        status: ConsultationStatus.SUBMITTED,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      records.push(created);
      return created;
    }),
    findMany: vi.fn(async ({ where, skip = 0, take }: { where: Record<string, any>; skip?: number; take?: number }) => {
      const filtered = records.filter((record) => matchesWhere(record, where));
      filtered.sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
      return filtered.slice(skip, take === undefined ? undefined : skip + take);
    }),
    count: vi.fn(async ({ where }: { where: Record<string, any> }) => records.filter((record) => matchesWhere(record, where)).length),
    groupBy: vi.fn(async () => Object.values(ConsultationStatus).map((status) => ({
      status,
      _count: { _all: records.filter((record) => record.status === status).length },
    }))),
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => records.find((record) => record.id === where.id) ?? null),
    update: vi.fn(async ({ where, data }: { where: { id: string; status?: ConsultationStatus }; data: { status: ConsultationStatus } }) => {
      const record = records.find((item) => item.id === where.id && (!where.status || item.status === where.status));
      if (!record) throw new Error("record changed");
      Object.assign(record, data, { updatedAt: new Date() });
      return record;
    }),
  };
  const prisma = {
    consultation,
    auditLog: { create: auditCreate },
    session: {
      findUnique: vi.fn(async ({ where }: { where: { tokenHash: string } }) => {
        const sessionUser = where.tokenHash === hashSessionToken("consultation-session")
          ? user
          : where.tokenHash === hashSessionToken("consultation-operator-session")
            ? operator
            : null;
        return sessionUser
          ? {
              id: `session-${sessionUser.id}`,
              userId: sessionUser.id,
              expiresAt: new Date(Date.now() + 60_000),
              revokedAt: null,
              user: sessionUser,
            }
          : null;
      }),
    },
    isReady: vi.fn(async () => true),
    $transaction: vi.fn(async (operation: (transaction: unknown) => unknown) => operation(prisma)),
  };
  return { prisma: prisma as unknown as PrismaService, raw: prisma, records, auditCreate };
}

function matchesWhere(record: Record<string, any>, where: Record<string, any>) {
  if (where.requesterUserId && record.requesterUserId !== where.requesterUserId) return false;
  if (where.status && record.status !== where.status) return false;
  if (where.category && record.category !== where.category) return false;
  if (where.OR) {
    return where.OR.some((condition: Record<string, any>) => Object.entries(condition).some(([field, filter]) =>
      String(record[field] ?? "").toLowerCase().includes(String(filter.contains ?? "").toLowerCase())));
  }
  return true;
}

describe("consultation HTTP flow", () => {
  let app: INestApplication;
  let baseUrl: string;
  const state = createPrismaMock();

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5432/test";
    process.env.SESSION_COOKIE_NAME = "baduk_session";
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(state.prisma)
      .compile();
    app = moduleRef.createNestApplication();
    app.getHttpAdapter().getInstance().set("trust proxy", 1);
    app.setGlobalPrefix("api/v1");
    const requestId = new RequestIdMiddleware();
    app.use(requestId.use.bind(requestId));
    app.useGlobalFilters(new ApiExceptionFilter());
    app.useGlobalInterceptors(new ApiResponseInterceptor());
    baseUrl = await listenForHttpTest(app);
  });

  afterAll(async () => app.close());

  it("stores server-owned consent evidence and returns a PII-free receipt", async () => {
    const response = await fetch(`${baseUrl}/api/v1/consultations`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.10" },
      body: JSON.stringify(validBody()),
    });
    const payload = await response.json() as { data: Record<string, unknown> };

    expect(response.status).toBe(201);
    expect(response.headers.get("ratelimit-limit")).toBe("5");
    expect(payload.data).toMatchObject({ status: "submitted" });
    expect(payload.data).not.toHaveProperty("phone");
    expect(payload.data).not.toHaveProperty("email");
    expect(state.records[0]).toMatchObject({
      privacyConsentVersion: CONSULTATION_PRIVACY_VERSION,
      requesterUserId: null,
    });
    expect(state.records[0]?.privacyConsentedAt).toBeInstanceOf(Date);
    expect(state.auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "consultation.submitted",
        metadata: expect.not.objectContaining({ phone: expect.anything(), email: expect.anything() }),
      }),
    });
  });

  it("rejects unknown fields and missing privacy consent", async () => {
    const unknownField = await fetch(`${baseUrl}/api/v1/consultations`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.11" },
      body: JSON.stringify(validBody({ isAdmin: true })),
    });
    expect(unknownField.status).toBe(400);
    expect((await unknownField.json() as any).error.code).toBe("CONSULTATION_INPUT_INVALID");

    const missingConsent = await fetch(`${baseUrl}/api/v1/consultations`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.12" },
      body: JSON.stringify(validBody({ privacyConsent: false })),
    });
    expect(missingConsent.status).toBe(400);
    expect((await missingConsent.json() as any).error.code).toBe("CONSULTATION_PRIVACY_CONSENT_REQUIRED");
  });

  it("limits public submissions to five per IP and emits retry headers", async () => {
    const requests = [];
    for (let index = 0; index < 6; index += 1) {
      requests.push(await fetch(`${baseUrl}/api/v1/consultations`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.13" },
        body: JSON.stringify(validBody({ title: `도입 상담 문의 ${index + 1}` })),
      }));
    }
    expect(requests.slice(0, 5).every((response) => response.status === 201)).toBe(true);
    expect(requests[5]?.status).toBe(429);
    expect(requests[5]?.headers.get("retry-after")).toBeTruthy();
    expect((await requests[5]!.json() as any).error.code).toBe("CONSULTATION_RATE_LIMITED");
  });

  it("lists only the authenticated requester's consultations", async () => {
    await fetch(`${baseUrl}/api/v1/consultations`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "198.51.100.14",
        cookie: "baduk_session=consultation-session",
      },
      body: JSON.stringify(validBody({ title: "로그인 사용자 상담" })),
    });
    const response = await fetch(`${baseUrl}/api/v1/me/consultations`, {
      headers: { cookie: "baduk_session=consultation-session" },
    });
    const payload = await response.json() as { data: { items: Array<Record<string, unknown>> } };
    expect(response.status).toBe(200);
    expect(payload.data.items).toHaveLength(1);
    expect(payload.data.items[0]).toMatchObject({ title: "로그인 사용자 상담", status: "submitted" });
  });

  it("restricts the admin queue to operators and validates filters", async () => {
    expect((await fetch(`${baseUrl}/api/v1/admin/consultations`)).status).toBe(401);
    expect((await fetch(`${baseUrl}/api/v1/admin/consultations`, {
      headers: { cookie: "baduk_session=consultation-session" },
    })).status).toBe(403);

    const invalid = await fetch(`${baseUrl}/api/v1/admin/consultations?pageSize=1000`, {
      headers: { cookie: "baduk_session=consultation-operator-session" },
    });
    expect(invalid.status).toBe(400);
    expect((await invalid.json() as any).error.code).toBe("CONSULTATION_PAGINATION_INVALID");

    const response = await fetch(`${baseUrl}/api/v1/admin/consultations?status=submitted&category=${encodeURIComponent("학교")}&q=${encodeURIComponent("로그인 사용자")}&page=1&pageSize=20`, {
      headers: { cookie: "baduk_session=consultation-operator-session" },
    });
    const payload = await response.json() as { data: { items: Array<Record<string, unknown>>; pagination: { total: number } } };
    expect(response.status).toBe(200);
    expect(payload.data.pagination.total).toBe(1);
    expect(payload.data.items[0]).toMatchObject({ phone: "010-1234-5678", status: "submitted" });
  });

  it("changes status through the allowed workflow and records a PII-free audit", async () => {
    const target = state.records.find((record) => record.requesterUserId === user.id)!;
    const headers = {
      "content-type": "application/json",
      cookie: "baduk_session=consultation-operator-session",
    };
    const invalid = await fetch(`${baseUrl}/api/v1/admin/consultations/${target.id}/status`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ status: "contacted" }),
    });
    expect(invalid.status).toBe(409);
    expect((await invalid.json() as any).error.code).toBe("CONSULTATION_STATUS_TRANSITION_INVALID");

    const review = await fetch(`${baseUrl}/api/v1/admin/consultations/${target.id}/status`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ status: "in_review" }),
    });
    expect(review.status).toBe(200);
    expect((await review.json() as any).data.consultation.status).toBe("in_review");
    expect(state.auditCreate).toHaveBeenLastCalledWith({
      data: expect.objectContaining({
        actorId: operator.id,
        action: "consultation.status_changed",
        metadata: { previousStatus: "submitted", status: "in_review" },
      }),
    });
    expect(JSON.stringify(state.auditCreate.mock.calls.at(-1))).not.toContain("010-1234-5678");

    const detail = await fetch(`${baseUrl}/api/v1/admin/consultations/${target.id}`, {
      headers: { cookie: "baduk_session=consultation-operator-session" },
    });
    expect(detail.status).toBe(200);
    expect((await detail.json() as any).data.consultation.status).toBe("in_review");
  });
});
