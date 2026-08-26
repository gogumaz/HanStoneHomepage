import { HttpStatus, Injectable } from "@nestjs/common";
import type { CurrentUser } from "../auth/auth.types.js";
import { ApiError } from "../common/api-error.js";
import { PrismaService } from "../database/prisma.service.js";
import {
  CommunityAttachmentKind,
  CommunityAttachmentStatus,
  CommunityPostStatus,
  CommunityPostType,
} from "../generated/prisma/enums.js";
import {
  readCommunityPostType,
  validateCommunityPostCreate,
  validateCommunityPostUpdate,
  validateRejection,
} from "./community-validation.js";

@Injectable()
export class CommunityService {
  constructor(private readonly prisma: PrismaService) {}

  async listPublic(query: Record<string, unknown>, user?: CurrentUser) {
    return this.list(query, user, false);
  }

  async listAdmin(query: Record<string, unknown>) {
    return this.list(query, undefined, true);
  }

  async create(user: CurrentUser, body: unknown, requestId?: string) {
    const input = validateCommunityPostCreate(body);
    const { attachmentId, ...postInput } = input;
    const published = canModerate(user);
    const now = new Date();
    const item = await this.prisma.$transaction(async (transaction) => {
      const created = await transaction.communityPost.create({
        data: {
          ...postInput,
          authorUserId: user.id,
          status: published ? CommunityPostStatus.PUBLISHED : CommunityPostStatus.PENDING_REVIEW,
          publishedAt: published ? now : null,
          reviewedById: published ? user.id : null,
          reviewedAt: published ? now : null,
        },
      });
      if (attachmentId) {
        const attached = await transaction.communityAttachment.updateMany({
          where: {
            id: attachmentId,
            ownerUserId: user.id,
            postId: null,
            status: CommunityAttachmentStatus.READY,
            kind: expectedAttachmentKind(input.type),
          },
          data: { postId: created.id },
        });
        if (attached.count !== 1) invalidAttachment();
      }
      await transaction.auditLog.create({
        data: {
          actorId: user.id,
          action: "community.post.created",
          resourceType: "CommunityPost",
          resourceId: created.id,
          requestId: requestId ?? null,
          metadata: {
            type: created.type.toLowerCase(),
            category: created.category,
            status: created.status.toLowerCase(),
            hasAttachment: Boolean(attachmentId),
            ...(created.publicationConsentVersion ? { consentVersion: created.publicationConsentVersion } : {}),
          },
        },
      });
      return transaction.communityPost.findUniqueOrThrow({
        where: { id: created.id },
        include: { author: { select: { displayName: true } }, attachment: true },
      });
    });
    return { post: postView(item, true) };
  }

  async update(user: CurrentUser, postId: string, body: unknown, requestId?: string) {
    const existing = await this.requirePost(postId);
    this.requireOwnerOrModerator(user, existing.authorUserId);
    if (existing.status === CommunityPostStatus.ARCHIVED) {
      throw new ApiError("COMMUNITY_POST_ARCHIVED", "보관된 게시글은 수정할 수 없습니다.", HttpStatus.CONFLICT);
    }
    if (existing.status === CommunityPostStatus.HIDDEN && !canModerate(user)) {
      throw new ApiError("COMMUNITY_POST_HIDDEN", "숨김 처리된 게시글은 수정할 수 없습니다.", HttpStatus.CONFLICT);
    }
    const validated = validateCommunityPostUpdate(existing.type, body);
    const { attachmentId, ...data } = validated;
    const attachmentChanged = Object.hasOwn(validated, "attachmentId");
    const moderator = canModerate(user);
    const nextStatus = moderator ? existing.status : CommunityPostStatus.PENDING_REVIEW;
    const item = await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.communityPost.update({
        where: { id: postId },
        data: {
          ...data,
          status: nextStatus,
          ...(!moderator ? {
            publishedAt: null,
            reviewedById: null,
            reviewedAt: null,
            rejectionReason: null,
          } : {}),
        },
        include: { author: { select: { displayName: true } }, attachment: true },
      });
      if (attachmentChanged) {
        await transaction.communityAttachment.updateMany({
          where: { postId },
          data: { postId: null },
        });
        if (attachmentId) {
          const attached = await transaction.communityAttachment.updateMany({
            where: {
              id: attachmentId,
              ownerUserId: user.id,
              postId: null,
              status: CommunityAttachmentStatus.READY,
              kind: expectedAttachmentKind(existing.type),
            },
            data: { postId },
          });
          if (attached.count !== 1) invalidAttachment();
        }
      }
      await transaction.auditLog.create({
        data: {
          actorId: user.id,
          action: "community.post.updated",
          resourceType: "CommunityPost",
          resourceId: postId,
          requestId: requestId ?? null,
          metadata: {
            type: existing.type.toLowerCase(),
            previousStatus: existing.status.toLowerCase(),
            status: nextStatus.toLowerCase(),
            changedFields: [...Object.keys(data), ...(attachmentChanged ? ["attachment"] : [])].sort(),
          },
        },
      });
      return attachmentChanged
        ? transaction.communityPost.findUniqueOrThrow({
            where: { id: postId },
            include: { author: { select: { displayName: true } }, attachment: true },
          })
        : updated;
    });
    return { post: postView(item, true) };
  }

  async publish(user: CurrentUser, postId: string, requestId?: string) {
    const existing = await this.requirePost(postId);
    if (existing.status === CommunityPostStatus.ARCHIVED) invalidTransition();
    if (existing.status === CommunityPostStatus.PUBLISHED) {
      return { post: postView(existing, true) };
    }
    return this.review(user, existing, CommunityPostStatus.PUBLISHED, null, requestId);
  }

  async reject(user: CurrentUser, postId: string, body: unknown, requestId?: string) {
    const reason = validateRejection(body);
    const existing = await this.requirePost(postId);
    if (existing.status !== CommunityPostStatus.PENDING_REVIEW) invalidTransition();
    return this.review(user, existing, CommunityPostStatus.REJECTED, reason, requestId);
  }

  async archive(user: CurrentUser, postId: string, requestId?: string) {
    const existing = await this.requirePost(postId);
    this.requireOwnerOrModerator(user, existing.authorUserId);
    if (existing.status === CommunityPostStatus.ARCHIVED) {
      return { post: postView(existing, true) };
    }
    const item = await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.communityPost.update({
        where: { id: postId },
        data: { status: CommunityPostStatus.ARCHIVED },
        include: { author: { select: { displayName: true } }, attachment: true },
      });
      await transaction.auditLog.create({
        data: {
          actorId: user.id,
          action: "community.post.archived",
          resourceType: "CommunityPost",
          resourceId: postId,
          requestId: requestId ?? null,
          metadata: { type: existing.type.toLowerCase(), previousStatus: existing.status.toLowerCase(), status: "archived" },
        },
      });
      return updated;
    });
    return { post: postView(item, true) };
  }

  private async list(query: Record<string, unknown>, user: CurrentUser | undefined, admin: boolean) {
    const type = readCommunityPostType(query.type);
    const status = admin ? readStatus(query.status) : undefined;
    const category = readQueryString(query.category, 30);
    const search = readQueryString(query.q, 100);
    const page = readQueryInteger(query.page, 1, 100_000, 1);
    const pageSize = readQueryInteger(query.pageSize, 1, 100, 50);
    const publicScope = { status: CommunityPostStatus.PUBLISHED, publishedAt: { lte: new Date() } };
    const where = {
      type,
      ...(admin
        ? (status ? { status } : {})
        : user
          ? { OR: [publicScope, { authorUserId: user.id, status: { not: CommunityPostStatus.ARCHIVED } }] }
          : publicScope),
      ...(category ? { category } : {}),
      ...(search ? { AND: [{ OR: [
        { title: { contains: search, mode: "insensitive" as const } },
        { content: { contains: search, mode: "insensitive" as const } },
      ] }] } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.communityPost.findMany({
        where,
        orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { author: { select: { displayName: true } }, attachment: true },
      }),
      this.prisma.communityPost.count({ where }),
    ]);
    return {
      items: items.map((item) => postView(item, admin || item.authorUserId === user?.id)),
      pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    };
  }

  private async review(
    user: CurrentUser,
    existing: CommunityItem,
    status: CommunityPostStatus,
    rejectionReason: string | null,
    requestId?: string,
  ) {
    const now = new Date();
    const item = await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.communityPost.update({
        where: { id: existing.id },
        data: {
          status,
          rejectionReason,
          reviewedById: user.id,
          reviewedAt: now,
          publishedAt: status === CommunityPostStatus.PUBLISHED ? now : null,
        },
        include: { author: { select: { displayName: true } }, attachment: true },
      });
      await transaction.auditLog.create({
        data: {
          actorId: user.id,
          action: `community.post.${status === CommunityPostStatus.PUBLISHED ? "published" : "rejected"}`,
          resourceType: "CommunityPost",
          resourceId: existing.id,
          requestId: requestId ?? null,
          metadata: { type: existing.type.toLowerCase(), previousStatus: existing.status.toLowerCase(), status: status.toLowerCase() },
        },
      });
      return updated;
    });
    return { post: postView(item, true) };
  }

  private async requirePost(postId: string) {
    const item = await this.prisma.communityPost.findUnique({
      where: { id: postId },
      include: { author: { select: { displayName: true } }, attachment: true },
    });
    if (!item) throw new ApiError("COMMUNITY_POST_NOT_FOUND", "게시글을 찾을 수 없습니다.", HttpStatus.NOT_FOUND);
    return item;
  }

  private requireOwnerOrModerator(user: CurrentUser, authorUserId: string) {
    if (authorUserId !== user.id && !canModerate(user)) {
      throw new ApiError("COMMUNITY_POST_NOT_FOUND", "게시글을 찾을 수 없습니다.", HttpStatus.NOT_FOUND);
    }
  }
}

function postView(item: CommunityItem, revealModeration: boolean) {
  return {
    id: item.id,
    type: item.type === CommunityPostType.CLASS_TIP ? "classTip" : "travel",
    category: item.category,
    title: item.title,
    content: item.content,
    targetGrade: item.targetGrade,
    era: item.era,
    badukLevel: item.badukLevel,
    className: item.className,
    authorLabel: item.author.displayName,
    status: item.status.toLowerCase(),
    publishedAt: item.publishedAt,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    ...(item.type === CommunityPostType.TRAVEL ? { consent: true } : {}),
    ...(item.attachment ? { attachment: {
      originalName: item.attachment.originalName,
      contentType: item.attachment.contentType,
      size: item.attachment.size,
      kind: item.attachment.kind === CommunityAttachmentKind.PHOTO ? "photo" : "material",
      downloadUrl: `/api/v1/posts/${encodeURIComponent(item.id)}/attachment`,
    } } : {}),
    ...(revealModeration && item.rejectionReason ? { rejectionReason: item.rejectionReason } : {}),
  };
}

type CommunityItem = {
  id: string;
  type: CommunityPostType;
  authorUserId: string;
  category: string;
  title: string;
  content: string;
  targetGrade: string | null;
  era: string | null;
  badukLevel: string | null;
  className: string | null;
  status: CommunityPostStatus;
  rejectionReason: string | null;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  author: { displayName: string };
  attachment?: {
    kind: CommunityAttachmentKind;
    originalName: string;
    contentType: string;
    size: number;
  } | null;
};

function canModerate(user: CurrentUser): boolean {
  return user.roles.includes("operator") || user.roles.includes("admin");
}

function expectedAttachmentKind(type: CommunityPostType): CommunityAttachmentKind {
  return type === CommunityPostType.TRAVEL ? CommunityAttachmentKind.PHOTO : CommunityAttachmentKind.MATERIAL;
}

function invalidAttachment(): never {
  throw new ApiError(
    "COMMUNITY_ATTACHMENT_NOT_READY",
    "검사를 통과한 본인 첨부파일만 게시글에 연결할 수 있습니다.",
    HttpStatus.CONFLICT,
  );
}

function readStatus(value: unknown): CommunityPostStatus | undefined {
  const normalized = readQueryString(value, 30);
  if (!normalized || normalized === "all") return undefined;
  const values = {
    pending_review: CommunityPostStatus.PENDING_REVIEW,
    published: CommunityPostStatus.PUBLISHED,
    rejected: CommunityPostStatus.REJECTED,
    hidden: CommunityPostStatus.HIDDEN,
    archived: CommunityPostStatus.ARCHIVED,
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

function invalidFilter(): never {
  throw new ApiError("COMMUNITY_FILTER_INVALID", "커뮤니티 조회 조건을 확인해 주세요.", HttpStatus.BAD_REQUEST);
}

function invalidTransition(): never {
  throw new ApiError(
    "COMMUNITY_STATUS_TRANSITION_INVALID",
    "현재 게시글 상태에서는 요청한 작업을 수행할 수 없습니다.",
    HttpStatus.CONFLICT,
  );
}
