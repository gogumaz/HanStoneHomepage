import { Body, Controller, Get, Param, Patch, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import type { CurrentUser as CurrentUserValue } from "../auth/auth.types.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { Roles } from "../auth/roles.decorator.js";
import { RolesGuard } from "../auth/roles.guard.js";
import { SessionAuthGuard } from "../auth/session-auth.guard.js";
import type { ApiRequest } from "../common/http-types.js";
import { RateLimit, RateLimitGuard } from "../common/rate-limit.guard.js";
import { InquiryAttachmentService } from "./inquiry-attachment.service.js";
import { InquiryNotificationAdminService } from "./inquiry-notification-admin.service.js";
import { InquiryService } from "./inquiry.service.js";

type RedirectResponse = { redirect(status: number, url: string): void };

const INQUIRY_RATE_LIMIT = {
  name: "inquiry-submit",
  limit: 10,
  windowMs: 60 * 60_000,
  errorCode: "INQUIRY_RATE_LIMITED",
  errorMessage: "문의 접수 횟수를 초과했습니다. 잠시 후 다시 시도해 주세요.",
} as const;

@Controller()
export class InquiryController {
  constructor(
    private readonly inquiries: InquiryService,
    private readonly attachments: InquiryAttachmentService,
    private readonly notificationJobs: InquiryNotificationAdminService,
  ) {}

  @Post("inquiry-attachments/uploads")
  @RateLimit({
    name: "inquiry-attachment-upload",
    limit: 20,
    windowMs: 60 * 60_000,
    errorCode: "INQUIRY_ATTACHMENT_RATE_LIMITED",
    errorMessage: "첨부파일 업로드 요청 횟수를 초과했습니다. 잠시 후 다시 시도해 주세요.",
  })
  @UseGuards(SessionAuthGuard, RateLimitGuard)
  startAttachmentUpload(
    @CurrentUser() user: CurrentUserValue,
    @Body() body: unknown,
    @Req() request: ApiRequest,
  ) {
    return this.attachments.startUpload(user, body, request.requestId);
  }

  @Post("inquiry-attachments/:attachmentId/complete")
  @UseGuards(SessionAuthGuard)
  completeAttachmentUpload(
    @CurrentUser() user: CurrentUserValue,
    @Param("attachmentId") attachmentId: string,
    @Req() request: ApiRequest,
  ) {
    return this.attachments.completeUpload(user, attachmentId, request.requestId);
  }

  @Post("inquiries")
  @RateLimit(INQUIRY_RATE_LIMIT)
  @UseGuards(SessionAuthGuard, RateLimitGuard)
  submit(@CurrentUser() user: CurrentUserValue, @Body() body: unknown, @Req() request: ApiRequest) {
    return this.inquiries.submit(user, body, request.requestId);
  }

  @Get("me/inquiries")
  @UseGuards(SessionAuthGuard)
  listMine(@CurrentUser() user: CurrentUserValue) {
    return this.inquiries.listMine(user);
  }

  @Get("me/inquiries/:inquiryId/attachment")
  @UseGuards(SessionAuthGuard)
  async downloadMine(
    @CurrentUser() user: CurrentUserValue,
    @Param("inquiryId") inquiryId: string,
    @Res() response: RedirectResponse,
  ) {
    const signed = await this.attachments.downloadMine(user, inquiryId);
    response.redirect(302, signed.url);
  }

  @Get("admin/inquiries")
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles("operator", "admin")
  listAdmin(@Query() query: Record<string, unknown>) {
    return this.inquiries.listAdmin(query);
  }

  @Get("admin/inquiries/:inquiryId")
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles("operator", "admin")
  getAdmin(@Param("inquiryId") inquiryId: string) {
    return this.inquiries.getAdmin(inquiryId);
  }

  @Get("admin/inquiries/:inquiryId/notification-jobs")
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles("operator", "admin")
  listNotificationJobs(@Param("inquiryId") inquiryId: string) {
    return this.notificationJobs.listForInquiry(inquiryId);
  }

  @Post("admin/inquiry-notification-jobs/:jobId/retry")
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles("operator", "admin")
  retryNotificationJob(
    @CurrentUser() user: CurrentUserValue,
    @Param("jobId") jobId: string,
    @Req() request: ApiRequest,
  ) {
    return this.notificationJobs.retry(user, jobId, request.requestId);
  }

  @Get("admin/inquiries/:inquiryId/attachment")
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles("operator", "admin")
  async downloadAdmin(@Param("inquiryId") inquiryId: string, @Res() response: RedirectResponse) {
    const signed = await this.attachments.downloadAdmin(inquiryId);
    response.redirect(302, signed.url);
  }

  @Post("admin/inquiries/:inquiryId/answer")
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles("operator", "admin")
  answer(
    @CurrentUser() user: CurrentUserValue,
    @Param("inquiryId") inquiryId: string,
    @Body() body: unknown,
    @Req() request: ApiRequest,
  ) {
    return this.inquiries.answer(user, inquiryId, body, request.requestId);
  }

  @Patch("admin/inquiries/:inquiryId/status")
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles("operator", "admin")
  updateStatus(
    @CurrentUser() user: CurrentUserValue,
    @Param("inquiryId") inquiryId: string,
    @Body() body: unknown,
    @Req() request: ApiRequest,
  ) {
    return this.inquiries.updateStatus(user, inquiryId, body, request.requestId);
  }
}
