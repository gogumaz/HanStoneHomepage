import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { CurrentUser as CurrentUserValue } from "../auth/auth.types.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { Roles } from "../auth/roles.decorator.js";
import { RolesGuard } from "../auth/roles.guard.js";
import { SessionAuthGuard } from "../auth/session-auth.guard.js";
import type { ApiRequest } from "../common/http-types.js";
import { GuardianService } from "./guardian.service.js";

@Controller()
export class GuardianController {
  constructor(private readonly guardianService: GuardianService) {}

  @Post("me/guardian-invitations")
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles("student")
  createInvitation(
    @CurrentUser() student: CurrentUserValue,
    @Body() body: unknown,
    @Req() request: ApiRequest,
  ) {
    return this.guardianService.createInvitation(student, body, request.requestId);
  }

  @Get("guardian-invitations/:token")
  getInvitation(@Param("token") token: string) {
    return this.guardianService.getInvitation(token);
  }

  @Post("guardian-invitations/:token/accept")
  @HttpCode(HttpStatus.OK)
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles("guardian")
  acceptInvitation(
    @Param("token") token: string,
    @CurrentUser() guardian: CurrentUserValue,
    @Body() body: unknown,
    @Req() request: ApiRequest,
  ) {
    return this.guardianService.acceptInvitation(token, guardian, body, request.requestId);
  }

  @Get("guardians/me/students")
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles("guardian")
  listStudents(@CurrentUser() guardian: CurrentUserValue) {
    return this.guardianService.listStudents(guardian);
  }

  @Get("guardians/me/students/:studentId/report")
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles("guardian")
  @Header("Cache-Control", "private, no-store")
  @Header("Vary", "Cookie")
  getStudentReport(
    @Param("studentId") studentId: string,
    @CurrentUser() guardian: CurrentUserValue,
    @Req() request: ApiRequest,
  ) {
    return this.guardianService.getStudentReport(guardian, studentId, request.requestId);
  }

  @Post("me/guardian-links/:linkId/revoke")
  @HttpCode(HttpStatus.OK)
  @UseGuards(SessionAuthGuard)
  revokeLink(
    @Param("linkId") linkId: string,
    @CurrentUser() actor: CurrentUserValue,
    @Req() request: ApiRequest,
  ) {
    return this.guardianService.revokeLink(linkId, actor, request.requestId);
  }
}
