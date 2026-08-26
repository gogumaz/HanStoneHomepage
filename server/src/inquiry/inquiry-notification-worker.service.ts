import { Injectable, Logger } from "@nestjs/common";
import { loadAppConfig } from "../config/app-config.js";
import { PrismaService } from "../database/prisma.service.js";
import { AccountStatus, InquiryNotificationStatus, InquiryStatus } from "../generated/prisma/enums.js";
import { AccountMailService } from "../mail/account-mail.service.js";

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
  return (error instanceof Error && error.name ? error.name : "INQUIRY_NOTIFICATION_FAILED").slice(0, 100);
}

@Injectable()
export class InquiryNotificationWorkerService {
  private readonly logger = new Logger(InquiryNotificationWorkerService.name);
  private readonly pollIntervalMs: number;
  private readonly maxAttempts: number;
  private readonly lockTimeoutMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: AccountMailService,
  ) {
    const config = loadAppConfig();
    this.pollIntervalMs = config.inquiryNotificationPollIntervalMs;
    this.maxAttempts = config.inquiryNotificationMaxAttempts;
    this.lockTimeoutMs = config.inquiryNotificationLockTimeoutMs;
  }

  async runForever(signal: AbortSignal): Promise<void> {
    this.logger.log("Inquiry notification worker started");
    while (!signal.aborted) {
      try {
        if (!await this.processNext()) await wait(this.pollIntervalMs, signal);
      } catch (error) {
        this.logger.error(`Inquiry notification polling failed: ${errorCode(error)}`);
        await wait(this.pollIntervalMs, signal);
      }
    }
    this.logger.log("Inquiry notification worker stopped");
  }

  async processNext(now = new Date()): Promise<boolean> {
    const staleLock = new Date(now.getTime() - this.lockTimeoutMs);
    const candidate = await this.prisma.inquiryNotificationJob.findFirst({
      where: {
        OR: [
          { status: InquiryNotificationStatus.PENDING, attempts: { lt: this.maxAttempts }, nextAttemptAt: { lte: now } },
          { status: InquiryNotificationStatus.ERROR, attempts: { lt: this.maxAttempts }, nextAttemptAt: { lte: now } },
          { status: InquiryNotificationStatus.SENDING, attempts: { lte: this.maxAttempts }, lockedAt: { lt: staleLock } },
        ],
      },
      orderBy: { createdAt: "asc" },
    });
    if (!candidate) return false;

    if (candidate.status === InquiryNotificationStatus.SENDING && candidate.attempts >= this.maxAttempts) {
      await this.prisma.$transaction(async (transaction) => {
        const expired = await transaction.inquiryNotificationJob.updateMany({
          where: { id: candidate.id, status: candidate.status, attempts: candidate.attempts },
          data: { status: InquiryNotificationStatus.ERROR, lockedAt: null, lastError: "LOCK_TIMEOUT_MAX_ATTEMPTS" },
        });
        if (expired.count === 1) {
          await transaction.auditLog.create({
            data: {
              actorId: candidate.requestedById,
              action: "mail.inquiry.answered.failed",
              resourceType: "Inquiry",
              resourceId: candidate.inquiryId,
              metadata: { status: "failed", attempt: candidate.attempts, retry: false, errorCode: "LOCK_TIMEOUT_MAX_ATTEMPTS" },
            },
          });
        }
      });
      return true;
    }

    const claimed = await this.prisma.inquiryNotificationJob.updateMany({
      where: { id: candidate.id, status: candidate.status, attempts: candidate.attempts },
      data: {
        status: InquiryNotificationStatus.SENDING,
        attempts: { increment: 1 },
        lockedAt: now,
        lastError: null,
      },
    });
    if (claimed.count !== 1) return true;
    const attempt = candidate.attempts + 1;

    const [inquiry, recipient] = await Promise.all([
      this.prisma.inquiry.findUnique({ where: { id: candidate.inquiryId } }),
      this.prisma.user.findUnique({
        where: { id: candidate.recipientUserId },
        select: { id: true, email: true, displayName: true, emailVerifiedAt: true, status: true },
      }),
    ]);
    if (!inquiry || inquiry.answerVersion !== candidate.answerVersion || !inquiry.answer
      || (inquiry.status !== InquiryStatus.ANSWERED && inquiry.status !== InquiryStatus.CLOSED)) {
      await this.complete(candidate, InquiryNotificationStatus.SKIPPED, attempt, "SUPERSEDED");
      return true;
    }
    if (!recipient || recipient.status !== AccountStatus.ACTIVE || !recipient.emailVerifiedAt || !recipient.email) {
      await this.complete(candidate, InquiryNotificationStatus.SKIPPED, attempt, "RECIPIENT_UNAVAILABLE");
      return true;
    }

    try {
      const result = await this.mail.sendInquiryAnswered({
        email: recipient.email,
        displayName: recipient.displayName,
        inquiryId: candidate.inquiryId,
      });
      await this.complete(
        candidate,
        result.status === "sent" ? InquiryNotificationStatus.SENT : InquiryNotificationStatus.SKIPPED,
        attempt,
        result.status === "skipped" ? "SMTP_NOT_CONFIGURED" : null,
        result.messageId,
      );
    } catch (error) {
      const code = errorCode(error);
      const delay = RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)] ?? RETRY_DELAYS_MS[0];
      await this.prisma.$transaction(async (transaction) => {
        await transaction.inquiryNotificationJob.update({
          where: { id: candidate.id },
          data: {
            status: InquiryNotificationStatus.ERROR,
            lockedAt: null,
            lastError: code,
            nextAttemptAt: new Date(now.getTime() + delay),
          },
        });
        await transaction.auditLog.create({
          data: {
            actorId: candidate.requestedById,
            action: "mail.inquiry.answered.failed",
            resourceType: "Inquiry",
            resourceId: candidate.inquiryId,
            metadata: { status: "failed", attempt, retry: attempt < this.maxAttempts, errorCode: code },
          },
        });
      });
      this.logger.warn(`Inquiry notification failed: ${candidate.id} (${code}, attempt ${attempt})`);
    }
    return true;
  }

  private async complete(
    candidate: { id: string; inquiryId: string; requestedById: string },
    status: InquiryNotificationStatus,
    attempt: number,
    lastError: string | null,
    messageId?: string,
  ): Promise<void> {
    const publicStatus = status === InquiryNotificationStatus.SENT ? "sent" : "skipped";
    await this.prisma.$transaction(async (transaction) => {
      await transaction.inquiryNotificationJob.update({
        where: { id: candidate.id },
        data: {
          status,
          lockedAt: null,
          completedAt: new Date(),
          lastError,
          messageId: messageId?.slice(0, 255) ?? null,
        },
      });
      await transaction.auditLog.create({
        data: {
          actorId: candidate.requestedById,
          action: `mail.inquiry.answered.${publicStatus}`,
          resourceType: "Inquiry",
          resourceId: candidate.inquiryId,
          metadata: {
            status: publicStatus,
            attempt,
            ...(lastError ? { reason: lastError } : {}),
            ...(messageId ? { messageId: messageId.slice(0, 255) } : {}),
          },
        },
      });
    });
  }
}
