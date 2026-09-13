import { Body, Controller, Get, Header, HttpCode, HttpStatus, Param, Post, Put, Req, UseGuards } from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { Roles } from "../auth/roles.decorator.js";
import { RolesGuard } from "../auth/roles.guard.js";
import { SessionAuthGuard } from "../auth/session-auth.guard.js";
import type { CurrentUser as CurrentUserValue } from "../auth/auth.types.js";
import type { ApiRequest } from "../common/http-types.js";
import { RateLimit, RateLimitGuard } from "../common/rate-limit.guard.js";
import { OrganizationAccessService } from "./organization-access.service.js";

@Controller("teacher")
export class OrganizationController {
  constructor(private readonly access: OrganizationAccessService) {}

  @Get("classes")
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles("instructor")
  @Header("Cache-Control", "private, no-store")
  listAssignedClasses(@CurrentUser() user: CurrentUserValue) {
    return this.access.listAssignedClasses(user);
  }

  @Get("classes/:classId/students")
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles("instructor")
  @Header("Cache-Control", "private, no-store")
  @Header("Vary", "Cookie")
  listAssignedClassStudents(
    @Param("classId") classId: string,
    @CurrentUser() user: CurrentUserValue,
    @Req() request: ApiRequest,
  ) {
    return this.access.listAssignedClassStudents(user, classId, request.requestId);
  }

  @Post("classes/:classId/invite-codes")
  @RateLimit({
    name: "organization-class-invite-create",
    limit: 20,
    windowMs: 60 * 60_000,
    errorCode: "CLASS_INVITE_CODE_RATE_LIMITED",
    errorMessage: "학생 등록 코드 발급 횟수를 초과했습니다. 잠시 후 다시 시도해 주세요.",
  })
  @UseGuards(SessionAuthGuard, RolesGuard, RateLimitGuard)
  @Roles("instructor")
  @Header("Cache-Control", "private, no-store")
  createClassInviteCode(
    @Param("classId") classId: string,
    @CurrentUser() user: CurrentUserValue,
    @Req() request: ApiRequest,
  ) {
    return this.access.createClassInviteCode(user, classId, request.requestId);
  }

  @Get("classes/:classId/progress-setting")
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles("instructor")
  @Header("Cache-Control", "private, no-store")
  @Header("Vary", "Cookie")
  getClassProgressSetting(
    @Param("classId") classId: string,
    @CurrentUser() user: CurrentUserValue,
  ) {
    return this.access.getClassProgressSetting(user, classId);
  }

  @Put("classes/:classId/progress-setting")
  @HttpCode(HttpStatus.OK)
  @RateLimit({
    name: "organization-class-progress-setting-update",
    limit: 60,
    windowMs: 60 * 60_000,
    errorCode: "CLASS_PROGRESS_SETTING_RATE_LIMITED",
    errorMessage: "반별 진도 설정 변경 횟수를 초과했습니다. 잠시 후 다시 시도해 주세요.",
  })
  @UseGuards(SessionAuthGuard, RolesGuard, RateLimitGuard)
  @Roles("instructor")
  @Header("Cache-Control", "private, no-store")
  @Header("Vary", "Cookie")
  updateClassProgressSetting(
    @Param("classId") classId: string,
    @CurrentUser() user: CurrentUserValue,
    @Body() body: unknown,
    @Req() request: ApiRequest,
  ) {
    return this.access.updateClassProgressSetting(user, classId, body, request.requestId);
  }

}

@Controller("me/class-invite-codes")
export class OrganizationEnrollmentController {
  constructor(private readonly access: OrganizationAccessService) {}

  @Post("claim")
  @HttpCode(HttpStatus.OK)
  @RateLimit({
    name: "organization-class-invite-claim",
    limit: 10,
    windowMs: 15 * 60_000,
    errorCode: "CLASS_INVITE_CODE_RATE_LIMITED",
    errorMessage: "학생 등록 코드 확인 횟수를 초과했습니다. 잠시 후 다시 시도해 주세요.",
  })
  @UseGuards(SessionAuthGuard, RolesGuard, RateLimitGuard)
  @Roles("student")
  @Header("Cache-Control", "private, no-store")
  claimClassInviteCode(
    @CurrentUser() student: CurrentUserValue,
    @Body() body: unknown,
    @Req() request: ApiRequest,
  ) {
    return this.access.claimClassInviteCode(student, body, request.requestId);
  }
}
