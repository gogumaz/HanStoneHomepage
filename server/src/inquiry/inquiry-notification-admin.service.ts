import { HttpStatus, Injectable } from "@nestjs/common";
import type { CurrentUser } from "../auth/auth.types.js";
import { ApiError } from "../common/api-error.js";
import { loadAppConfig } from "../config/app-config.js";
import { PrismaService } from "../database/prisma.service.js";
import { InquiryNotificationStatus, InquiryStatus } from "../generated/prisma/enums.js";

@Injectable()
export class InquiryNotificationAdminService {
  private readonly maxAttempts = loadAppConfig().inquiryNotificationMaxAttempts;

  constructor(private readonly prisma: PrismaService) {}

  async listForInquiry(inquiryId: string) {
    const inquiry = await this.prisma.inquiry.findUnique({
      where: { id: inquiryId },
      select: { id: true },
    });
    if (!inquiry) {
      throw new ApiError("INQUIRY_NOT_FOUND", "문의 내역을 찾을 수 없습니다.", HttpStatus.NOT_FOUND);
    }

    const items = await this.prisma.inquiryNotificationJob.findMany({
      where: { inquiryId },
      orderBy: [{ answerVersion: "desc" }, { createdAt: "desc" }],
      take: 50,
    });
    return { items: items.map((item) => notificationJobView(item, this.maxAttempts)) };
  }

  async retry(user: CurrentUser, jobId: string, requestId?: string) {
    const existing = await this.prisma.inquiryNotificationJob.findUnique({
      where: { id: jobId },
      include: { inquiry: true },
    });
    if (!existing) {
      throw new ApiError(
        "INQUIRY_NOTIFICATION_JOB_NOT_FOUND",
        "문의 이메일 발송 작업을 찾을 수 없습니다.",
        HttpStatus.NOT_FOUND,
      );
    }
    if (existing.status !== InquiryNotificationStatus.ERROR || existing.attempts < this.maxAttempts) {
      throw new ApiError(
        "INQUIRY_NOTIFICATION_RETRY_NOT_AVAILABLE",
        "자동 재시도가 모두 끝난 실패 작업만 다시 요청할 수 있습니다.",
        HttpStatus.CONFLICT,
      );
    }
    if (existing.inquiry.answerVersion !== existing.answerVersion || !existing.inquiry.answer
      || (existing.inquiry.status !== InquiryStatus.ANSWERED && existing.inquiry.status !== InquiryStatus.CLOSED)) {
      throw new ApiError(
        "INQUIRY_NOTIFICATION_SUPERSEDED",
        "현재 답변과 일치하지 않는 이전 발송 작업은 다시 요청할 수 없습니다.",
        HttpStatus.CONFLICT,
      );
    }

    const now = new Date();
    const updated = await this.prisma.$transaction(async (transaction) => {
      const reset = await transaction.inquiryNotificationJob.updateMany({
        where: {
          id: jobId,
          status: InquiryNotificationStatus.ERROR,
          attempts: existing.attempts,
        },
        data: {
          status: InquiryNotificationStatus.PENDING,
          attempts: 0,
          nextAttemptAt: now,
          lockedAt: null,
          completedAt: null,
          messageId: null,
          lastError: null,
        },
      });
      if (reset.count !== 1) {
        throw new ApiError(
          "INQUIRY_NOTIFICATION_JOB_CHANGED",
          "발송 작업 상태가 변경되었습니다. 새로 고친 뒤 다시 시도해 주세요.",
          HttpStatus.CONFLICT,
        );
      }
      await transaction.auditLog.create({
        data: {
          actorId: user.id,
          action: "mail.inquiry.answered.retry_requested",
          resourceType: "Inquiry",
          resourceId: existing.inquiryId,
          requestId: requestId ?? null,
          metadata: { answerVersion: existing.answerVersion, previousAttempts: existing.attempts },
        },
      });
      return transaction.inquiryNotificationJob.findUniqueOrThrow({ where: { id: jobId } });
    });

    return { job: notificationJobView(updated, this.maxAttempts) };
  }
}

function notificationJobView(item: {
  id: string;
  inquiryId: string;
  answerVersion: number;
  status: InquiryNotificationStatus;
  attempts: number;
  nextAttemptAt: Date;
  completedAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}, maxAttempts: number) {
  return {
    id: item.id,
    inquiryId: item.inquiryId,
    answerVersion: item.answerVersion,
    status: item.status.toLowerCase(),
    attempts: item.attempts,
    nextAttemptAt: item.nextAttemptAt,
    completedAt: item.completedAt,
    lastError: item.lastError,
    manualRetryAvailable: item.status === InquiryNotificationStatus.ERROR && item.attempts >= maxAttempts,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}
