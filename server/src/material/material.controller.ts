import { Body, Controller, Delete, Get, Header, Param, Patch, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import type { CurrentUser as CurrentUserValue } from "../auth/auth.types.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { OptionalSessionGuard } from "../auth/optional-session.guard.js";
import { Roles } from "../auth/roles.decorator.js";
import { RolesGuard } from "../auth/roles.guard.js";
import { SessionAuthGuard } from "../auth/session-auth.guard.js";
import type { ApiRequest } from "../common/http-types.js";
import { RateLimit, RateLimitGuard } from "../common/rate-limit.guard.js";
import { MaterialAssetService } from "./material-asset.service.js";
import { MaterialService } from "./material.service.js";

type RedirectResponse = { redirect(status: number, url: string): void };

@Controller()
export class MaterialController {
  constructor(private readonly materials: MaterialService, private readonly assets: MaterialAssetService) {}

  @Get("materials")
  @UseGuards(OptionalSessionGuard)
  @Header("Cache-Control", "private, no-store")
  @Header("Vary", "Cookie")
  listPublic(@Query() query: Record<string, unknown>, @CurrentUser() user?: CurrentUserValue) {
    return this.materials.listPublic(query, user);
  }

  @Get("materials/:materialId/download")
  @UseGuards(OptionalSessionGuard)
  async download(@Param("materialId") materialId: string, @CurrentUser() user: CurrentUserValue | undefined, @Res() response: RedirectResponse) {
    const signed = await this.materials.download(materialId, user);
    response.redirect(302, signed.url);
  }

  @Get("admin/materials")
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles("operator", "admin")
  listAdmin(@Query() query: Record<string, unknown>, @CurrentUser() user: CurrentUserValue) {
    return this.materials.listAdmin(query, user);
  }

  @Post("admin/materials")
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles("operator", "admin")
  create(@CurrentUser() user: CurrentUserValue, @Body() body: unknown, @Req() request: ApiRequest) {
    return this.materials.create(user, body, request.requestId);
  }

  @Patch("admin/materials/:materialId")
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles("operator", "admin")
  update(@CurrentUser() user: CurrentUserValue, @Param("materialId") materialId: string, @Body() body: unknown, @Req() request: ApiRequest) {
    return this.materials.update(user, materialId, body, request.requestId);
  }

  @Get("admin/materials/:materialId/revisions")
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles("operator", "admin")
  listRevisions(@Param("materialId") materialId: string) {
    return this.materials.listRevisions(materialId);
  }

  @Post("admin/materials/:materialId/revisions/:revision/restore")
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles("operator", "admin")
  restoreRevision(@CurrentUser() user: CurrentUserValue, @Param("materialId") materialId: string, @Param("revision") revision: string, @Req() request: ApiRequest) {
    return this.materials.restoreRevision(user, materialId, revision, request.requestId);
  }

  @Post("admin/materials/:materialId/publish")
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles("operator", "admin")
  publish(@CurrentUser() user: CurrentUserValue, @Param("materialId") materialId: string, @Req() request: ApiRequest) {
    return this.materials.publish(user, materialId, request.requestId);
  }

  @Delete("admin/materials/:materialId")
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles("operator", "admin")
  archive(@CurrentUser() user: CurrentUserValue, @Param("materialId") materialId: string, @Req() request: ApiRequest) {
    return this.materials.archive(user, materialId, request.requestId);
  }

  @Post("teaching-material-assets/uploads")
  @RateLimit({ name: "teaching-material-upload", limit: 20, windowMs: 60 * 60_000, errorCode: "TEACHING_MATERIAL_UPLOAD_RATE_LIMITED", errorMessage: "교재자료 업로드 요청 횟수를 초과했습니다." })
  @UseGuards(SessionAuthGuard, RolesGuard, RateLimitGuard)
  @Roles("operator", "admin")
  startUpload(@CurrentUser() user: CurrentUserValue, @Body() body: unknown, @Req() request: ApiRequest) {
    return this.assets.startUpload(user, body, request.requestId);
  }

  @Post("teaching-material-assets/:assetId/complete")
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles("operator", "admin")
  completeUpload(@CurrentUser() user: CurrentUserValue, @Param("assetId") assetId: string, @Req() request: ApiRequest) {
    return this.assets.completeUpload(user, assetId, request.requestId);
  }
}
