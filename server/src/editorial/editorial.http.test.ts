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
import {
  AccountStatus,
  EditorialContentStatus,
  EditorialContentType,
  RoleType,
} from "../generated/prisma/enums.js";

const operator = account("00000000-0000-0000-0000-000000000701", RoleType.OPERATOR);
const student = account("00000000-0000-0000-0000-000000000702", RoleType.STUDENT);

function account(id: string, role: RoleType) {
  return {
    id,
    email: `${role.toLowerCase()}@example.test`,
    displayName: role === RoleType.OPERATOR ? "콘텐츠 운영자" : "콘텐츠 학생",
    passwordHash: null,
    emailVerifiedAt: new Date(),
    status: AccountStatus.ACTIVE,
    roles: [{ role }],
  };
}

function createPrismaMock() {
  const records: Array<Record<string, any>> = [
    editorial({
      id: "notice-public",
      type: EditorialContentType.NOTICE,
      category: "서비스",
      title: "공개 공지",
      content: "현재 공개 중인 공지입니다.",
      status: EditorialContentStatus.PUBLISHED,
      isPinned: true,
      publishedAt: new Date("2026-08-20T00:00:00.000Z"),
    }),
    editorial({
      id: "notice-future",
      type: EditorialContentType.NOTICE,
      category: "점검",
      title: "예약 공지",
      content: "아직 공개되면 안 됩니다.",
      status: EditorialContentStatus.PUBLISHED,
      publishedAt: new Date("2100-01-01T00:00:00.000Z"),
    }),
  ];
  const auditCreate = vi.fn(async () => ({ id: "editorial-audit" }));
  const matches = (record: Record<string, any>, where: Record<string, any>) => {
    if (where.type && record.type !== where.type) return false;
    if (where.status && record.status !== where.status) return false;
    if (where.category && record.category !== where.category) return false;
    if (where.publishedAt?.lte && (!record.publishedAt || record.publishedAt > where.publishedAt.lte)) return false;
    if (where.OR && !where.OR.some((condition: Record<string, any>) => Object.entries(condition).some(
      ([field, filter]) => String(record[field]).toLowerCase().includes(String(filter.contains).toLowerCase()),
    ))) return false;
    return true;
  };
  const editorialContent = {
    findMany: vi.fn(async ({ where, orderBy, skip = 0, take = 50 }: {
      where: Record<string, any>; orderBy: Array<Record<string, string>>; skip?: number; take?: number;
    }) => {
      const filtered = records.filter((record) => matches(record, where));
      filtered.sort((left, right) => {
        for (const order of orderBy) {
          const [field, direction] = Object.entries(order)[0] ?? [];
          if (!field || left[field] === right[field]) continue;
          const comparison = left[field] == null ? 1 : right[field] == null ? -1 : left[field] < right[field] ? -1 : 1;
          return direction === "asc" ? comparison : -comparison;
        }
        return 0;
      });
      return filtered.slice(skip, skip + take);
    }),
    count: vi.fn(async ({ where }: { where: Record<string, any> }) => records.filter((record) => matches(record, where)).length),
    findFirst: vi.fn(async ({ where }: { where: Record<string, any> }) => records.find((record) => matches(record, where)) ?? null),
    create: vi.fn(async ({ data }: { data: Record<string, any> }) => {
      const record = editorial({ id: `editorial-${records.length + 1}`, ...data });
      records.push(record);
      return record;
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, any> }) => {
      const record = records.find((item) => item.id === where.id);
      if (!record) throw new Error("editorial content missing");
      Object.assign(record, data, { updatedAt: new Date() });
      return record;
    }),
  };
  const sessions = new Map([
    [hashSessionToken("editorial-operator"), operator],
    [hashSessionToken("editorial-student"), student],
  ]);
  const prisma = {
    editorialContent,
    auditLog: { create: auditCreate },
    session: {
      findUnique: vi.fn(async ({ where }: { where: { tokenHash: string } }) => {
        const user = sessions.get(where.tokenHash);
        return user ? {
          id: `session-${user.id}`,
          userId: user.id,
          expiresAt: new Date(Date.now() + 60_000),
          revokedAt: null,
          user,
        } : null;
      }),
    },
    isReady: vi.fn(async () => true),
    $transaction: vi.fn(async (operation: (transaction: unknown) => unknown) => operation(prisma)),
  };
  return { prisma: prisma as unknown as PrismaService, records, auditCreate };
}

function editorial(overrides: Record<string, any>) {
  const now = new Date("2026-08-24T00:00:00.000Z");
  return {
    type: EditorialContentType.NOTICE,
    category: "서비스",
    title: "게시글",
    content: "게시글 내용",
    status: EditorialContentStatus.DRAFT,
    isPinned: false,
    displayOrder: null,
    publishedAt: null,
    createdById: operator.id,
    updatedById: operator.id,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("editorial content HTTP flow", () => {
  let app: INestApplication;
  let baseUrl: string;
  const state = createPrismaMock();

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5432/test";
    process.env.SESSION_COOKIE_NAME = "baduk_session";
    delete process.env.RATE_LIMIT_REDIS_URL;
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
    baseUrl = await listenForHttpTest(app);
  });

  afterAll(async () => app.close());

  it("shows only currently published content on public endpoints", async () => {
    const response = await fetch(`${baseUrl}/api/v1/notices`);
    const payload = await response.json() as any;
    expect(response.status, JSON.stringify(payload)).toBe(200);
    expect(payload.data.items).toHaveLength(1);
    expect(payload.data.items[0]).toMatchObject({
      id: "notice-public", title: "공개 공지", status: "published", authorLabel: "운영자", isPinned: true,
    });
    expect(payload.data.items[0]).not.toHaveProperty("createdById");
    expect(payload.data.items[0]).not.toHaveProperty("updatedById");
  });

  it("requires operator access and validates notice input", async () => {
    const request = (cookie?: string, body: Record<string, unknown> = {}) => fetch(`${baseUrl}/api/v1/admin/notices`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-requested-with": "XMLHttpRequest",
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify({
        category: "콘텐츠",
        title: "새 강의 공개 안내",
        content: "새로운 강의가 공개되었습니다.",
        publishedAt: "2020-01-01",
        isPinned: false,
        attachment: "",
        ...body,
      }),
    });
    expect((await request()).status).toBe(401);
    expect((await request("baduk_session=editorial-student")).status).toBe(403);
    const invalidDate = await request("baduk_session=editorial-operator", { publishedAt: "2026-02-31" });
    expect(invalidDate.status).toBe(400);
    expect((await invalidDate.json() as any).error.code).toBe("EDITORIAL_CONTENT_INVALID");
    const attachment = await request("baduk_session=editorial-operator", { attachment: "notice.pdf" });
    expect(attachment.status).toBe(400);
    expect((await attachment.json() as any).error.code).toBe("EDITORIAL_ATTACHMENT_NOT_SUPPORTED");

    const created = await request("baduk_session=editorial-operator");
    const createdPayload = await created.json() as any;
    expect(created.status, JSON.stringify(createdPayload)).toBe(201);
    expect(createdPayload.data.item).toMatchObject({ title: "새 강의 공개 안내", status: "published" });
    const publicList = await fetch(`${baseUrl}/api/v1/notices?category=${encodeURIComponent("콘텐츠")}`);
    expect((await publicList.json() as any).data.items).toHaveLength(1);
    expect(state.auditCreate).toHaveBeenLastCalledWith({
      data: expect.objectContaining({
        action: "editorial.notice.created",
        metadata: { type: "notice", category: "콘텐츠", status: "published" },
      }),
    });
    expect(JSON.stringify(state.auditCreate.mock.calls.at(-1))).not.toContain("새로운 강의가 공개되었습니다");
  });

  it("keeps FAQ drafts private, publishes them, and archives instead of deleting", async () => {
    const headers = {
      "content-type": "application/json",
      "x-requested-with": "XMLHttpRequest",
      cookie: "baduk_session=editorial-operator",
    };
    const created = await fetch(`${baseUrl}/api/v1/admin/faqs`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        category: "학습",
        title: "학습 기록은 어디에 저장되나요?",
        content: "로그인 계정에 안전하게 저장됩니다.",
        displayOrder: 2,
        isPublished: false,
      }),
    });
    const createdPayload = await created.json() as any;
    expect(created.status, JSON.stringify(createdPayload)).toBe(201);
    expect(createdPayload.data.item.status).toBe("draft");
    expect((await (await fetch(`${baseUrl}/api/v1/faqs`)).json() as any).data.items).toHaveLength(0);

    const faqId = createdPayload.data.item.id;
    const published = await fetch(`${baseUrl}/api/v1/admin/faqs/${faqId}`, {
      method: "PATCH", headers, body: JSON.stringify({ isPublished: true }),
    });
    expect((await published.json() as any).data.item.status).toBe("published");
    expect((await (await fetch(`${baseUrl}/api/v1/faqs`)).json() as any).data.items[0]).toMatchObject({
      id: faqId, displayOrder: 2, status: "published",
    });

    const archived = await fetch(`${baseUrl}/api/v1/admin/faqs/${faqId}`, { method: "DELETE", headers });
    expect((await archived.json() as any).data.item.status).toBe("archived");
    expect((await (await fetch(`${baseUrl}/api/v1/faqs`)).json() as any).data.items).toHaveLength(0);
    const adminList = await fetch(`${baseUrl}/api/v1/admin/faqs?status=archived`, {
      headers: { cookie: "baduk_session=editorial-operator" },
    });
    expect((await adminList.json() as any).data.items).toHaveLength(1);
  });
});
