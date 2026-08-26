import { Controller, Get, Param, Patch, Query, UseGuards } from "@nestjs/common";
import type { CurrentUser as CurrentUserValue } from "../auth/auth.types.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { SessionAuthGuard } from "../auth/session-auth.guard.js";
import { NotificationService } from "./notification.service.js";

@Controller("me/notifications")
@UseGuards(SessionAuthGuard)
export class NotificationController {
  constructor(private readonly notifications: NotificationService) {}
  @Get() list(@CurrentUser() user: CurrentUserValue, @Query() query: Record<string, unknown>) { return this.notifications.listMine(user, query); }
  @Patch("read-all") markAll(@CurrentUser() user: CurrentUserValue) { return this.notifications.markAllRead(user); }
  @Patch(":notificationId/read") markRead(@CurrentUser() user: CurrentUserValue, @Param("notificationId") id: string) { return this.notifications.markRead(user, id); }
}
