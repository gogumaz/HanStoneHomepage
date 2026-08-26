import { Body, Controller, Get, Param, Post, Req, Res, UseGuards } from "@nestjs/common";
import type { CurrentUser as CurrentUserValue } from "../auth/auth.types.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { OptionalSessionGuard } from "../auth/optional-session.guard.js";
import { Roles } from "../auth/roles.decorator.js";
import { RolesGuard } from "../auth/roles.guard.js";
import { SessionAuthGuard } from "../auth/session-auth.guard.js";
import type { ApiRequest } from "../common/http-types.js";
import { RateLimit, RateLimitGuard } from "../common/rate-limit.guard.js";
import { CommunityAttachmentService } from "./community-attachment.service.js";

type RedirectResponse = { redirect(status: number, url: string): void };

@Controller()
export class CommunityAttachmentController {
  constructor(private readonly attachments: CommunityAttachmentService) {}

  @Post("community-attachments/uploads")
  @RateLimit({
    name: "community-attachment-upload",
    limit: 20,
    windowMs: 60 * 60_000,
    errorCode: "COMMUNITY_ATTACHMENT_RATE_LIMITED",
    errorMessage: "첨부파일 업로드 요청 횟수를 초과했습니다. 잠시 후 다시 시도해 주세요.",
  })
  @UseGuards(SessionAuthGuard, RolesGuard, RateLimitGuard)
  @Roles("instructor", "operator", "admin")
  startUpload(@CurrentUser() user: CurrentUserValue, @Body() body: unknown, @Req() request: ApiRequest) {
    return this.attachments.startUpload(user, body, request.requestId);
  }

  @Post("community-attachments/:attachmentId/complete")
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles("instructor", "operator", "admin")
  completeUpload(
    @CurrentUser() user: CurrentUserValue,
    @Param("attachmentId") attachmentId: string,
    @Req() request: ApiRequest,
  ) {
    return this.attachments.completeUpload(user, attachmentId, request.requestId);
  }

  @Get("posts/:postId/attachment")
  @UseGuards(OptionalSessionGuard)
  async download(
    @Param("postId") postId: string,
    @CurrentUser() user: CurrentUserValue | undefined,
    @Res() response: RedirectResponse,
  ) {
    const signed = await this.attachments.download(postId, user);
    response.redirect(302, signed.url);
  }
}
