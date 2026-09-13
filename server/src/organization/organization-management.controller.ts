import { Body, Controller, Delete, Get, Header, Param, Patch, Post, Put, Req, UseGuards } from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { Roles } from "../auth/roles.decorator.js";
import { RolesGuard } from "../auth/roles.guard.js";
import { SessionAuthGuard } from "../auth/session-auth.guard.js";
import type { CurrentUser as CurrentUserValue } from "../auth/auth.types.js";
import type { ApiRequest } from "../common/http-types.js";
import { RateLimit, RateLimitGuard } from "../common/rate-limit.guard.js";
import { OrganizationManagementService } from "./organization-management.service.js";

const MANAGEMENT_WRITE_LIMIT = {
  name: "organization-management-write",
  limit: 120,
  windowMs: 60 * 60_000,
  errorCode: "ORGANIZATION_MANAGEMENT_RATE_LIMITED",
  errorMessage: "기관 관리 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.",
} as const;

@Controller("organization-admin")
@UseGuards(SessionAuthGuard, RolesGuard)
@Roles("organization_admin")
export class OrganizationManagementController {
  constructor(private readonly management: OrganizationManagementService) {}

  @Get("organizations/:organizationId/classes")
  @Header("Cache-Control", "private, no-store")
  @Header("Vary", "Cookie")
  listClasses(@CurrentUser() user: CurrentUserValue, @Param("organizationId") organizationId: string) {
    return this.management.listClasses(user, organizationId);
  }

  @Get("organizations/:organizationId/instructors")
  @Header("Cache-Control", "private, no-store")
  @Header("Vary", "Cookie")
  listInstructors(@CurrentUser() user: CurrentUserValue, @Param("organizationId") organizationId: string) {
    return this.management.listInstructors(user, organizationId);
  }

  @Get("organizations/:organizationId/management")
  @Header("Cache-Control", "private, no-store")
  @Header("Vary", "Cookie")
  getOrganizationManagement(@CurrentUser() user: CurrentUserValue, @Param("organizationId") organizationId: string) {
    return this.management.getOrganizationManagement(user, organizationId);
  }

  @Patch("organizations/:organizationId")
  @Header("Cache-Control", "private, no-store")
  @UseGuards(RateLimitGuard)
  @RateLimit(MANAGEMENT_WRITE_LIMIT)
  updateOrganization(@CurrentUser() user: CurrentUserValue, @Param("organizationId") organizationId: string, @Body() body: unknown, @Req() request: ApiRequest) {
    return this.management.updateOrganization(user, organizationId, body, request.requestId);
  }

  @Post("organizations/:organizationId/members")
  @Header("Cache-Control", "private, no-store")
  @UseGuards(RateLimitGuard)
  @RateLimit(MANAGEMENT_WRITE_LIMIT)
  addMember(@CurrentUser() user: CurrentUserValue, @Param("organizationId") organizationId: string, @Body() body: unknown, @Req() request: ApiRequest) {
    return this.management.addMember(user, organizationId, body, request.requestId);
  }

  @Patch("organizations/:organizationId/members/:membershipId")
  @Header("Cache-Control", "private, no-store")
  @UseGuards(RateLimitGuard)
  @RateLimit(MANAGEMENT_WRITE_LIMIT)
  updateMember(@CurrentUser() user: CurrentUserValue, @Param("organizationId") organizationId: string, @Param("membershipId") membershipId: string, @Body() body: unknown, @Req() request: ApiRequest) {
    return this.management.updateMember(user, organizationId, membershipId, body, request.requestId);
  }

  @Post("organizations/:organizationId/classes")
  @Header("Cache-Control", "private, no-store")
  @UseGuards(RateLimitGuard)
  @RateLimit(MANAGEMENT_WRITE_LIMIT)
  createClass(@CurrentUser() user: CurrentUserValue, @Param("organizationId") organizationId: string, @Body() body: unknown, @Req() request: ApiRequest) {
    return this.management.createClass(user, organizationId, body, request.requestId);
  }

  @Patch("classes/:classId")
  @Header("Cache-Control", "private, no-store")
  @UseGuards(RateLimitGuard)
  @RateLimit(MANAGEMENT_WRITE_LIMIT)
  updateClass(@CurrentUser() user: CurrentUserValue, @Param("classId") classId: string, @Body() body: unknown, @Req() request: ApiRequest) {
    return this.management.updateClass(user, classId, body, request.requestId);
  }

  @Put("classes/:classId/instructors/:membershipId")
  @Header("Cache-Control", "private, no-store")
  @UseGuards(RateLimitGuard)
  @RateLimit(MANAGEMENT_WRITE_LIMIT)
  assignInstructor(@CurrentUser() user: CurrentUserValue, @Param("classId") classId: string, @Param("membershipId") membershipId: string, @Body() body: unknown, @Req() request: ApiRequest) {
    return this.management.assignInstructor(user, classId, membershipId, body, request.requestId);
  }

  @Delete("classes/:classId/instructors/:membershipId")
  @Header("Cache-Control", "private, no-store")
  @UseGuards(RateLimitGuard)
  @RateLimit(MANAGEMENT_WRITE_LIMIT)
  endInstructorAssignment(@CurrentUser() user: CurrentUserValue, @Param("classId") classId: string, @Param("membershipId") membershipId: string, @Req() request: ApiRequest) {
    return this.management.endInstructorAssignment(user, classId, membershipId, request.requestId);
  }

  @Post("classes/:classId/students")
  @Header("Cache-Control", "private, no-store")
  @UseGuards(RateLimitGuard)
  @RateLimit(MANAGEMENT_WRITE_LIMIT)
  enrollStudent(@CurrentUser() user: CurrentUserValue, @Param("classId") classId: string, @Body() body: unknown, @Req() request: ApiRequest) {
    return this.management.enrollStudent(user, classId, body, request.requestId);
  }

  @Delete("classes/:classId/students/:studentId")
  @Header("Cache-Control", "private, no-store")
  @UseGuards(RateLimitGuard)
  @RateLimit(MANAGEMENT_WRITE_LIMIT)
  endStudentEnrollment(@CurrentUser() user: CurrentUserValue, @Param("classId") classId: string, @Param("studentId") studentId: string, @Req() request: ApiRequest) {
    return this.management.endStudentEnrollment(user, classId, studentId, request.requestId);
  }
}
