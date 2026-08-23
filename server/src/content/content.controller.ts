import { Body, Controller, Get, Header, Param, Patch, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import type { CurrentUser as CurrentUserValue } from "../auth/auth.types.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { OptionalSessionGuard } from "../auth/optional-session.guard.js";
import { SessionAuthGuard } from "../auth/session-auth.guard.js";
import { Roles } from "../auth/roles.decorator.js";
import { RolesGuard } from "../auth/roles.guard.js";
import type { ApiRequest } from "../common/http-types.js";
import { ContentService } from "./content.service.js";
import { LessonAccessService } from "./lesson-access.service.js";
import { LessonProgressService } from "./lesson-progress.service.js";
import { LessonVideoService } from "./lesson-video.service.js";
import { LessonAdminService } from "./lesson-admin.service.js";
import { LessonAssetService } from "./lesson-asset.service.js";
import { StudentDashboardService } from "./student-dashboard.service.js";

type HlsManifestResponse = {
  setHeader(name: string, value: string): void;
  status(statusCode: number): HlsManifestResponse;
  send(body: string): void;
};

@Controller()
export class ContentController {
  constructor(
    private readonly contentService: ContentService,
    private readonly accessService: LessonAccessService,
    private readonly progressService: LessonProgressService,
    private readonly videoService: LessonVideoService,
    private readonly adminService: LessonAdminService,
    private readonly assetService: LessonAssetService,
    private readonly dashboardService: StudentDashboardService,
  ) {}

  @Get("eras")
  listEras() {
    return this.contentService.listEras();
  }

  @Get("eras/:eraId/lessons")
  listEraLessons(@Param("eraId") eraId: string) {
    return this.contentService.listLessons(eraId);
  }

  @Get("lessons")
  listLessons(@Query("eraId") eraId?: string) {
    return this.contentService.listLessons(eraId);
  }

  @Get("lessons/:lessonId")
  getLesson(@Param("lessonId") lessonId: string) {
    return this.contentService.getLesson(lessonId);
  }

  @Get("lessons/:lessonId/thumbnail")
  @Header("Cache-Control", "private, no-store")
  getLessonThumbnail(@Param("lessonId") lessonId: string) {
    return this.assetService.getThumbnail(lessonId);
  }

  @Get("lessons/:lessonId/materials")
  @UseGuards(OptionalSessionGuard)
  @Header("Cache-Control", "private, no-store")
  @Header("Vary", "Cookie")
  getLessonMaterials(
    @Param("lessonId") lessonId: string,
    @CurrentUser() user?: CurrentUserValue,
  ) {
    return this.assetService.listAvailableMaterials(lessonId, user);
  }

  @Get("subscription-plans")
  listSubscriptionPlans() {
    return this.accessService.listPlans();
  }

  @Get("lessons/:lessonId/playback")
  @UseGuards(OptionalSessionGuard)
  @Header("Cache-Control", "private, no-store")
  @Header("Vary", "Cookie")
  getPlayback(
    @Param("lessonId") lessonId: string,
    @CurrentUser() user?: CurrentUserValue,
  ) {
    return this.accessService.getPlayback(lessonId, user);
  }

  @Get("lessons/:lessonId/hls-manifest")
  @UseGuards(OptionalSessionGuard)
  async getHlsManifest(
    @Param("lessonId") lessonId: string,
    @Query("path") path: string | undefined,
    @CurrentUser() user: CurrentUserValue | undefined,
    @Res() response: HlsManifestResponse,
  ) {
    const manifest = await this.accessService.getHlsManifest(lessonId, path, user);
    response.setHeader("Content-Type", "application/vnd.apple.mpegurl; charset=utf-8");
    response.setHeader("Cache-Control", "private, no-store");
    response.setHeader("Vary", "Cookie");
    response.status(200).send(manifest);
  }

  @Get("me/lessons/:lessonId/progress")
  @UseGuards(SessionAuthGuard)
  getProgress(
    @Param("lessonId") lessonId: string,
    @CurrentUser() user: CurrentUserValue,
  ) {
    return this.progressService.getProgress(user, lessonId);
  }

  @Get("me/dashboard")
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles("student")
  @Header("Cache-Control", "private, no-store")
  @Header("Vary", "Cookie")
  getStudentDashboard(@CurrentUser() student: CurrentUserValue) {
    return this.dashboardService.getDashboard(student);
  }

  @Post("lessons/:lessonId/start")
  @UseGuards(SessionAuthGuard)
  startLesson(
    @Param("lessonId") lessonId: string,
    @CurrentUser() user: CurrentUserValue,
    @Req() request: ApiRequest,
  ) {
    return this.progressService.start(user, lessonId, request.requestId);
  }

  @Post("lessons/:lessonId/steps/:stepId/complete")
  @UseGuards(SessionAuthGuard)
  completeStep(
    @Param("lessonId") lessonId: string,
    @Param("stepId") stepId: string,
    @CurrentUser() user: CurrentUserValue,
    @Req() request: ApiRequest,
  ) {
    return this.progressService.completeStep(user, lessonId, stepId, request.requestId);
  }

  @Post("lessons/:lessonId/complete")
  @UseGuards(SessionAuthGuard)
  completeLesson(
    @Param("lessonId") lessonId: string,
    @CurrentUser() user: CurrentUserValue,
    @Req() request: ApiRequest,
  ) {
    return this.progressService.completeLesson(user, lessonId, request.requestId);
  }

  @Post("admin/lessons/:lessonId/video-upload")
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles("operator", "admin")
  startVideoUpload(
    @Param("lessonId") lessonId: string,
    @CurrentUser() user: CurrentUserValue,
    @Body() body: unknown,
    @Req() request: ApiRequest,
  ) {
    return this.videoService.startUpload(user, lessonId, body, request.requestId);
  }

  @Post("admin/lessons/:lessonId/video-upload/complete")
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles("operator", "admin")
  completeVideoUpload(
    @Param("lessonId") lessonId: string,
    @CurrentUser() user: CurrentUserValue,
    @Body() body: unknown,
    @Req() request: ApiRequest,
  ) {
    return this.videoService.completeUpload(user, lessonId, body, request.requestId);
  }

  @Get("admin/lessons/:lessonId/video-uploads")
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles("operator", "admin")
  listVideoUploads(@Param("lessonId") lessonId: string) {
    return this.videoService.listUploads(lessonId);
  }

  @Post("admin/lessons/:lessonId/video-uploads/:assetId/retry")
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles("operator", "admin")
  retryVideoScan(
    @Param("lessonId") lessonId: string,
    @Param("assetId") assetId: string,
    @CurrentUser() user: CurrentUserValue,
    @Req() request: ApiRequest,
  ) {
    return this.videoService.retryScan(user, lessonId, assetId, request.requestId);
  }

  @Post("admin/lessons/:lessonId/video-uploads/:assetId/hls-retry")
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles("operator", "admin")
  retryHlsTranscode(
    @Param("lessonId") lessonId: string,
    @Param("assetId") assetId: string,
    @CurrentUser() user: CurrentUserValue,
    @Req() request: ApiRequest,
  ) {
    return this.videoService.retryHlsTranscode(user, lessonId, assetId, request.requestId);
  }

  @Post("admin/lessons/:lessonId/hls-source")
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles("operator", "admin")
  activateHlsSource(
    @Param("lessonId") lessonId: string,
    @CurrentUser() user: CurrentUserValue,
    @Body() body: unknown,
    @Req() request: ApiRequest,
  ) {
    return this.videoService.activateHls(user, lessonId, body, request.requestId);
  }

  @Get("admin/lessons")
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles("operator", "admin")
  listAdminLessons(@Query("include") include?: string) {
    return this.adminService.list(include);
  }

  @Post("admin/lessons")
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles("operator", "admin")
  createAdminLesson(
    @CurrentUser() user: CurrentUserValue,
    @Body() body: unknown,
    @Req() request: ApiRequest,
  ) {
    return this.adminService.create(user, body, request.requestId);
  }

  @Patch("admin/lessons/:lessonId")
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles("operator", "admin")
  updateAdminLesson(
    @Param("lessonId") lessonId: string,
    @CurrentUser() user: CurrentUserValue,
    @Body() body: unknown,
    @Req() request: ApiRequest,
  ) {
    return this.adminService.update(user, lessonId, body, request.requestId);
  }

  @Patch("admin/lessons/:lessonId/status")
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles("operator", "admin")
  changeAdminLessonStatus(
    @Param("lessonId") lessonId: string,
    @CurrentUser() user: CurrentUserValue,
    @Body() body: unknown,
    @Req() request: ApiRequest,
  ) {
    return this.adminService.changeStatus(user, lessonId, body, request.requestId);
  }

  @Get("admin/lessons/:lessonId/assets")
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles("operator", "admin")
  listLessonAssets(@Param("lessonId") lessonId: string) {
    return this.assetService.list(lessonId);
  }

  @Post("admin/lessons/:lessonId/assets/uploads")
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles("operator", "admin")
  startLessonAssetUpload(
    @Param("lessonId") lessonId: string,
    @CurrentUser() user: CurrentUserValue,
    @Body() body: unknown,
    @Req() request: ApiRequest,
  ) {
    return this.assetService.startUpload(user, lessonId, body, request.requestId);
  }

  @Post("admin/lessons/:lessonId/assets/:assetId/complete")
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles("operator", "admin")
  completeLessonAssetUpload(
    @Param("lessonId") lessonId: string,
    @Param("assetId") assetId: string,
    @CurrentUser() user: CurrentUserValue,
    @Req() request: ApiRequest,
  ) {
    return this.assetService.completeUpload(user, lessonId, assetId, request.requestId);
  }
}
