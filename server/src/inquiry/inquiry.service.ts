import { HttpStatus, Injectable } from "@nestjs/common";
import type { CurrentUser } from "../auth/auth.types.js";
import { ApiError } from "../common/api-error.js";
import { readInputObject, requiredString } from "../common/input-validation.js";
import { PrismaService } from "../database/prisma.service.js";
import { InquiryAttachmentStatus, InquiryStatus, UserNotificationKind } from "../generated/prisma/enums.js";
import { attachmentView } from "./inquiry-attachment.service.js";
import { INQUIRY_CATEGORIES, validateInquiryInput } from "./inquiry-validation.js";

const STATUS_VALUES = {
  submitted: InquiryStatus.SUBMITTED,
  in_review: InquiryStatus.IN_REVIEW,
  answered: InquiryStatus.ANSWERED,
  closed: InquiryStatus.CLOSED,
} as const;

const STATUS_TRANSITIONS: Record<InquiryStatus, readonly InquiryStatus[]> = {
  [InquiryStatus.SUBMITTED]: [InquiryStatus.IN_REVIEW, InquiryStatus.CLOSED],
  [InquiryStatus.IN_REVIEW]: [InquiryStatus.CLOSED],
  [InquiryStatus.ANSWERED]: [InquiryStatus.IN_REVIEW, InquiryStatus.CLOSED],
  [InquiryStatus.CLOSED]: [InquiryStatus.IN_REVIEW],
};

@Injectable()
export class InquiryService {
  constructor(private readonly prisma: PrismaService) {}

  async submit(user: CurrentUser, body: unknown, requestId?: string) {
    const input = validateInquiryInput(body);
    const { attachmentId, ...inquiryInput } = input;
    const attachment = attachmentId ? await this.prisma.inquiryAttachment.findFirst({
      where: {
        id: attachmentId,
        ownerUserId: user.id,
        inquiryId: null,
        status: InquiryAttachmentStatus.READY,
      },
    }) : null;
    if (attachmentId && !attachment) {
      throw new ApiError(
        "INQUIRY_ATTACHMENT_UNAVAILABLE",
        "검사가 완료된 본인 첨부파일만 문의에 등록할 수 있습니다.",
        HttpStatus.CONFLICT,
      );
    }
    const inquiry = await this.prisma.$transaction(async (transaction) => {
      const created = await transaction.inquiry.create({
        data: { ...inquiryInput, requesterUserId: user.id },
      });
      if (attachmentId) {
        const linked = await transaction.inquiryAttachment.updateMany({
          where: {
            id: attachmentId,
            ownerUserId: user.id,
            inquiryId: null,
            status: InquiryAttachmentStatus.READY,
          },
          data: { inquiryId: created.id },
        });
        if (linked.count !== 1) {
          throw new ApiError(
            "INQUIRY_ATTACHMENT_UNAVAILABLE",
            "첨부파일이 이미 사용되었거나 사용할 수 없습니다.",
            HttpStatus.CONFLICT,
          );
        }
      }
      await transaction.auditLog.create({
        data: {
          actorId: user.id,
          action: "inquiry.submitted",
          resourceType: "Inquiry",
          resourceId: created.id,
          requestId: requestId ?? null,
          metadata: { category: input.category, hasAttachment: Boolean(attachmentId) },
        },
      });
      return created;
    });
    return { inquiry: inquiryView({ ...inquiry, attachment }) };
  }

  async listMine(user: CurrentUser) {
    const items = await this.prisma.inquiry.findMany({
      where: { requesterUserId: user.id },
      orderBy: { createdAt: "desc" },
      include: { attachment: true },
    });
    return { items: items.map(inquiryView) };
  }

  async listAdmin(query: Record<string, unknown>) {
    const status = readStatus(query.status);
    const category = readQueryString(query.category, 30);
    if (category && !(INQUIRY_CATEGORIES as readonly string[]).includes(category)) invalidFilter();
    const search = readQueryString(query.q, 100);
    const page = readInteger(query.page, 1, 100_000, 1);
    const pageSize = readInteger(query.pageSize, 1, 100, 20);
    const where = {
      ...(status ? { status } : {}),
      ...(category ? { category } : {}),
      ...(search ? { OR: [
        { title: { contains: search, mode: "insensitive" as const } },
        { content: { contains: search, mode: "insensitive" as const } },
      ] } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.inquiry.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { attachment: true },
      }),
      this.prisma.inquiry.count({ where }),
    ]);
    return {
      items: items.map(inquiryView),
      pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    };
  }

  async getAdmin(inquiryId: string) {
    return { inquiry: inquiryView(await this.requireInquiry(inquiryId)) };
  }

  async answer(user: CurrentUser, inquiryId: string, body: unknown, requestId?: string) {
    const input = readInputObject(body, ["answer"], "INQUIRY_ANSWER_INVALID", "답변 내용을 확인해 주세요.");
    const answer = requiredString(
      input,
      "answer",
      { minLength: 2, maxLength: 4_000 },
      "INQUIRY_ANSWER_INVALID",
      "답변 내용을 확인해 주세요.",
    );
    const existing = await this.requireInquiry(inquiryId);
    if (existing.status === InquiryStatus.CLOSED) {
      throw new ApiError("INQUIRY_CLOSED", "종료된 문의는 다시 검토한 후 답변할 수 있습니다.", HttpStatus.CONFLICT);
    }
    if (existing.status === InquiryStatus.ANSWERED && existing.answer === answer) {
      return { inquiry: inquiryView(existing) };
    }
    const answeredAt = new Date();
    const inquiry = await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.inquiry.update({
        where: { id: inquiryId },
        data: {
          answer,
          answeredById: user.id,
          answeredAt,
          status: InquiryStatus.ANSWERED,
          answerVersion: { increment: 1 },
        },
        include: { attachment: true },
      });
      await transaction.inquiryNotificationJob.create({
        data: {
          inquiryId,
          recipientUserId: existing.requesterUserId,
          requestedById: user.id,
          answerVersion: updated.answerVersion,
        },
      });
      await transaction.userNotification.create({
        data: {
          userId: existing.requesterUserId,
          kind: UserNotificationKind.INQUIRY_ANSWERED,
          resourceType: "Inquiry",
          resourceId: inquiryId,
          resourceVersion: updated.answerVersion,
          title: "1:1 문의 답변이 등록되었습니다",
          message: "내 문의함에서 운영자 답변을 확인해 주세요.",
        },
      });
      await transaction.auditLog.create({
        data: {
          actorId: user.id,
          action: "inquiry.answered",
          resourceType: "Inquiry",
          resourceId: inquiryId,
          requestId: requestId ?? null,
          metadata: { previousStatus: existing.status.toLowerCase(), status: "answered" },
        },
      });
      return updated;
    });
    return { inquiry: inquiryView(inquiry) };
  }

  async updateStatus(user: CurrentUser, inquiryId: string, body: unknown, requestId?: string) {
    const input = readInputObject(body, ["status"], "INQUIRY_STATUS_INVALID", "문의 상태를 확인해 주세요.");
    const value = requiredString(input, "status", { maxLength: 20 }, "INQUIRY_STATUS_INVALID", "문의 상태를 확인해 주세요.");
    const nextStatus = STATUS_VALUES[value as keyof typeof STATUS_VALUES];
    if (!nextStatus || nextStatus === InquiryStatus.ANSWERED) {
      throw new ApiError("INQUIRY_STATUS_INVALID", "문의 상태를 확인해 주세요.", HttpStatus.BAD_REQUEST);
    }
    const existing = await this.requireInquiry(inquiryId);
    if (existing.status === nextStatus) return { inquiry: inquiryView(existing) };
    if (!STATUS_TRANSITIONS[existing.status].includes(nextStatus)) {
      throw new ApiError("INQUIRY_STATUS_TRANSITION_INVALID", "현재 문의 상태에서 요청한 상태로 변경할 수 없습니다.", HttpStatus.CONFLICT);
    }
    const previousStatus = existing.status;
    const inquiry = await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.inquiry.update({
        where: { id: inquiryId, status: previousStatus },
        data: {
          status: nextStatus,
          ...(nextStatus === InquiryStatus.IN_REVIEW && previousStatus === InquiryStatus.ANSWERED
            ? { answer: null, answeredById: null, answeredAt: null }
            : {}),
        },
        include: { attachment: true },
      });
      if (nextStatus === InquiryStatus.IN_REVIEW && previousStatus === InquiryStatus.ANSWERED) {
        await transaction.userNotification.deleteMany({
          where: {
            userId: existing.requesterUserId,
            kind: UserNotificationKind.INQUIRY_ANSWERED,
            resourceType: "Inquiry",
            resourceId: inquiryId,
            resourceVersion: existing.answerVersion,
          },
        });
      }
      await transaction.auditLog.create({
        data: {
          actorId: user.id,
          action: "inquiry.status_changed",
          resourceType: "Inquiry",
          resourceId: inquiryId,
          requestId: requestId ?? null,
          metadata: { previousStatus: previousStatus.toLowerCase(), status: nextStatus.toLowerCase() },
        },
      });
      return updated;
    });
    return { inquiry: inquiryView(inquiry) };
  }

  private async requireInquiry(inquiryId: string) {
    const inquiry = await this.prisma.inquiry.findUnique({ where: { id: inquiryId }, include: { attachment: true } });
    if (!inquiry) throw new ApiError("INQUIRY_NOT_FOUND", "문의 내역을 찾을 수 없습니다.", HttpStatus.NOT_FOUND);
    return inquiry;
  }

}

function inquiryView(item: {
  id: string; requesterUserId: string; category: string; title: string; content: string;
  status: InquiryStatus; answer: string | null; answeredById: string | null;
  answeredAt: Date | null; createdAt: Date; updatedAt: Date;
  attachment?: {
    id: string; originalName: string; contentType: string; size: number; status: InquiryAttachmentStatus;
  } | null;
}) {
  return {
    id: item.id,
    requesterUserId: item.requesterUserId,
    category: item.category,
    title: item.title,
    content: item.content,
    status: item.status.toLowerCase(),
    answer: item.answer,
    answeredById: item.answeredById,
    answeredAt: item.answeredAt,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    attachment: item.attachment?.status === InquiryAttachmentStatus.READY
      ? attachmentView(item.attachment)
      : null,
  };
}

function readStatus(value: unknown): InquiryStatus | undefined {
  const normalized = readQueryString(value, 20);
  if (!normalized || normalized === "all") return undefined;
  const status = STATUS_VALUES[normalized as keyof typeof STATUS_VALUES];
  if (!status) invalidFilter();
  return status;
}

function readQueryString(value: unknown, maxLength: number): string {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string") invalidFilter();
  const normalized = value.trim();
  if (normalized.length > maxLength) invalidFilter();
  return normalized;
}

function readInteger(value: unknown, minimum: number, maximum: number, fallback: number): number {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value !== "string" || !/^\d+$/u.test(value)) invalidFilter();
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) invalidFilter();
  return parsed;
}

function invalidFilter(): never {
  throw new ApiError("INQUIRY_FILTER_INVALID", "문의 조회 조건을 확인해 주세요.", HttpStatus.BAD_REQUEST);
}
