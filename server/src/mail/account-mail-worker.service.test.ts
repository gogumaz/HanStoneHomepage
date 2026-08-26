import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PrismaService } from "../database/prisma.service.js";
import { AccountMailKind, AccountMailStatus, AccountStatus, AccountTokenPurpose } from "../generated/prisma/enums.js";
import { AccountMailService } from "./account-mail.service.js";
import { encryptAccountMailToken } from "./account-mail-token-crypto.js";
import { AccountMailWorkerService } from "./account-mail-worker.service.js";

function harness(overrides: Record<string, unknown> = {}) {
  const key = randomBytes(32).toString("base64");
  vi.stubEnv("ACCOUNT_MAIL_ENCRYPTION_KEY_BASE64", key);
  vi.stubEnv("DATABASE_URL", "postgresql://test:test@localhost/test");
  const now = new Date("2026-08-24T00:00:00.000Z");
  const candidate = {
    id: "00000000-0000-4000-8000-000000000901",
    tokenId: "00000000-0000-4000-8000-000000000902",
    kind: AccountMailKind.EMAIL_VERIFICATION,
    encryptedToken: encryptAccountMailToken("verification-token", key),
    status: AccountMailStatus.PENDING,
    attempts: 0,
    nextAttemptAt: now,
    lockedAt: null,
    completedAt: null,
    messageId: null,
    lastError: null,
    requestId: "request-account-mail",
    createdAt: now,
    updatedAt: now,
    token: {
      id: "00000000-0000-4000-8000-000000000902",
      userId: "00000000-0000-4000-8000-000000000903",
      purpose: AccountTokenPurpose.EMAIL_VERIFICATION,
      tokenHash: "hash",
      expiresAt: new Date("2026-08-25T00:00:00.000Z"),
      consumedAt: null,
      createdAt: now,
      user: {
        id: "00000000-0000-4000-8000-000000000903",
        email: "member@example.com",
        displayName: "메일 회원",
        passwordHash: "password-hash",
        emailVerifiedAt: null,
        status: AccountStatus.ACTIVE,
      },
    },
    ...overrides,
  };
  const accountMailJob = {
    findFirst: vi.fn(async () => candidate),
    updateMany: vi.fn(async () => ({ count: 1 })),
    update: vi.fn(async () => candidate),
  };
  const auditLog = { create: vi.fn(async () => ({})) };
  const prisma = {
    accountMailJob,
    auditLog,
    $transaction: vi.fn(async (operation: (transaction: unknown) => Promise<unknown>) => operation({ accountMailJob, auditLog })),
  };
  const mail = {
    sendEmailVerification: vi.fn(async () => ({ status: "sent" as const, messageId: "smtp-message" })),
    sendPasswordReset: vi.fn(async () => ({ status: "sent" as const, messageId: "smtp-reset" })),
  };
  return {
    service: new AccountMailWorkerService(
      prisma as unknown as PrismaService,
      mail as unknown as AccountMailService,
    ),
    candidate,
    accountMailJob,
    auditLog,
    mail,
  };
}

describe("AccountMailWorkerService", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("claims, decrypts, and completes an email verification job", async () => {
    const test = harness();
    await expect(test.service.processNext(new Date("2026-08-24T00:00:00.000Z"))).resolves.toBe(true);
    expect(test.mail.sendEmailVerification).toHaveBeenCalledWith({
      email: "member@example.com",
      displayName: "메일 회원",
      token: "verification-token",
    });
    expect(test.accountMailJob.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: AccountMailStatus.SENT,
        messageId: "smtp-message",
        encryptedToken: null,
      }),
    }));
    expect(test.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: "mail.account.email_verification.sent" }),
    }));
  });

  it("keeps a failed SMTP delivery for a bounded retry without exposing the token", async () => {
    const test = harness();
    test.mail.sendEmailVerification.mockRejectedValueOnce(new TypeError("smtp unavailable verification-token"));
    await test.service.processNext(new Date("2026-08-24T00:00:00.000Z"));
    expect(test.accountMailJob.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: AccountMailStatus.ERROR,
        lastError: "TypeError",
        nextAttemptAt: new Date("2026-08-24T00:01:00.000Z"),
      }),
    }));
    expect(JSON.stringify(test.auditLog.create.mock.calls)).not.toContain("verification-token");
  });

  it("skips a consumed token without sending mail", async () => {
    const base = harness();
    const test = harness({ token: { ...base.candidate.token, consumedAt: new Date("2026-08-24T00:00:00.000Z") } });
    await test.service.processNext(new Date("2026-08-24T00:00:00.000Z"));
    expect(test.mail.sendEmailVerification).not.toHaveBeenCalled();
    expect(test.accountMailJob.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: AccountMailStatus.SKIPPED }),
    }));
  });
});
