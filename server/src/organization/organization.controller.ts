import { Controller, Get, Header, Param, Req, UseGuards } from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { Roles } from "../auth/roles.decorator.js";
import { RolesGuard } from "../auth/roles.guard.js";
import { SessionAuthGuard } from "../auth/session-auth.guard.js";
import type { CurrentUser as CurrentUserValue } from "../auth/auth.types.js";
import type { ApiRequest } from "../common/http-types.js";
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
}
