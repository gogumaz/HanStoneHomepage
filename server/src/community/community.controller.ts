import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import type { CurrentUser as CurrentUserValue } from "../auth/auth.types.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { OptionalSessionGuard } from "../auth/optional-session.guard.js";
import { Roles } from "../auth/roles.decorator.js";
import { RolesGuard } from "../auth/roles.guard.js";
import { SessionAuthGuard } from "../auth/session-auth.guard.js";
import type { ApiRequest } from "../common/http-types.js";
import { CommunityService } from "./community.service.js";

@Controller()
export class CommunityController {
  constructor(private readonly community: CommunityService) {}

  @Get("posts")
  @UseGuards(OptionalSessionGuard)
  listPublic(@Query() query: Record<string, unknown>, @CurrentUser() user?: CurrentUserValue) {
    return this.community.listPublic(query, user);
  }

  @Get("admin/posts")
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles("operator", "admin")
  listAdmin(@Query() query: Record<string, unknown>) {
    return this.community.listAdmin(query);
  }

  @Post("posts")
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles("instructor", "operator", "admin")
  create(@CurrentUser() user: CurrentUserValue, @Body() body: unknown, @Req() request: ApiRequest) {
    return this.community.create(user, body, request.requestId);
  }

  @Patch("posts/:postId")
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles("instructor", "operator", "admin")
  update(
    @CurrentUser() user: CurrentUserValue,
    @Param("postId") postId: string,
    @Body() body: unknown,
    @Req() request: ApiRequest,
  ) {
    return this.community.update(user, postId, body, request.requestId);
  }

  @Delete("posts/:postId")
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles("instructor", "operator", "admin")
  archive(@CurrentUser() user: CurrentUserValue, @Param("postId") postId: string, @Req() request: ApiRequest) {
    return this.community.archive(user, postId, request.requestId);
  }

  @Post("admin/posts/:postId/publish")
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles("operator", "admin")
  publish(@CurrentUser() user: CurrentUserValue, @Param("postId") postId: string, @Req() request: ApiRequest) {
    return this.community.publish(user, postId, request.requestId);
  }

  @Post("admin/posts/:postId/reject")
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles("operator", "admin")
  reject(
    @CurrentUser() user: CurrentUserValue,
    @Param("postId") postId: string,
    @Body() body: unknown,
    @Req() request: ApiRequest,
  ) {
    return this.community.reject(user, postId, body, request.requestId);
  }
}
