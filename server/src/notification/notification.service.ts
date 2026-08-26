import { HttpStatus, Injectable } from "@nestjs/common";
import type { CurrentUser } from "../auth/auth.types.js";
import { ApiError } from "../common/api-error.js";
import { PrismaService } from "../database/prisma.service.js";

@Injectable()
export class NotificationService {
  constructor(private readonly prisma: PrismaService) {}

  async listMine(user: CurrentUser, query: Record<string, unknown>) {
    const page = integer(query.page, 1, 100_000, 1);
    const pageSize = integer(query.pageSize, 1, 50, 20);
    const where = { userId: user.id };
    const [items, total, unreadCount] = await Promise.all([
      this.prisma.userNotification.findMany({
        where, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * pageSize, take: pageSize,
      }),
      this.prisma.userNotification.count({ where }),
      this.prisma.userNotification.count({ where: { userId: user.id, readAt: null } }),
    ]);
    return { items: items.map(view), unreadCount, pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } };
  }

  async markRead(user: CurrentUser, notificationId: string) {
    const existing = await this.prisma.userNotification.findFirst({ where: { id: notificationId, userId: user.id } });
    if (!existing) throw new ApiError("NOTIFICATION_NOT_FOUND", "알림을 찾을 수 없습니다.", HttpStatus.NOT_FOUND);
    if (existing.readAt) return { notification: view(existing) };
    const notification = await this.prisma.userNotification.update({ where: { id: existing.id }, data: { readAt: new Date() } });
    return { notification: view(notification) };
  }

  async markAllRead(user: CurrentUser) {
    const readAt = new Date();
    const result = await this.prisma.userNotification.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt } });
    return { updated: result.count, readAt: readAt.toISOString() };
  }
}

function integer(value: unknown, min: number, max: number, fallback: number) {
  if (value === undefined || value === "") return fallback;
  if (typeof value !== "string" || !/^\d+$/u.test(value)) invalid();
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) invalid();
  return parsed;
}
function invalid(): never { throw new ApiError("NOTIFICATION_FILTER_INVALID", "알림 조회 조건을 확인해 주세요.", HttpStatus.BAD_REQUEST); }
function view(item: { id: string; kind: string; resourceType: string; resourceId: string; resourceVersion: number; title: string; message: string; readAt: Date | null; createdAt: Date }) {
  return {
    id: item.id,
    kind: item.kind.toLowerCase(),
    resourceType: item.resourceType,
    resourceId: item.resourceId,
    resourceVersion: item.resourceVersion,
    title: item.title,
    message: item.message,
    readAt: item.readAt,
    createdAt: item.createdAt,
  };
}
