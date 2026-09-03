import { createHash } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiExceptionFilter } from "../common/api-exception.filter.js";
import { ApiResponseInterceptor } from "../common/api-response.interceptor.js";
import { RequestIdMiddleware } from "../common/request-id.middleware.js";
import { DatabaseModule } from "../database/database.module.js";
import { PrismaService } from "../database/prisma.service.js";
import { AccountMailStatus, InquiryNotificationStatus } from "../generated/prisma/enums.js";
import { listenForHttpTest } from "../test-utils/listen-test-app.js";
import { MailModule } from "./mail.module.js";

const secret = "bounce_webhook_secret_1234567890_abcd";
const accountJob = {
  id: "account-mail-1",
  messageId: "<account-mail@example.com>",
  status: AccountMailStatus.SENT,
  token: { userId: "user-1" },
};
const inquiryJob = {
  id: "inquiry-mail-1",
  inquiryId: "inquiry-1",
  requestedById: "operator-1",
  messageId: "<inquiry-mail@example.com>",
  status: InquiryNotificationStatus.SENT,
};
const auditCreate = vi.fn(async () => ({ id: "audit-1" }));
const accountUpdateMany = vi.fn(async ({ where, data }: Record<string, any>) => {
  if (accountJob.id !== where.id || accountJob.status !== where.status) return { count: 0 };
  Object.assign(accountJob, data);
  return { count: 1 };
});
const inquiryUpdateMany = vi.fn(async ({ where, data }: Record<string, any>) => {
  if (inquiryJob.id !== where.id || inquiryJob.status !== where.status) return { count: 0 };
  Object.assign(inquiryJob, data);
  return { count: 1 };
});
const prisma = {
  accountMailJob: {
    findFirst: vi.fn(async ({ where }: Record<string, any>) => (
      accountJob.messageId === where.messageId ? accountJob : null
    )),
    updateMany: accountUpdateMany,
  },
  inquiryNotificationJob: {
    findFirst: vi.fn(async ({ where }: Record<string, any>) => (
      inquiryJob.messageId === where.messageId ? inquiryJob : null
    )),
    updateMany: inquiryUpdateMany,
  },
  auditLog: { create: auditCreate },
  $transaction: vi.fn(async (operation: (transaction: unknown) => Promise<unknown>) => operation(prisma)),
} as unknown as PrismaService;

describe("mail permanent bounce webhook", () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5432/test";
    process.env.MAIL_BOUNCE_WEBHOOK_SECRET = secret;
    const moduleRef = await Test.createTestingModule({ imports: [DatabaseModule, MailModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
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
  beforeEach(() => {
    vi.clearAllMocks();
    accountJob.status = AccountMailStatus.SENT;
    inquiryJob.status = InquiryNotificationStatus.SENT;
  });

  const eventId = "provider-event-2026-08-31-001";
  const eventIdSha256 = createHash("sha256").update(eventId).digest("hex");
  const send = (messageId: string, authorization = `Bearer ${secret}`, providerEventId = eventId) => fetch(
    `${baseUrl}/api/v1/mail/webhooks/bounce`,
    {
      method: "POST",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify({ event: "permanent_bounce", eventId: providerEventId, messageId, privateReason: "do not store" }),
    },
  );

  it("rejects an unauthenticated webhook before looking up delivery data", async () => {
    const response = await send(accountJob.messageId, "Bearer wrong-secret-with-enough-length-000");
    const body = await response.json() as { error: { code: string } };

    expect(response.status).toBe(401);
    expect(body.error.code).toBe("MAIL_BOUNCE_UNAUTHORIZED");
    expect(prisma.accountMailJob.findFirst).not.toHaveBeenCalled();
  });

  it("marks account mail permanently bounced and handles duplicate delivery idempotently", async () => {
    const first = await send(accountJob.messageId);
    const firstBody = await first.json() as { data: { accepted: boolean; action: string } };
    const repeated = await send(accountJob.messageId);
    const repeatedBody = await repeated.json() as { data: { action: string } };

    expect(first.status).toBe(200);
    expect(firstBody.data).toEqual({
      accepted: true, action: "bounced", auditLogId: "audit-1", eventIdSha256,
    });
    expect(accountJob.status).toBe(AccountMailStatus.BOUNCED);
    expect(repeatedBody.data.action).toBe("unchanged");
    expect(repeatedBody.data).toMatchObject({ auditLogId: null, eventIdSha256 });
    expect(auditCreate).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(auditCreate.mock.calls)).not.toContain("do not store");
    expect(JSON.stringify(auditCreate.mock.calls)).not.toContain(eventId);
    expect(JSON.stringify(auditCreate.mock.calls)).toContain(eventIdSha256);
  });

  it("marks inquiry notification mail bounced without exposing unknown message IDs", async () => {
    const bounced = await send(inquiryJob.messageId);
    const unknown = await send("<unknown@example.com>");
    const unknownBody = await unknown.json() as { data: { accepted: boolean; action: string } };

    expect(bounced.status).toBe(200);
    expect(inquiryJob.status).toBe(InquiryNotificationStatus.BOUNCED);
    expect(unknown.status).toBe(200);
    expect(unknownBody.data).toEqual({ accepted: true, action: "unknown", auditLogId: null, eventIdSha256 });
  });

  it("rejects a bounce without a stable provider event ID", async () => {
    const response = await send(accountJob.messageId, `Bearer ${secret}`, "recipient@example.com");
    const body = await response.json() as { error: { code: string } };
    expect(response.status).toBe(400);
    expect(body.error.code).toBe("MAIL_BOUNCE_INVALID");
    expect(prisma.accountMailJob.findFirst).not.toHaveBeenCalled();
  });
});
