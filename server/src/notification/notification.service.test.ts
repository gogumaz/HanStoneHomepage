import { describe, expect, it, vi } from "vitest";
import type { CurrentUser } from "../auth/auth.types.js";
import type { PrismaService } from "../database/prisma.service.js";
import { NotificationService } from "./notification.service.js";

const user = { id: "user-1", roles: ["student"] } as CurrentUser;
const item = { id: "notice-1", userId: user.id, kind: "INQUIRY_ANSWERED", resourceType: "Inquiry", resourceId: "inquiry-1", resourceVersion: 1, title: "답변 등록", message: "문의함 확인", readAt: null, createdAt: new Date() };

describe("NotificationService", () => {
  it("lists only the current user's notifications and unread count", async () => {
    const prisma = { userNotification: {
      findMany: vi.fn(async () => [item]),
      count: vi.fn(async ({ where }: any) => where.readAt === null ? 1 : 1),
    } } as unknown as PrismaService;
    const result = await new NotificationService(prisma).listMine(user, { page: "1", pageSize: "20" });
    expect(result.items[0]).toMatchObject({ kind: "inquiry_answered", resourceId: "inquiry-1" });
    expect(result.items[0]).not.toHaveProperty("userId");
    expect(result.unreadCount).toBe(1);
    expect((prisma.userNotification.findMany as any)).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: user.id } }));
  });

  it("marks an owned notification read and rejects another user's id", async () => {
    const update = vi.fn(async () => ({ ...item, readAt: new Date() }));
    const findFirst = vi.fn(async ({ where }: any) => where.id === item.id ? item : null);
    const prisma = { userNotification: { findFirst, update } } as unknown as PrismaService;
    const service = new NotificationService(prisma);
    await expect(service.markRead(user, item.id)).resolves.toMatchObject({ notification: { id: item.id } });
    await expect(service.markRead(user, "other")).rejects.toMatchObject({ code: "NOTIFICATION_NOT_FOUND" });
  });
});
