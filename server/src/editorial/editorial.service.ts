import { HttpStatus, Injectable } from "@nestjs/common";
import type { CurrentUser } from "../auth/auth.types.js";
import { ApiError } from "../common/api-error.js";
import { PrismaService } from "../database/prisma.service.js";
import { EditorialContentStatus, EditorialContentType } from "../generated/prisma/enums.js";
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
  constructor(private readonly prisma: PrismaService) {}

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
    return this.create(user, EditorialContentType.NOTICE, {
      ...input,
      status: EditorialContentStatus.PUBLISHED,
      displayOrder: null,
    }, requestId);
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
  ) {
    const item = await this.prisma.$transaction(async (transaction) => {
      const created = await transaction.editorialContent.create({
        data: { ...data, type, createdById: user.id, updatedById: user.id },
      });
      await transaction.auditLog.create({
        data: {
          actorId: user.id,
          action: `editorial.${type.toLowerCase()}.created`,
          resourceType: "EditorialContent",
          resourceId: created.id,
          requestId: requestId ?? null,
          metadata: { type: type.toLowerCase(), category: created.category, status: created.status.toLowerCase() },
        },
      });
      return created;
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
    const updateData = {
      ...data,
      ...(data.status === EditorialContentStatus.PUBLISHED && !data.publishedAt && !existing.publishedAt
        ? { publishedAt: new Date() }
        : {}),
      updatedById: user.id,
    };
    const changedFields = Object.keys(data).sort();
    const item = await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.editorialContent.update({ where: { id: contentId }, data: updateData });
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
      return updated;
    });
    return { item: adminView(item) };
  }

  private async requireContent(type: EditorialContentType, contentId: string) {
    const item = await this.prisma.editorialContent.findFirst({ where: { id: contentId, type } });
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
  };
}

function adminView(item: EditorialItem) {
  return {
    ...publicView(item),
    status: item.status.toLowerCase(),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

type EditorialItem = {
  id: string;
  category: string;
  title: string;
  content: string;
  status: EditorialContentStatus;
  isPinned: boolean;
  displayOrder: number | null;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
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

function invalidFilter(): never {
  throw new ApiError("EDITORIAL_FILTER_INVALID", "게시글 조회 조건을 확인해 주세요.", HttpStatus.BAD_REQUEST);
}
