import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "../app.module.js";
import { hashSessionToken } from "../auth/session-cookie.js";
import { ApiExceptionFilter } from "../common/api-exception.filter.js";
import { ApiResponseInterceptor } from "../common/api-response.interceptor.js";
import { RequestIdMiddleware } from "../common/request-id.middleware.js";
import { PrismaService } from "../database/prisma.service.js";
import { AccountStatus, InquiryNotificationStatus, InquiryStatus, RoleType } from "../generated/prisma/enums.js";
import { InquiryAttachmentStatus } from "../generated/prisma/enums.js";
import { MalwareScannerService } from "../storage/malware-scanner.service.js";
import { ObjectStorageService } from "../storage/object-storage.service.js";

const student = account("00000000-0000-0000-0000-000000000401", RoleType.STUDENT);
const otherStudent = account("00000000-0000-0000-0000-000000000402", RoleType.STUDENT);
const operator = account("00000000-0000-0000-0000-000000000403", RoleType.OPERATOR);

function account(id: string, role: RoleType) {
  return {
    id,
    email: `${role.toLowerCase()}-${id.slice(-3)}@example.test`,
    displayName: role === RoleType.OPERATOR ? "문의 운영자" : "문의 학생",
    passwordHash: null,
    emailVerifiedAt: new Date(),
    status: AccountStatus.ACTIVE,
    roles: [{ role }],
  };
}

function body(overrides: Record<string, unknown> = {}) {
  return {
    category: "학습",
    title: "강의 진도 문의",
    content: "완료한 강의의 진도가 반영되지 않아 확인을 요청합니다.",
    attachment: "",
    ...overrides,
  };
}

function createPrismaMock() {
  const records: Array<Record<string, any>> = [];
  const notificationJobs: Array<Record<string, any>> = [];
  const userNotifications: Array<Record<string, any>> = [];
  const attachments: Array<Record<string, any>> = [];
  const auditCreate = vi.fn(async () => ({ id: "audit-inquiry" }));
  const inquiry = {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const created = {
        id: `00000000-0000-0000-0000-${String(records.length + 501).padStart(12, "0")}`,
        ...data,
        status: InquiryStatus.SUBMITTED,
        answer: null,
        answeredById: null,
        answeredAt: null,
        answerVersion: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      records.push(created);
      return created;
    }),
    findMany: vi.fn(async ({ where, skip = 0, take }: { where: Record<string, any>; skip?: number; take?: number }) => {
      const filtered = records.filter((record) => {
        if (where.requesterUserId && record.requesterUserId !== where.requesterUserId) return false;
        if (where.status && record.status !== where.status) return false;
        if (where.category && record.category !== where.category) return false;
        if (where.OR) return where.OR.some((condition: Record<string, any>) => Object.entries(condition).some(
          ([field, filter]) => String(record[field] ?? "").toLowerCase().includes(String(filter.contains).toLowerCase()),
        ));
        return true;
      });
      return filtered.slice(skip, take === undefined ? undefined : skip + take);
    }),
    count: vi.fn(async ({ where }: { where: Record<string, any> }) => records.filter((record) =>
      (!where.status || record.status === where.status) && (!where.category || record.category === where.category)).length),
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => records.find((record) => record.id === where.id) ?? null),
    update: vi.fn(async ({ where, data }: { where: { id: string; status?: InquiryStatus }; data: Record<string, unknown> }) => {
      const record = records.find((item) => item.id === where.id && (!where.status || item.status === where.status));
      if (!record) throw new Error("record changed");
      const { answerVersion, ...values } = data;
      Object.assign(record, values, { updatedAt: new Date() });
      if (answerVersion && typeof answerVersion === "object" && "increment" in answerVersion) {
        record.answerVersion += Number(answerVersion.increment);
      }
      return record;
    }),
  };
  const sessions = new Map([
    [hashSessionToken("inquiry-student"), student],
    [hashSessionToken("inquiry-other"), otherStudent],
    [hashSessionToken("inquiry-operator"), operator],
  ]);
  const prisma = {
    inquiry,
    inquiryNotificationJob: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const now = new Date();
        const job = {
          id: `notification-${notificationJobs.length + 1}`,
          ...data,
          status: InquiryNotificationStatus.PENDING,
          attempts: 0,
          nextAttemptAt: now,
          lockedAt: null,
          completedAt: null,
          messageId: null,
          lastError: null,
          createdAt: now,
          updatedAt: now,
        };
        notificationJobs.push(job);
        return job;
      }),
      findMany: vi.fn(async ({ where }: { where: { inquiryId: string } }) => notificationJobs
        .filter((job) => job.inquiryId === where.inquiryId)
        .sort((left, right) => right.answerVersion - left.answerVersion)),
      findUnique: vi.fn(async ({ where, include }: { where: { id: string }; include?: { inquiry?: boolean } }) => {
        const job = notificationJobs.find((item) => item.id === where.id);
        if (!job) return null;
        return include?.inquiry
          ? { ...job, inquiry: records.find((record) => record.id === job.inquiryId) }
          : job;
      }),
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => {
        const job = notificationJobs.find((item) => item.id === where.id);
        if (!job) throw new Error("notification job missing");
        return job;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const job = notificationJobs.find((item) => Object.entries(where).every(([key, value]) => item[key] === value));
        if (!job) return { count: 0 };
        Object.assign(job, data, { updatedAt: new Date() });
        return { count: 1 };
      }),
    },
    inquiryAttachment: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const attachment = {
          ...data,
          inquiryId: null,
          status: InquiryAttachmentStatus.QUARANTINED,
          scanProvider: null,
          scanResult: null,
          scannedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        attachments.push(attachment);
        return attachment;
      }),
      findFirst: vi.fn(async ({ where }: { where: Record<string, any> }) => attachments.find((item) =>
        Object.entries(where).every(([key, value]) => item[key] === value)) ?? null),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const attachment = attachments.find((item) => item.id === where.id);
        if (!attachment) throw new Error("attachment missing");
        Object.assign(attachment, data, { updatedAt: new Date() });
        return attachment;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, any>; data: Record<string, unknown> }) => {
        const attachment = attachments.find((item) => Object.entries(where).every(([key, value]) => item[key] === value));
        if (!attachment) return { count: 0 };
        Object.assign(attachment, data, { updatedAt: new Date() });
        return { count: 1 };
      }),
    },
    userNotification: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const notification = { id: `user-notification-${userNotifications.length + 1}`, ...data };
        userNotifications.push(notification);
        return notification;
      }),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
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
  return { prisma: prisma as unknown as PrismaService, records, notificationJobs, userNotifications, attachments, auditCreate };
}

describe("private inquiry HTTP flow", () => {
  let app: INestApplication;
  let baseUrl: string;
  const state = createPrismaMock();

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5432/test";
    process.env.SESSION_COOKIE_NAME = "baduk_session";
    process.env.INQUIRY_NOTIFICATION_MAX_ATTEMPTS = "5";
    delete process.env.RATE_LIMIT_REDIS_URL;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(state.prisma)
      .overrideProvider(ObjectStorageService)
      .useValue({
        getInquiryAttachmentMaxBytes: () => 10 * 1024 * 1024,
        createInquiryAttachmentUpload: vi.fn(async ({ attachmentId }: { attachmentId: string }) => ({
          method: "POST",
          url: "https://storage.example.test/private-media",
          fields: { key: `inquiry-attachments/${attachmentId}/source.pdf` },
          expiresAt: new Date(Date.now() + 300_000),
        })),
        inspectInquiryAttachment: vi.fn(async () => Uint8Array.from(Buffer.from("%PDF-1.7 safe inquiry"))),
        signAssetUrl: vi.fn(async () => ({
          url: "https://storage.example.test/signed-inquiry.pdf",
          expiresAt: new Date(Date.now() + 300_000),
        })),
      })
      .overrideProvider(MalwareScannerService)
      .useValue({ scan: vi.fn(async () => ({ clean: true, provider: "clamav", result: "OK" })) })
      .compile();
    app = moduleRef.createNestApplication();
    app.getHttpAdapter().getInstance().set("trust proxy", 1);
    app.setGlobalPrefix("api/v1");
    const requestId = new RequestIdMiddleware();
    app.use(requestId.use.bind(requestId));
    app.useGlobalFilters(new ApiExceptionFilter());
    app.useGlobalInterceptors(new ApiResponseInterceptor());
    await app.listen(0, "127.0.0.1");
    baseUrl = await app.getUrl();
  });

  afterAll(async () => app.close());

  it("requires login and rejects unsupported attachment names", async () => {
    expect((await fetch(`${baseUrl}/api/v1/inquiries`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body()),
    })).status).toBe(401);
    const response = await fetch(`${baseUrl}/api/v1/inquiries`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: "baduk_session=inquiry-student", "x-forwarded-for": "198.51.100.41" },
      body: JSON.stringify(body({ attachment: "unsafe.html" })),
    });
    expect(response.status).toBe(400);
    expect((await response.json() as any).error.code).toBe("INQUIRY_ATTACHMENT_NOT_SUPPORTED");
  });

  it("stores a private inquiry and exposes it only to its owner", async () => {
    const created = await fetch(`${baseUrl}/api/v1/inquiries`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: "baduk_session=inquiry-student", "x-forwarded-for": "198.51.100.42" },
      body: JSON.stringify(body()),
    });
    expect(created.status).toBe(201);
    expect(created.headers.get("ratelimit-limit")).toBe("10");
    const mine = await fetch(`${baseUrl}/api/v1/me/inquiries`, { headers: { cookie: "baduk_session=inquiry-student" } });
    const minePayload = await mine.json() as any;
    expect(minePayload.data.items).toHaveLength(1);
    expect(minePayload.data.items[0]).toMatchObject({ title: "강의 진도 문의", status: "submitted" });
    expect(minePayload.data.items[0]).not.toHaveProperty("answerVersion");
    const other = await fetch(`${baseUrl}/api/v1/me/inquiries`, { headers: { cookie: "baduk_session=inquiry-other" } });
    expect((await other.json() as any).data.items).toHaveLength(0);
    expect(state.auditCreate).toHaveBeenLastCalledWith({
      data: expect.objectContaining({ action: "inquiry.submitted", metadata: { category: "학습", hasAttachment: false } }),
    });
    expect(JSON.stringify(state.auditCreate.mock.calls.at(-1))).not.toContain("진도가 반영되지 않아");
  });

  it("scans an owned attachment, links it once, and protects its download", async () => {
    const file = Buffer.from("%PDF-1.7 safe inquiry");
    const upload = await fetch(`${baseUrl}/api/v1/inquiry-attachments/uploads`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: "baduk_session=inquiry-student", "x-forwarded-for": "198.51.100.43" },
      body: JSON.stringify({ fileName: "진도 화면.pdf", contentType: "application/pdf", size: file.length }),
    });
    expect(upload.status).toBe(201);
    const uploadPayload = await upload.json() as any;
    const attachmentId = uploadPayload.data.attachment.id;
    const completed = await fetch(`${baseUrl}/api/v1/inquiry-attachments/${attachmentId}/complete`, {
      method: "POST", headers: { cookie: "baduk_session=inquiry-student" },
    });
    expect(completed.status).toBe(201);

    const created = await fetch(`${baseUrl}/api/v1/inquiries`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: "baduk_session=inquiry-student", "x-forwarded-for": "198.51.100.44" },
      body: JSON.stringify(body({ attachment: undefined, attachmentId })),
    });
    const createdPayload = await created.json() as any;
    expect(created.status, JSON.stringify(createdPayload)).toBe(201);
    expect(createdPayload.data.inquiry.attachment).toMatchObject({
      id: attachmentId, originalName: "진도 화면.pdf", status: "ready",
    });
    expect(createdPayload.data.inquiry.attachment).not.toHaveProperty("objectKey");

    const inquiryId = createdPayload.data.inquiry.id;
    const denied = await fetch(`${baseUrl}/api/v1/me/inquiries/${inquiryId}/attachment`, {
      headers: { cookie: "baduk_session=inquiry-other" }, redirect: "manual",
    });
    expect(denied.status).toBe(404);
    const ownerDownload = await fetch(`${baseUrl}/api/v1/me/inquiries/${inquiryId}/attachment`, {
      headers: { cookie: "baduk_session=inquiry-student" }, redirect: "manual",
    });
    expect(ownerDownload.status).toBe(302);
    expect(ownerDownload.headers.get("location")).toBe("https://storage.example.test/signed-inquiry.pdf");
    const adminDownload = await fetch(`${baseUrl}/api/v1/admin/inquiries/${inquiryId}/attachment`, {
      headers: { cookie: "baduk_session=inquiry-operator" }, redirect: "manual",
    });
    expect(adminDownload.status).toBe(302);
    expect(JSON.stringify(state.auditCreate.mock.calls)).not.toContain("진도 화면.pdf");
  });

  it("allows only operators to inspect and answer inquiries", async () => {
    expect((await fetch(`${baseUrl}/api/v1/admin/inquiries`, {
      headers: { cookie: "baduk_session=inquiry-student" },
    })).status).toBe(403);
    const list = await fetch(`${baseUrl}/api/v1/admin/inquiries?status=submitted&page=1&pageSize=20`, {
      headers: { cookie: "baduk_session=inquiry-operator" },
    });
    expect(list.status).toBe(200);
    const target = (await list.json() as any).data.items[0];
    const answered = await fetch(`${baseUrl}/api/v1/admin/inquiries/${target.id}/answer`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: "baduk_session=inquiry-operator" },
      body: JSON.stringify({ answer: "진도 동기화를 완료했습니다. 다시 확인해 주세요." }),
    });
    const answeredPayload = await answered.json() as any;
    expect(answered.status, JSON.stringify(answeredPayload)).toBe(201);
    expect(answeredPayload.data.inquiry).toMatchObject({ status: "answered", answeredById: operator.id });

    const duplicate = await fetch(`${baseUrl}/api/v1/admin/inquiries/${target.id}/answer`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: "baduk_session=inquiry-operator" },
      body: JSON.stringify({ answer: "진도 동기화를 완료했습니다. 다시 확인해 주세요." }),
    });
    expect(duplicate.status).toBe(201);
    expect(state.notificationJobs).toHaveLength(1);
    expect(state.notificationJobs[0]).toMatchObject({
      inquiryId: target.id, recipientUserId: student.id, requestedById: operator.id, answerVersion: 1,
    });
    expect(state.userNotifications).toHaveLength(1);
    expect(state.userNotifications[0]).toMatchObject({ userId: student.id, resourceId: target.id, resourceVersion: 1 });

    const mine = await fetch(`${baseUrl}/api/v1/me/inquiries`, { headers: { cookie: "baduk_session=inquiry-student" } });
    expect((await mine.json() as any).data.items[0]).toMatchObject({
      answer: "진도 동기화를 완료했습니다. 다시 확인해 주세요.", status: "answered",
    });
    expect(JSON.stringify(state.auditCreate.mock.calls.at(-1))).not.toContain("진도 동기화를 완료했습니다");

    const notificationJob = state.notificationJobs[0];
    if (!notificationJob) throw new Error("inquiry notification job was not created");
    Object.assign(notificationJob, {
      status: InquiryNotificationStatus.ERROR,
      attempts: 5,
      lastError: "SMTP_TEMPORARY_FAILURE",
    });
    expect((await fetch(`${baseUrl}/api/v1/admin/inquiries/${target.id}/notification-jobs`, {
      headers: { cookie: "baduk_session=inquiry-student" },
    })).status).toBe(403);
    const jobs = await fetch(`${baseUrl}/api/v1/admin/inquiries/${target.id}/notification-jobs`, {
      headers: { cookie: "baduk_session=inquiry-operator" },
    });
    const jobsPayload = await jobs.json() as any;
    expect(jobs.status, JSON.stringify(jobsPayload)).toBe(200);
    expect(jobsPayload.data.items[0]).toMatchObject({
      id: notificationJob.id,
      status: "error",
      attempts: 5,
      lastError: "SMTP_TEMPORARY_FAILURE",
      manualRetryAvailable: true,
    });
    expect(jobsPayload.data.items[0]).not.toHaveProperty("recipientUserId");
    expect(jobsPayload.data.items[0]).not.toHaveProperty("requestedById");
    expect(jobsPayload.data.items[0]).not.toHaveProperty("messageId");

    const retried = await fetch(`${baseUrl}/api/v1/admin/inquiry-notification-jobs/${notificationJob.id}/retry`, {
      method: "POST",
      headers: { cookie: "baduk_session=inquiry-operator" },
    });
    const retriedPayload = await retried.json() as any;
    expect(retried.status, JSON.stringify(retriedPayload)).toBe(201);
    expect(retriedPayload.data.job).toMatchObject({ status: "pending", attempts: 0, manualRetryAvailable: false });
    expect(state.auditCreate).toHaveBeenLastCalledWith({
      data: expect.objectContaining({
        actorId: operator.id,
        action: "mail.inquiry.answered.retry_requested",
        resourceId: target.id,
        metadata: { answerVersion: 1, previousAttempts: 5 },
      }),
    });
    const prematureRetry = await fetch(
      `${baseUrl}/api/v1/admin/inquiry-notification-jobs/${notificationJob.id}/retry`,
      { method: "POST", headers: { cookie: "baduk_session=inquiry-operator" } },
    );
    expect(prematureRetry.status).toBe(409);
    expect((await prematureRetry.json() as any).error.code).toBe("INQUIRY_NOTIFICATION_RETRY_NOT_AVAILABLE");
  });
});
