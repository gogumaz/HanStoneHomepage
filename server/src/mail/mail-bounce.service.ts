import { createHash, timingSafeEqual } from "node:crypto";
import { HttpStatus, Injectable } from "@nestjs/common";
import { Webhook } from "svix";
import { ApiError } from "../common/api-error.js";
import { loadAppConfig } from "../config/app-config.js";
import { PrismaService } from "../database/prisma.service.js";
import { AccountMailStatus, InquiryNotificationStatus } from "../generated/prisma/enums.js";

type BounceInput = { messageId: string; eventIdSha256: string };
type ResendHeaders = {
  id: string | undefined;
  timestamp: string | undefined;
  signature: string | undefined;
};

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

function resendBounceInput(body: unknown, eventId: string): BounceInput | null {
  const root = body && typeof body === "object" ? body as Record<string, unknown> : {};
  if (root.type !== "email.bounced") return null;
  const data = root.data && typeof root.data === "object" ? root.data as Record<string, unknown> : {};
  const bounce = data.bounce && typeof data.bounce === "object" ? data.bounce as Record<string, unknown> : {};
  if (String(bounce.type ?? "").toLowerCase() !== "permanent") return null;
  const messageId = typeof data.message_id === "string" ? data.message_id.trim() : "";
  if (
    !messageId
    || messageId.length > 255
    || /[\u0000-\u001f\u007f]/u.test(messageId)
    || !/^[A-Za-z0-9._:-]{1,200}$/u.test(eventId)
  ) {
    throw new ApiError("MAIL_BOUNCE_INVALID", "Resend 반송 이벤트 형식을 확인해 주세요.", HttpStatus.BAD_REQUEST);
  }
  return { messageId, eventIdSha256: createHash("sha256").update(eventId, "utf8").digest("hex") };
}

@Injectable()
export class MailBounceService {
  private readonly secret: string | null;
  private readonly resendSecret: string | null;

  constructor(private readonly prisma: PrismaService) {
    const config = loadAppConfig();
    this.secret = config.mailBounceWebhookSecret;
    this.resendSecret = config.resendWebhookSecret;
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
    return this.applyBounce(input);
  }

  async receiveResend(headers: ResendHeaders, rawBody: Buffer | undefined) {
    if (!this.resendSecret || !headers.id || !headers.timestamp || !headers.signature || !rawBody) {
      throw new ApiError("MAIL_BOUNCE_UNAUTHORIZED", "Resend 웹훅 인증에 실패했습니다.", HttpStatus.UNAUTHORIZED);
    }
    try {
      new Webhook(this.resendSecret).verify(rawBody, {
        "svix-id": headers.id,
        "svix-timestamp": headers.timestamp,
        "svix-signature": headers.signature,
      });
    } catch {
      throw new ApiError("MAIL_BOUNCE_UNAUTHORIZED", "Resend 웹훅 인증에 실패했습니다.", HttpStatus.UNAUTHORIZED);
    }
    let body: unknown;
    try {
      body = JSON.parse(rawBody.toString("utf8"));
    } catch {
      throw new ApiError("MAIL_BOUNCE_INVALID", "Resend 반송 이벤트 형식을 확인해 주세요.", HttpStatus.BAD_REQUEST);
    }
    const input = resendBounceInput(body, headers.id);
    if (!input) {
      return {
        accepted: true,
        action: "ignored",
        auditLogId: null,
        eventIdSha256: createHash("sha256").update(headers.id, "utf8").digest("hex"),
      } as const;
    }
    return this.applyBounce(input);
  }

  private async applyBounce(input: BounceInput) {
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
