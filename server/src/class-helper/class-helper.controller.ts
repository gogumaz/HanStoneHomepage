import { Body, Controller, Delete, Get, Header, Param, Patch, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import type { CurrentUser as CurrentUserValue } from "../auth/auth.types.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { Roles } from "../auth/roles.decorator.js";
import { RolesGuard } from "../auth/roles.guard.js";
import { SessionAuthGuard } from "../auth/session-auth.guard.js";
import type { ApiRequest } from "../common/http-types.js";
import { RateLimit, RateLimitGuard } from "../common/rate-limit.guard.js";
import { ClassHelperAssetService } from "./class-helper-asset.service.js";
import { ClassHelperService } from "./class-helper.service.js";

type RedirectResponse = { redirect(status: number, url: string): void };

@Controller()
export class ClassHelperController {
  constructor(private readonly helpers: ClassHelperService, private readonly assets: ClassHelperAssetService) {}

  @Get("class-helpers")
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles("instructor", "operator", "admin")
  @Header("Cache-Control", "private, no-store")
  list(@Query() query: Record<string, unknown>) {
    return this.helpers.listPublic(query);
  }

  @Get("admin/class-helpers")
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles("operator", "admin")
  listAdmin(@Query() query: Record<string, unknown>) {
    return this.helpers.listAdmin(query);
  }

  @Post("admin/class-helpers")
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles("operator", "admin")
  create(@CurrentUser() user: CurrentUserValue, @Body() body: unknown, @Req() request: ApiRequest) {
    return this.helpers.create(user, body, request.requestId);
  }

  @Patch("admin/class-helpers/:helperId")
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles("operator", "admin")
  update(@CurrentUser() user: CurrentUserValue, @Param("helperId") helperId: string, @Body() body: unknown, @Req() request: ApiRequest) {
    return this.helpers.update(user, helperId, body, request.requestId);
  }

  @Get("admin/class-helpers/:helperId/revisions")
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles("operator", "admin")
  listRevisions(@Param("helperId") helperId: string) {
    return this.helpers.listRevisions(helperId);
  }

  @Post("admin/class-helpers/:helperId/revisions/:revision/restore")
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles("operator", "admin")
  restoreRevision(@CurrentUser() user: CurrentUserValue, @Param("helperId") helperId: string, @Param("revision") revision: string, @Req() request: ApiRequest) {
    return this.helpers.restoreRevision(user, helperId, revision, request.requestId);
  }

  @Post("admin/class-helpers/:helperId/publish")
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles("operator", "admin")
  publish(@CurrentUser() user: CurrentUserValue, @Param("helperId") helperId: string, @Req() request: ApiRequest) {
    return this.helpers.publish(user, helperId, request.requestId);
  }

  @Delete("admin/class-helpers/:helperId")
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles("operator", "admin")
  archive(@CurrentUser() user: CurrentUserValue, @Param("helperId") helperId: string, @Req() request: ApiRequest) {
    return this.helpers.archive(user, helperId, request.requestId);
  }

  @Get("class-helpers/:helperId/assets/:field")
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles("instructor", "operator", "admin")
  async download(@CurrentUser() user: CurrentUserValue, @Param("helperId") helperId: string, @Param("field") field: string, @Res() response: RedirectResponse) {
    const signed = await this.helpers.download(helperId, field, user);
    response.redirect(302, signed.url);
  }

  @Post("class-helper-assets/uploads")
  @RateLimit({ name: "class-helper-asset-upload", limit: 60, windowMs: 60 * 60_000, errorCode: "CLASS_HELPER_ASSET_RATE_LIMITED", errorMessage: "수업자료 업로드 요청 횟수를 초과했습니다." })
  @UseGuards(SessionAuthGuard, RolesGuard, RateLimitGuard)
  @Roles("operator", "admin")
  startUpload(@CurrentUser() user: CurrentUserValue, @Body() body: unknown, @Req() request: ApiRequest) {
    return this.assets.startUpload(user, body, request.requestId);
  }

  @Post("class-helper-assets/:assetId/complete")
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles("operator", "admin")
  completeUpload(@CurrentUser() user: CurrentUserValue, @Param("assetId") assetId: string, @Req() request: ApiRequest) {
    return this.assets.completeUpload(user, assetId, request.requestId);
  }
}
