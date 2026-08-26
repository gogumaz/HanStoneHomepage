import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import type { CurrentUser as CurrentUserValue } from "../auth/auth.types.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { Roles } from "../auth/roles.decorator.js";
import { RolesGuard } from "../auth/roles.guard.js";
import { SessionAuthGuard } from "../auth/session-auth.guard.js";
import type { ApiRequest } from "../common/http-types.js";
import { EditorialContentType } from "../generated/prisma/enums.js";
import { EditorialService } from "./editorial.service.js";

@Controller()
export class EditorialController {
  constructor(private readonly editorial: EditorialService) {}

  @Get("notices")
  listNotices(@Query() query: Record<string, unknown>) {
    return this.editorial.listPublicNotices(query);
  }

  @Get("faqs")
  listFaqs(@Query() query: Record<string, unknown>) {
    return this.editorial.listPublicFaqs(query);
  }

  @Get("admin/notices")
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles("operator", "admin")
  listAdminNotices(@Query() query: Record<string, unknown>) {
    return this.editorial.listAdminNotices(query);
  }

  @Get("admin/faqs")
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles("operator", "admin")
  listAdminFaqs(@Query() query: Record<string, unknown>) {
    return this.editorial.listAdminFaqs(query);
  }

  @Post("admin/notices")
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles("operator", "admin")
  createNotice(@CurrentUser() user: CurrentUserValue, @Body() body: unknown, @Req() request: ApiRequest) {
    return this.editorial.createNotice(user, body, request.requestId);
  }

  @Post("admin/faqs")
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles("operator", "admin")
  createFaq(@CurrentUser() user: CurrentUserValue, @Body() body: unknown, @Req() request: ApiRequest) {
    return this.editorial.createFaq(user, body, request.requestId);
  }

  @Patch("admin/notices/:contentId")
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles("operator", "admin")
  updateNotice(
    @CurrentUser() user: CurrentUserValue,
    @Param("contentId") contentId: string,
    @Body() body: unknown,
    @Req() request: ApiRequest,
  ) {
    return this.editorial.updateNotice(user, contentId, body, request.requestId);
  }

  @Patch("admin/faqs/:contentId")
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles("operator", "admin")
  updateFaq(
    @CurrentUser() user: CurrentUserValue,
    @Param("contentId") contentId: string,
    @Body() body: unknown,
    @Req() request: ApiRequest,
  ) {
    return this.editorial.updateFaq(user, contentId, body, request.requestId);
  }

  @Delete("admin/notices/:contentId")
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles("operator", "admin")
  archiveNotice(
    @CurrentUser() user: CurrentUserValue,
    @Param("contentId") contentId: string,
    @Req() request: ApiRequest,
  ) {
    return this.editorial.archive(user, EditorialContentType.NOTICE, contentId, request.requestId);
  }

  @Delete("admin/faqs/:contentId")
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles("operator", "admin")
  archiveFaq(
    @CurrentUser() user: CurrentUserValue,
    @Param("contentId") contentId: string,
    @Req() request: ApiRequest,
  ) {
    return this.editorial.archive(user, EditorialContentType.FAQ, contentId, request.requestId);
  }
}
