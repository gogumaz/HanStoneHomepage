import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import type { CurrentUser as CurrentUserValue } from "../auth/auth.types.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { Roles } from "../auth/roles.decorator.js";
import { RolesGuard } from "../auth/roles.guard.js";
import { SessionAuthGuard } from "../auth/session-auth.guard.js";
import type { ApiRequest } from "../common/http-types.js";
import { RateLimit, RateLimitGuard } from "../common/rate-limit.guard.js";
import { CommunityReportService } from "./community-report.service.js";

@Controller()
export class CommunityReportController {
  constructor(private readonly reports: CommunityReportService) {}

  @Post("posts/:postId/reports")
  @RateLimit({
    name: "community-report-submit",
    limit: 10,
    windowMs: 60 * 60_000,
    errorCode: "COMMUNITY_REPORT_RATE_LIMITED",
    errorMessage: "신고 접수 횟수를 초과했습니다. 잠시 후 다시 시도해 주세요.",
  })
  @UseGuards(SessionAuthGuard, RateLimitGuard)
  submit(
    @CurrentUser() user: CurrentUserValue,
    @Param("postId") postId: string,
    @Body() body: unknown,
    @Req() request: ApiRequest,
  ) {
    return this.reports.submit(user, postId, body, request.requestId);
  }

  @Get("admin/community-reports")
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles("operator", "admin")
  listAdmin(@Query() query: Record<string, unknown>) {
    return this.reports.listAdmin(query);
  }

  @Post("admin/community-reports/:reportId/resolve")
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles("operator", "admin")
  resolve(
    @CurrentUser() user: CurrentUserValue,
    @Param("reportId") reportId: string,
    @Body() body: unknown,
    @Req() request: ApiRequest,
  ) {
    return this.reports.resolve(user, reportId, body, request.requestId);
  }
}
