import { Body, Controller, Delete, Get, Header, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { OptionalSessionGuard } from "../auth/optional-session.guard.js";
import { Roles } from "../auth/roles.decorator.js";
import { RolesGuard } from "../auth/roles.guard.js";
import { SessionAuthGuard } from "../auth/session-auth.guard.js";
import type { CurrentUser as CurrentUserValue } from "../auth/auth.types.js";
import type { ApiRequest } from "../common/http-types.js";
import { MissionAdminService } from "./mission-admin.service.js";
import { MissionService } from "./mission.service.js";

@Controller()
export class MissionController {
  constructor(
    private readonly missions: MissionService,
    private readonly admin: MissionAdminService,
  ) {}

  @Get("missions")
  @UseGuards(OptionalSessionGuard)
  @Header("Cache-Control", "private, no-store")
  list(@Query() query: Record<string, unknown>, @CurrentUser() user?: CurrentUserValue) {
    return this.missions.list(query, user);
  }

  @Get("missions/:missionId")
  @UseGuards(OptionalSessionGuard)
  @Header("Cache-Control", "private, no-store")
  get(@Param("missionId") missionId: string, @Query("attemptId") attemptId: string | undefined, @CurrentUser() user?: CurrentUserValue) {
    return this.missions.get(missionId, user, attemptId);
  }

  @Post("missions/:missionId/attempts")
  @UseGuards(OptionalSessionGuard)
  startAttempt(
    @Param("missionId") missionId: string,
    @Body() body: unknown,
    @CurrentUser() user?: CurrentUserValue,
  ) {
    return this.missions.startAttempt(missionId, body, user);
  }

  @Get("mission-attempts/:attemptId")
  @UseGuards(OptionalSessionGuard)
  @Header("Cache-Control", "private, no-store")
  getAttempt(@Param("attemptId") attemptId: string, @CurrentUser() user?: CurrentUserValue) {
    return this.missions.getAttempt(attemptId, user);
  }

  @Post("mission-attempts/:attemptId/moves")
  @UseGuards(OptionalSessionGuard)
  submitMove(
    @Param("attemptId") attemptId: string,
    @Body() body: unknown,
    @CurrentUser() user?: CurrentUserValue,
  ) {
    return this.missions.submitMove(attemptId, body, user);
  }

  @Post("mission-attempts/:attemptId/hints")
  @UseGuards(OptionalSessionGuard)
  useHint(@Param("attemptId") attemptId: string, @CurrentUser() user?: CurrentUserValue) {
    return this.missions.useHint(attemptId, user);
  }

  @Post("mission-attempts/:attemptId/retry")
  @UseGuards(OptionalSessionGuard)
  retry(@Param("attemptId") attemptId: string, @CurrentUser() user?: CurrentUserValue) {
    return this.missions.retry(attemptId, user);
  }

  @Get("me/mission-attempts")
  @UseGuards(SessionAuthGuard)
  listMine(@CurrentUser() user: CurrentUserValue, @Query("status") status?: string) {
    return this.missions.listMine(user, status);
  }

  @Get("me/wrong-note")
  @UseGuards(SessionAuthGuard)
  wrongNote(@CurrentUser() user: CurrentUserValue) {
    return this.missions.wrongNote(user);
  }

  @Get("me/rewards")
  @UseGuards(SessionAuthGuard)
  listRewards(@CurrentUser() user: CurrentUserValue) {
    return this.missions.listRewards(user);
  }

  @Post("me/mission-favorites/:missionId")
  @UseGuards(SessionAuthGuard)
  addFavorite(@CurrentUser() user: CurrentUserValue, @Param("missionId") missionId: string) {
    return this.missions.addFavorite(user, missionId);
  }

  @Delete("me/mission-favorites/:missionId")
  @UseGuards(SessionAuthGuard)
  removeFavorite(@CurrentUser() user: CurrentUserValue, @Param("missionId") missionId: string) {
    return this.missions.removeFavorite(user, missionId);
  }

  @Get("admin/missions")
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles("operator", "admin")
  listAdmin(@Query() query: Record<string, unknown>) {
    return this.admin.list(query);
  }

  @Get("admin/missions/:missionId")
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles("operator", "admin")
  getAdmin(@Param("missionId") missionId: string) {
    return this.admin.get(missionId);
  }

  @Get("admin/missions/:missionId/statistics")
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles("operator", "admin")
  statisticsAdmin(@Param("missionId") missionId: string) {
    return this.admin.statistics(missionId);
  }

  @Post("admin/missions/:missionId/preview")
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles("operator", "admin")
  previewAdmin(@Param("missionId") missionId: string, @Body() body: unknown) {
    return this.admin.preview(missionId, body);
  }

  @Post("admin/missions")
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles("operator", "admin")
  createAdmin(
    @CurrentUser() user: CurrentUserValue,
    @Body() body: unknown,
    @Req() request: ApiRequest,
  ) {
    return this.admin.create(user, body, request.requestId);
  }

  @Patch("admin/missions/:missionId")
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles("operator", "admin")
  updateAdmin(
    @CurrentUser() user: CurrentUserValue,
    @Param("missionId") missionId: string,
    @Body() body: unknown,
    @Req() request: ApiRequest,
  ) {
    return this.admin.update(user, missionId, body, request.requestId);
  }

  @Post("admin/missions/:missionId/validate")
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles("operator", "admin")
  validateAdmin(@Param("missionId") missionId: string) {
    return this.admin.validate(missionId);
  }

  @Post("admin/missions/:missionId/request-review")
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles("operator", "admin")
  requestReview(
    @CurrentUser() user: CurrentUserValue,
    @Param("missionId") missionId: string,
    @Req() request: ApiRequest,
  ) {
    return this.admin.requestReview(user, missionId, request.requestId);
  }

  @Post("admin/missions/:missionId/publish")
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles("operator", "admin")
  publish(
    @CurrentUser() user: CurrentUserValue,
    @Param("missionId") missionId: string,
    @Body() body: unknown,
    @Req() request: ApiRequest,
  ) {
    return this.admin.publish(user, missionId, body, request.requestId);
  }

  @Post("admin/missions/:missionId/archive")
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles("operator", "admin")
  archive(
    @CurrentUser() user: CurrentUserValue,
    @Param("missionId") missionId: string,
    @Req() request: ApiRequest,
  ) {
    return this.admin.archive(user, missionId, request.requestId);
  }
}
