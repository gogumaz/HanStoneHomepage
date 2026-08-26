import { Injectable, Logger } from "@nestjs/common";
import { loadAppConfig } from "../config/app-config.js";
import { PrismaService } from "../database/prisma.service.js";
import {
  AccountMailKind,
  AccountMailStatus,
  AccountStatus,
  AccountTokenPurpose,
} from "../generated/prisma/enums.js";
import { AccountMailService } from "./account-mail.service.js";
import { decryptAccountMailToken } from "./account-mail-token-crypto.js";

const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000, 12 * 60 * 60_000] as const;

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const finish = () => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timeout = setTimeout(finish, milliseconds);
    signal.addEventListener("abort", finish, { once: true });
  });
}

function errorCode(error: unknown): string {
  return (error instanceof Error && error.name ? error.name : "ACCOUNT_MAIL_FAILED").slice(0, 100);
}

@Injectable()
export class AccountMailWorkerService {
  private readonly logger = new Logger(AccountMailWorkerService.name);
  private readonly key: string;
  private readonly pollIntervalMs: number;
  private readonly maxAttempts: number;
  private readonly lockTimeoutMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: AccountMailService,
  ) {
    const config = loadAppConfig();
    if (!config.accountMailEncryptionKeyBase64) {
      throw new Error("ACCOUNT_MAIL_ENCRYPTION_KEY_REQUIRED");
    }
    this.key = config.accountMailEncryptionKeyBase64;
    this.pollIntervalMs = config.accountMailPollIntervalMs;
    this.maxAttempts = config.accountMailMaxAttempts;
    this.lockTimeoutMs = config.accountMailLockTimeoutMs;
  }

  async runForever(signal: AbortSignal): Promise<void> {
    this.logger.log("Account mail worker started");
    while (!signal.aborted) {
      try {
        if (!await this.processNext()) await wait(this.pollIntervalMs, signal);
      } catch (error) {
        this.logger.error(`Account mail polling failed: ${errorCode(error)}`);
        await wait(this.pollIntervalMs, signal);
      }
    }
    this.logger.log("Account mail worker stopped");
  }

  async processNext(now = new Date()): Promise<boolean> {
    const staleLock = new Date(now.getTime() - this.lockTimeoutMs);
    const candidate = await this.prisma.accountMailJob.findFirst({
      where: {
        OR: [
          { status: AccountMailStatus.PENDING, attempts: { lt: this.maxAttempts }, nextAttemptAt: { lte: now } },
          { status: AccountMailStatus.ERROR, attempts: { lt: this.maxAttempts }, nextAttemptAt: { lte: now } },
          { status: AccountMailStatus.SENDING, attempts: { lte: this.maxAttempts }, lockedAt: { lt: staleLock } },
        ],
      },
      orderBy: { createdAt: "asc" },
      include: { token: { include: { user: true } } },
    });
    if (!candidate) return false;

    if (candidate.status === AccountMailStatus.SENDING && candidate.attempts >= this.maxAttempts) {
      await this.failStaleJob(candidate, "LOCK_TIMEOUT_MAX_ATTEMPTS");
      return true;
    }
    const claimed = await this.prisma.accountMailJob.updateMany({
      where: { id: candidate.id, status: candidate.status, attempts: candidate.attempts },
      data: { status: AccountMailStatus.SENDING, attempts: { increment: 1 }, lockedAt: now, lastError: null },
    });
    if (claimed.count !== 1) return true;
    const attempt = candidate.attempts + 1;
    const { token, kind } = candidate;
    const unavailable = token.consumedAt
      || token.expiresAt.getTime() <= now.getTime()
      || token.user.status !== AccountStatus.ACTIVE
      || !token.user.email
      || (kind === AccountMailKind.EMAIL_VERIFICATION && (
        token.purpose !== AccountTokenPurpose.EMAIL_VERIFICATION || Boolean(token.user.emailVerifiedAt)
      ))
      || (kind === AccountMailKind.PASSWORD_RESET && (
        token.purpose !== AccountTokenPurpose.PASSWORD_RESET || !token.user.passwordHash
      ));
    if (unavailable) {
      await this.complete(candidate, AccountMailStatus.SKIPPED, attempt, "TOKEN_OR_RECIPIENT_UNAVAILABLE");
      return true;
    }
    if (!candidate.encryptedToken) {
      await this.complete(candidate, AccountMailStatus.SKIPPED, attempt, "TOKEN_PAYLOAD_UNAVAILABLE");
      return true;
    }

    try {
      const rawToken = decryptAccountMailToken(candidate.encryptedToken, this.key);
      const input = { email: token.user.email as string, displayName: token.user.displayName, token: rawToken };
      const result = kind === AccountMailKind.EMAIL_VERIFICATION
        ? await this.mail.sendEmailVerification(input)
        : await this.mail.sendPasswordReset(input);
      await this.complete(
        candidate,
        result.status === "sent" ? AccountMailStatus.SENT : AccountMailStatus.SKIPPED,
        attempt,
        result.status === "skipped" ? "SMTP_NOT_CONFIGURED" : null,
        result.messageId,
      );
    } catch (error) {
      const code = errorCode(error);
      const delay = RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)] ?? RETRY_DELAYS_MS[0];
      await this.prisma.$transaction(async (transaction) => {
        await transaction.accountMailJob.update({
          where: { id: candidate.id },
          data: {
            status: AccountMailStatus.ERROR,
            lockedAt: null,
            lastError: code,
            nextAttemptAt: new Date(now.getTime() + delay),
            ...(attempt >= this.maxAttempts ? { encryptedToken: null, completedAt: now } : {}),
          },
        });
        await transaction.auditLog.create({
          data: {
            actorId: token.userId,
            action: `mail.account.${kind.toLowerCase()}.failed`,
            resourceType: "EmailDelivery",
            resourceId: candidate.id,
            requestId: candidate.requestId,
            metadata: { status: "failed", attempt, retry: attempt < this.maxAttempts, errorCode: code },
          },
        });
      });
      this.logger.warn(`Account mail failed: ${candidate.id} (${code}, attempt ${attempt})`);
    }
    return true;
  }

  private async failStaleJob(
    candidate: { id: string; attempts: number; token: { userId: string }; kind: AccountMailKind; requestId: string | null },
    code: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.accountMailJob.updateMany({
        where: { id: candidate.id, status: AccountMailStatus.SENDING, attempts: candidate.attempts },
        data: {
          status: AccountMailStatus.ERROR,
          lockedAt: null,
          lastError: code,
          encryptedToken: null,
          completedAt: new Date(),
        },
      });
      if (updated.count === 1) {
        await transaction.auditLog.create({
          data: {
            actorId: candidate.token.userId,
            action: `mail.account.${candidate.kind.toLowerCase()}.failed`,
            resourceType: "EmailDelivery",
            resourceId: candidate.id,
            requestId: candidate.requestId,
            metadata: { status: "failed", attempt: candidate.attempts, retry: false, errorCode: code },
          },
        });
      }
    });
  }

  private async complete(
    candidate: { id: string; kind: AccountMailKind; requestId: string | null; token: { userId: string } },
    status: AccountMailStatus,
    attempt: number,
    reason: string | null,
    messageId?: string,
  ): Promise<void> {
    const publicStatus = status === AccountMailStatus.SENT ? "sent" : "skipped";
    await this.prisma.$transaction(async (transaction) => {
      await transaction.accountMailJob.update({
        where: { id: candidate.id },
        data: {
          status,
          lockedAt: null,
          completedAt: new Date(),
          encryptedToken: null,
          lastError: reason,
          messageId: messageId?.slice(0, 255) ?? null,
        },
      });
      await transaction.auditLog.create({
        data: {
          actorId: candidate.token.userId,
          action: `mail.account.${candidate.kind.toLowerCase()}.${publicStatus}`,
          resourceType: "EmailDelivery",
          resourceId: candidate.id,
          requestId: candidate.requestId,
          metadata: {
            status: publicStatus,
            attempt,
            ...(reason ? { reason } : {}),
            ...(messageId ? { messageId: messageId.slice(0, 255) } : {}),
          },
        },
      });
    });
  }
}
