import { HttpStatus, Injectable } from "@nestjs/common";
import type { CurrentUser } from "../auth/auth.types.js";
import { ApiError } from "../common/api-error.js";
import { PrismaService } from "../database/prisma.service.js";
import {
  CommunityAttachmentKind,
  CommunityAttachmentStatus,
  EditorialContentStatus,
  EditorialContentType,
} from "../generated/prisma/enums.js";
import { ObjectStorageService } from "../storage/object-storage.service.js";
import {
  FAQ_CATEGORIES,
  NOTICE_CATEGORIES,
  validateFaqCreate,
  validateFaqUpdate,
  validateNoticeCreate,
  validateNoticeUpdate,
} from "./editorial-validation.js";

@Injectable()
export class EditorialService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorageService,
  ) {}

  listPublicNotices(query: Record<string, unknown>) {
    return this.list(EditorialContentType.NOTICE, query, false);
  }

  listPublicFaqs(query: Record<string, unknown>) {
    return this.list(EditorialContentType.FAQ, query, false);
  }

  listAdminNotices(query: Record<string, unknown>) {
    return this.list(EditorialContentType.NOTICE, query, true);
  }

  listAdminFaqs(query: Record<string, unknown>) {
    return this.list(EditorialContentType.FAQ, query, true);
  }

  async createNotice(user: CurrentUser, body: unknown, requestId?: string) {
    const input = validateNoticeCreate(body);
    const { attachmentId, ...content } = input;
    return this.create(user, EditorialContentType.NOTICE, {
      ...content,
      status: EditorialContentStatus.PUBLISHED,
      displayOrder: null,
    }, requestId, attachmentId);
  }

  async createFaq(user: CurrentUser, body: unknown, requestId?: string) {
    const input = validateFaqCreate(body);
    return this.create(user, EditorialContentType.FAQ, {
      ...input,
      isPinned: false,
    }, requestId);
  }

  async updateNotice(user: CurrentUser, contentId: string, body: unknown, requestId?: string) {
    return this.update(
      user,
      EditorialContentType.NOTICE,
      contentId,
      validateNoticeUpdate(body),
      requestId,
    );
  }

  async downloadNotice(contentId: string, admin = false) {
    const attachment = await this.prisma.communityAttachment.findFirst({
      where: {
        editorialContentId: contentId,
        status: CommunityAttachmentStatus.READY,
        editorialContent: {
          type: EditorialContentType.NOTICE,
          ...(admin ? {} : {
            status: EditorialContentStatus.PUBLISHED,
            publishedAt: { lte: new Date() },
          }),
        },
      },
    });
    if (!attachment) attachmentNotFound();
    return this.storage.signAssetUrl(attachment.objectKey, {
      contentType: attachment.contentType,
      fileName: attachment.originalName,
      inline: false,
    });
  }

  async updateFaq(user: CurrentUser, contentId: string, body: unknown, requestId?: string) {
    return this.update(user, EditorialContentType.FAQ, contentId, validateFaqUpdate(body), requestId);
  }

  async archive(user: CurrentUser, type: EditorialContentType, contentId: string, requestId?: string) {
    const existing = await this.requireContent(type, contentId);
    if (existing.status === EditorialContentStatus.ARCHIVED) return { item: adminView(existing) };
    const item = await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.editorialContent.update({
        where: { id: contentId },
        data: { status: EditorialContentStatus.ARCHIVED, updatedById: user.id },
        include: { attachment: true },
      });
      await transaction.auditLog.create({
        data: {
          actorId: user.id,
          action: `editorial.${type.toLowerCase()}.archived`,
          resourceType: "EditorialContent",
          resourceId: contentId,
          requestId: requestId ?? null,
          metadata: { type: type.toLowerCase(), previousStatus: existing.status.toLowerCase(), status: "archived" },
        },
      });
      return updated;
    });
    return { item: adminView(item) };
  }

  private async list(type: EditorialContentType, query: Record<string, unknown>, admin: boolean) {
    const category = readQueryString(query.category, 30);
    const allowedCategories = type === EditorialContentType.NOTICE ? NOTICE_CATEGORIES : FAQ_CATEGORIES;
    if (category && !(allowedCategories as readonly string[]).includes(category)) invalidFilter();
    const search = readQueryString(query.q, 100);
    const page = readQueryInteger(query.page, 1, 100_000, 1);
    const pageSize = readQueryInteger(query.pageSize, 1, 100, 50);
    const status = admin ? readStatus(query.status) : EditorialContentStatus.PUBLISHED;
    const now = new Date();
    const where = {
      type,
      ...(status ? { status } : {}),
      ...(!admin ? { publishedAt: { lte: now } } : {}),
      ...(category ? { category } : {}),
      ...(search ? { OR: [
        { title: { contains: search, mode: "insensitive" as const } },
        { content: { contains: search, mode: "insensitive" as const } },
      ] } : {}),
    };
    const orderBy = type === EditorialContentType.NOTICE
      ? [{ isPinned: "desc" as const }, { publishedAt: "desc" as const }, { id: "desc" as const }]
      : [{ displayOrder: "asc" as const }, { publishedAt: "desc" as const }, { id: "asc" as const }];
    const [items, total] = await Promise.all([
      this.prisma.editorialContent.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { attachment: true },
      }),
      this.prisma.editorialContent.count({ where }),
    ]);
    return {
      items: items.map(admin ? adminView : publicView),
      pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    };
  }

  private async create(
    user: CurrentUser,
    type: EditorialContentType,
    data: EditorialCreateData,
    requestId?: string,
    attachmentId?: string | null,
  ) {
    const item = await this.prisma.$transaction(async (transaction) => {
      const created = await transaction.editorialContent.create({
        data: { ...data, type, createdById: user.id, updatedById: user.id },
      });
      if (attachmentId) {
        const attached = await transaction.communityAttachment.updateMany({
          where: {
            id: attachmentId,
            ownerUserId: user.id,
            postId: null,
            editorialContentId: null,
            status: CommunityAttachmentStatus.READY,
            kind: CommunityAttachmentKind.MATERIAL,
          },
          data: { editorialContentId: created.id },
        });
        if (attached.count !== 1) invalidAttachment();
      }
      await transaction.auditLog.create({
        data: {
          actorId: user.id,
          action: `editorial.${type.toLowerCase()}.created`,
          resourceType: "EditorialContent",
          resourceId: created.id,
          requestId: requestId ?? null,
          metadata: {
            type: type.toLowerCase(),
            category: created.category,
            status: created.status.toLowerCase(),
            hasAttachment: Boolean(attachmentId),
          },
        },
      });
      return transaction.editorialContent.findUniqueOrThrow({
        where: { id: created.id },
        include: { attachment: true },
      });
    });
    return { item: adminView(item) };
  }

  private async update(
    user: CurrentUser,
    type: EditorialContentType,
    contentId: string,
    data: Record<string, unknown>,
    requestId?: string,
  ) {
    const existing = await this.requireContent(type, contentId);
    const { attachmentId, ...contentData } = data;
    const attachmentChanged = type === EditorialContentType.NOTICE && Object.hasOwn(data, "attachmentId");
    const updateData = {
      ...contentData,
      ...(contentData.status === EditorialContentStatus.PUBLISHED && !contentData.publishedAt && !existing.publishedAt
        ? { publishedAt: new Date() }
        : {}),
      updatedById: user.id,
    };
    const changedFields = [
      ...Object.keys(contentData),
      ...(attachmentChanged ? ["attachment"] : []),
    ].sort();
    const item = await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.editorialContent.update({
        where: { id: contentId },
        data: updateData,
        include: { attachment: true },
      });
      if (attachmentChanged) {
        await transaction.communityAttachment.updateMany({
          where: { editorialContentId: contentId },
          data: { editorialContentId: null },
        });
        if (attachmentId) {
          const attached = await transaction.communityAttachment.updateMany({
            where: {
              id: attachmentId,
              ownerUserId: user.id,
              postId: null,
              editorialContentId: null,
              status: CommunityAttachmentStatus.READY,
              kind: CommunityAttachmentKind.MATERIAL,
            },
            data: { editorialContentId: contentId },
          });
          if (attached.count !== 1) invalidAttachment();
        }
      }
      await transaction.auditLog.create({
        data: {
          actorId: user.id,
          action: `editorial.${type.toLowerCase()}.updated`,
          resourceType: "EditorialContent",
          resourceId: contentId,
          requestId: requestId ?? null,
          metadata: {
            type: type.toLowerCase(),
            previousStatus: existing.status.toLowerCase(),
            status: updated.status.toLowerCase(),
            changedFields,
          },
        },
      });
      return attachmentChanged
        ? transaction.editorialContent.findUniqueOrThrow({
            where: { id: contentId },
            include: { attachment: true },
          })
        : updated;
    });
    return { item: adminView(item) };
  }

  private async requireContent(type: EditorialContentType, contentId: string) {
    const item = await this.prisma.editorialContent.findFirst({
      where: { id: contentId, type },
      include: { attachment: true },
    });
    if (!item) {
      throw new ApiError("EDITORIAL_CONTENT_NOT_FOUND", "게시글을 찾을 수 없습니다.", HttpStatus.NOT_FOUND);
    }
    return item;
  }
}

function publicView(item: EditorialItem) {
  return {
    id: item.id,
    category: item.category,
    title: item.title,
    content: item.content,
    authorLabel: "운영자",
    publishedAt: item.publishedAt,
    isPinned: item.isPinned,
    displayOrder: item.displayOrder,
    status: "published",
    attachment: readyAttachment(item, false),
  };
}

function adminView(item: EditorialItem) {
  return {
    ...publicView(item),
    status: item.status.toLowerCase(),
    attachment: readyAttachment(item, true),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

type EditorialItem = {
  id: string;
  type: EditorialContentType;
  category: string;
  title: string;
  content: string;
  status: EditorialContentStatus;
  isPinned: boolean;
  displayOrder: number | null;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  attachment?: {
    id: string;
    originalName: string;
    contentType: string;
    size: number;
    status: CommunityAttachmentStatus;
  } | null;
};

type EditorialCreateData = {
  category: string;
  title: string;
  content: string;
  status: EditorialContentStatus;
  isPinned: boolean;
  displayOrder: number | null;
  publishedAt: Date | null;
};

function readyAttachment(item: EditorialItem, admin: boolean) {
  if (
    item.type !== EditorialContentType.NOTICE
    || !item.attachment
    || item.attachment.status !== CommunityAttachmentStatus.READY
  ) return null;
  const prefix = admin ? "/api/v1/admin/notices" : "/api/v1/notices";
  return {
    id: item.attachment.id,
    originalName: item.attachment.originalName,
    contentType: item.attachment.contentType,
    size: item.attachment.size,
    status: "ready" as const,
    downloadUrl: `${prefix}/${encodeURIComponent(item.id)}/attachment`,
  };
}

function readStatus(value: unknown): EditorialContentStatus | undefined {
  const normalized = readQueryString(value, 20);
  if (!normalized || normalized === "all") return undefined;
  const values = {
    draft: EditorialContentStatus.DRAFT,
    published: EditorialContentStatus.PUBLISHED,
    archived: EditorialContentStatus.ARCHIVED,
  } as const;
  const result = values[normalized as keyof typeof values];
  if (!result) invalidFilter();
  return result;
}

function readQueryString(value: unknown, maxLength: number): string {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string") invalidFilter();
  const normalized = value.trim();
  if (normalized.length > maxLength) invalidFilter();
  return normalized;
}

function readQueryInteger(value: unknown, minimum: number, maximum: number, fallback: number): number {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value !== "string" || !/^\d+$/u.test(value)) invalidFilter();
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) invalidFilter();
  return parsed;
}

function invalidAttachment(): never {
  throw new ApiError(
    "EDITORIAL_ATTACHMENT_NOT_READY",
    "안전 검사를 통과한 본인 첨부파일만 공지에 연결할 수 있습니다.",
    HttpStatus.CONFLICT,
  );
}

function attachmentNotFound(): never {
  throw new ApiError(
    "EDITORIAL_ATTACHMENT_NOT_FOUND",
    "공지 첨부파일을 찾을 수 없습니다.",
    HttpStatus.NOT_FOUND,
  );
}

function invalidFilter(): never {
  throw new ApiError("EDITORIAL_FILTER_INVALID", "게시글 조회 조건을 확인해 주세요.", HttpStatus.BAD_REQUEST);
}
