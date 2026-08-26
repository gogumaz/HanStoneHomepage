import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../database/prisma.service.js";
import { AccountStatus, InquiryNotificationStatus, InquiryStatus } from "../generated/prisma/enums.js";
import type { AccountMailService } from "../mail/account-mail.service.js";
import { InquiryNotificationWorkerService } from "./inquiry-notification-worker.service.js";

const now = new Date("2026-08-24T03:00:00.000Z");

function fixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "00000000-0000-0000-0000-000000000801",
    inquiryId: "00000000-0000-0000-0000-000000000501",
    recipientUserId: "00000000-0000-0000-0000-000000000401",
    requestedById: "00000000-0000-0000-0000-000000000403",
    answerVersion: 1,
    status: InquiryNotificationStatus.PENDING,
    attempts: 0,
    nextAttemptAt: now,
    lockedAt: null,
    createdAt: now,
    ...overrides,
  };
}

function setup(options: { job?: Record<string, unknown>; inquiryVersion?: number; verified?: boolean } = {}) {
  const job = options.job ?? fixture();
  const auditCreate = vi.fn(async () => ({ id: "audit-notification" }));
  const jobUpdate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => Object.assign(job, data));
  const prisma = {
    inquiryNotificationJob: {
      findFirst: vi.fn(async () => job),
      updateMany: vi.fn(async () => ({ count: 1 })),
      update: jobUpdate,
    },
    inquiry: { findUnique: vi.fn(async () => ({
      id: job.inquiryId, answerVersion: options.inquiryVersion ?? 1,
      answer: "비공개 답변", status: InquiryStatus.ANSWERED,
    })) },
    user: { findUnique: vi.fn(async () => ({
      id: job.recipientUserId, email: "student@example.test", displayName: "문의 학생",
      emailVerifiedAt: options.verified === false ? null : now, status: AccountStatus.ACTIVE,
    })) },
    auditLog: { create: auditCreate },
    $transaction: vi.fn(async (operation: (transaction: unknown) => unknown) => operation(prisma)),
  };
  return { prisma: prisma as unknown as PrismaService, job, jobUpdate, auditCreate };
}

describe("InquiryNotificationWorkerService", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5432/test";
  });

  it("claims and completes a persisted answer notification", async () => {
    const state = setup();
    const sendInquiryAnswered = vi.fn(async () => ({ status: "sent" as const, messageId: "mail-job-1" }));
    const worker = new InquiryNotificationWorkerService(
      state.prisma,
      { sendInquiryAnswered } as unknown as AccountMailService,
    );

    await expect(worker.processNext(now)).resolves.toBe(true);

    expect(sendInquiryAnswered).toHaveBeenCalledWith({
      email: "student@example.test",
      displayName: "문의 학생",
      inquiryId: "00000000-0000-0000-0000-000000000501",
    });
    expect(state.jobUpdate).toHaveBeenCalledWith({
      where: { id: state.job.id },
      data: expect.objectContaining({ status: InquiryNotificationStatus.SENT, messageId: "mail-job-1" }),
    });
    expect(state.auditCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      action: "mail.inquiry.answered.sent",
      metadata: expect.objectContaining({ status: "sent", attempt: 1 }),
    }) });
  });

  it("retries SMTP failures without storing the private error message", async () => {
    const state = setup();
    const worker = new InquiryNotificationWorkerService(
      state.prisma,
      { sendInquiryAnswered: vi.fn(async () => { throw new TypeError("SMTP private detail"); }) } as unknown as AccountMailService,
    );

    await expect(worker.processNext(now)).resolves.toBe(true);

    expect(state.jobUpdate).toHaveBeenCalledWith({
      where: { id: state.job.id },
      data: expect.objectContaining({ status: InquiryNotificationStatus.ERROR, lastError: "TypeError" }),
    });
    expect(JSON.stringify(state.jobUpdate.mock.calls)).not.toContain("SMTP private detail");
    expect(state.auditCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      action: "mail.inquiry.answered.failed",
      metadata: expect.objectContaining({ retry: true, errorCode: "TypeError" }),
    }) });
  });

  it("skips superseded answers and unverified recipients without sending mail", async () => {
    for (const options of [{ inquiryVersion: 2 }, { verified: false }]) {
      const state = setup(options);
      const sendInquiryAnswered = vi.fn();
      const worker = new InquiryNotificationWorkerService(
        state.prisma,
        { sendInquiryAnswered } as unknown as AccountMailService,
      );

      await expect(worker.processNext(now)).resolves.toBe(true);
      expect(sendInquiryAnswered).not.toHaveBeenCalled();
      expect(state.jobUpdate).toHaveBeenCalledWith({
        where: { id: state.job.id },
        data: expect.objectContaining({ status: InquiryNotificationStatus.SKIPPED }),
      });
    }
  });

  it("terminates a stale final-attempt lock without sending again", async () => {
    process.env.INQUIRY_NOTIFICATION_MAX_ATTEMPTS = "5";
    const state = setup({ job: fixture({
      status: InquiryNotificationStatus.SENDING,
      attempts: 5,
      lockedAt: new Date("2026-08-24T02:00:00.000Z"),
    }) });
    const sendInquiryAnswered = vi.fn();
    const worker = new InquiryNotificationWorkerService(
      state.prisma,
      { sendInquiryAnswered } as unknown as AccountMailService,
    );

    await expect(worker.processNext(now)).resolves.toBe(true);
    expect(sendInquiryAnswered).not.toHaveBeenCalled();
    expect(state.auditCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      action: "mail.inquiry.answered.failed",
      metadata: expect.objectContaining({ retry: false, errorCode: "LOCK_TIMEOUT_MAX_ATTEMPTS" }),
    }) });
    delete process.env.INQUIRY_NOTIFICATION_MAX_ATTEMPTS;
  });
});
