import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import type { CurrentUser as CurrentUserValue } from "../auth/auth.types.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { OptionalSessionGuard } from "../auth/optional-session.guard.js";
import { SessionAuthGuard } from "../auth/session-auth.guard.js";
import { Roles } from "../auth/roles.decorator.js";
import { RolesGuard } from "../auth/roles.guard.js";
import type { ApiRequest } from "../common/http-types.js";
import { RateLimit, RateLimitGuard } from "../common/rate-limit.guard.js";
import { ConsultationService } from "./consultation.service.js";

const SUBMIT_RATE_LIMIT = {
  name: "consultation-submit",
  limit: 5,
  windowMs: 60 * 60_000,
  errorCode: "CONSULTATION_RATE_LIMITED",
  errorMessage: "상담 신청 횟수를 초과했습니다. 잠시 후 다시 시도해 주세요.",
} as const;

@Controller()
export class ConsultationController {
  constructor(private readonly consultations: ConsultationService) {}

  @Post("consultations")
  @RateLimit(SUBMIT_RATE_LIMIT)
  @UseGuards(RateLimitGuard, OptionalSessionGuard)
  submit(
    @Body() body: unknown,
    @CurrentUser() user: CurrentUserValue | undefined,
    @Req() request: ApiRequest,
  ) {
    return this.consultations.submit(body, user, request.requestId);
  }

  @Get("me/consultations")
  @UseGuards(SessionAuthGuard)
  listMine(@CurrentUser() user: CurrentUserValue) {
    return this.consultations.listMine(user);
  }

  @Get("admin/consultations")
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles("operator", "admin")
  listAdmin(@Query() query: Record<string, unknown>) {
    return this.consultations.listAdmin(query);
  }

  @Get("admin/consultations/:consultationId")
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles("operator", "admin")
  getAdmin(@Param("consultationId") consultationId: string) {
    return this.consultations.getAdmin(consultationId);
  }

  @Patch("admin/consultations/:consultationId/status")
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles("operator", "admin")
  updateStatus(
    @CurrentUser() user: CurrentUserValue,
    @Param("consultationId") consultationId: string,
    @Body() body: unknown,
    @Req() request: ApiRequest,
  ) {
    return this.consultations.updateStatus(user, consultationId, body, request.requestId);
  }
}
