import { createHash, timingSafeEqual } from "node:crypto";
import { HttpStatus, Injectable } from "@nestjs/common";
import { ApiError } from "../common/api-error.js";
import { loadAppConfig } from "../config/app-config.js";
import { PrismaService } from "../database/prisma.service.js";
import { AccountMailStatus, InquiryNotificationStatus } from "../generated/prisma/enums.js";

type BounceInput = { messageId: string; eventIdSha256: string };

function authorized(authorization: string | undefined, expected: string): boolean {
  const token = authorization?.match(/^Bearer\s+([^\s]+)$/iu)?.[1] ?? "";
  const left = Buffer.from(token);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function bounceInput(body: unknown): BounceInput {
  const data = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const messageId = typeof data.messageId === "string" ? data.messageId.trim() : "";
  const event = typeof data.event === "string" ? data.event.trim().toLowerCase() : "";
  const eventId = typeof data.eventId === "string" ? data.eventId.trim() : "";
  if (
    event !== "permanent_bounce"
    || !messageId
    || messageId.length > 255
    || /[\u0000-\u001f\u007f]/u.test(messageId)
    || !/^[A-Za-z0-9._:-]{1,200}$/u.test(eventId)
  ) {
    throw new ApiError(
      "MAIL_BOUNCE_INVALID",
      "반송 이벤트 형식을 확인해 주세요.",
      HttpStatus.BAD_REQUEST,
    );
  }
  return { messageId, eventIdSha256: createHash("sha256").update(eventId, "utf8").digest("hex") };
}

@Injectable()
export class MailBounceService {
  private readonly secret: string | null;

  constructor(private readonly prisma: PrismaService) {
    this.secret = loadAppConfig().mailBounceWebhookSecret;
  }

  async receive(authorization: string | undefined, body: unknown) {
    if (!this.secret || !authorized(authorization, this.secret)) {
      throw new ApiError(
        "MAIL_BOUNCE_UNAUTHORIZED",
        "반송 웹훅 인증에 실패했습니다.",
        HttpStatus.UNAUTHORIZED,
      );
    }
    const input = bounceInput(body);
    const accountJob = await this.prisma.accountMailJob.findFirst({
      where: { messageId: input.messageId },
      select: { id: true, status: true, token: { select: { userId: true } } },
    });
    if (accountJob) {
      const result = await this.prisma.$transaction(async (transaction) => {
        const updated = await transaction.accountMailJob.updateMany({
          where: { id: accountJob.id, status: AccountMailStatus.SENT },
          data: {
            status: AccountMailStatus.BOUNCED,
            lastError: "PERMANENT_BOUNCE",
            completedAt: new Date(),
          },
        });
        let auditLogId: string | null = null;
        if (updated.count === 1) {
          const auditLog = await transaction.auditLog.create({
            data: {
              actorId: accountJob.token.userId,
              action: "mail.account.bounced",
              resourceType: "EmailDelivery",
              resourceId: accountJob.id,
              metadata: { bounceType: "permanent", providerEventIdSha256: input.eventIdSha256 },
            },
          });
          auditLogId = auditLog.id;
        }
        return { changed: updated.count === 1, auditLogId };
      });
      return {
        accepted: true,
        action: result.changed ? "bounced" : "unchanged",
        auditLogId: result.auditLogId,
        eventIdSha256: input.eventIdSha256,
      } as const;
    }

    const inquiryJob = await this.prisma.inquiryNotificationJob.findFirst({
      where: { messageId: input.messageId },
      select: { id: true, inquiryId: true, requestedById: true, status: true },
    });
    if (inquiryJob) {
      const result = await this.prisma.$transaction(async (transaction) => {
        const updated = await transaction.inquiryNotificationJob.updateMany({
          where: { id: inquiryJob.id, status: InquiryNotificationStatus.SENT },
          data: {
            status: InquiryNotificationStatus.BOUNCED,
            lastError: "PERMANENT_BOUNCE",
            completedAt: new Date(),
          },
        });
        let auditLogId: string | null = null;
        if (updated.count === 1) {
          const auditLog = await transaction.auditLog.create({
            data: {
              actorId: inquiryJob.requestedById,
              action: "mail.inquiry.answered.bounced",
              resourceType: "Inquiry",
              resourceId: inquiryJob.inquiryId,
              metadata: {
                bounceType: "permanent",
                notificationJobId: inquiryJob.id,
                providerEventIdSha256: input.eventIdSha256,
              },
            },
          });
          auditLogId = auditLog.id;
        }
        return { changed: updated.count === 1, auditLogId };
      });
      return {
        accepted: true,
        action: result.changed ? "bounced" : "unchanged",
        auditLogId: result.auditLogId,
        eventIdSha256: input.eventIdSha256,
      } as const;
    }

    return {
      accepted: true,
      action: "unknown",
      auditLogId: null,
      eventIdSha256: input.eventIdSha256,
    } as const;
  }
}
