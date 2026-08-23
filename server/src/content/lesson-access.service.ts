import { HttpStatus, Injectable } from "@nestjs/common";
import type { CurrentUser } from "../auth/auth.types.js";
import { ApiError } from "../common/api-error.js";
import { PrismaService } from "../database/prisma.service.js";
import { LessonStatus, SubscriptionPaymentStatus } from "../generated/prisma/enums.js";
import { MediaDeliveryService } from "../storage/media-delivery.service.js";
import { HlsManifestService } from "./hls-manifest.service.js";

export type LessonAccess = {
  source: "free_sample" | "subscription" | "operator_preview";
  subscriptionEndsAt: Date | null;
};

@Injectable()
export class LessonAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly delivery: MediaDeliveryService,
    private readonly hls: HlsManifestService,
  ) {}

  async getPlayback(lessonId: string, user?: CurrentUser) {
    const lesson = await this.prisma.lesson.findFirst({
      where: { id: lessonId, status: LessonStatus.PUBLISHED },
      select: { id: true, isFreeSample: true, videoAssetKey: true },
    });
    if (!lesson) {
      throw new ApiError("LESSON_NOT_FOUND", "공개된 강의를 찾을 수 없습니다.", HttpStatus.NOT_FOUND);
    }
    const access = await this.requireAccess(lesson, user);
    if (!lesson.videoAssetKey) {
      return {
        lessonId: lesson.id,
        access,
        playback: {
          status: "asset_pending" as const,
          format: null,
          delivery: null,
          url: null,
          expiresAt: null,
          message: "강의 영상 업로드를 준비하고 있습니다.",
        },
      };
    }
    if (!this.delivery.isConfigured()) {
      return {
        lessonId: lesson.id,
        access,
        playback: {
          status: "signer_pending" as const,
          format: null,
          delivery: null,
          url: null,
          expiresAt: null,
          message: "비공개 영상 저장소 연결이 필요합니다.",
        },
      };
    }
    if (this.hls.isHlsKey(lesson.videoAssetKey)) {
      return {
        lessonId: lesson.id,
        access,
        playback: {
          status: "ready" as const,
          format: "hls" as const,
          delivery: this.delivery.isCdnEnabled() ? "cloudfront" as const : "object-storage" as const,
          url: `/api/v1/lessons/${encodeURIComponent(lesson.id)}/hls-manifest`,
          expiresAt: this.delivery.getPlaybackExpiresAt(),
          message: "적응형 HLS 재생목록이 준비되었습니다.",
        },
      };
    }
    const signed = await this.delivery.signPlaybackUrl(lesson.videoAssetKey);
    return {
      lessonId: lesson.id,
      access,
      playback: {
        status: "ready" as const,
        format: "mp4" as const,
        delivery: signed.provider,
        url: signed.url,
        expiresAt: signed.expiresAt,
        message: "재생 URL이 준비되었습니다.",
      },
    };
  }

  async getHlsManifest(lessonId: string, relativePath: string | undefined, user?: CurrentUser) {
    const lesson = await this.prisma.lesson.findFirst({
      where: { id: lessonId, status: LessonStatus.PUBLISHED },
      select: { id: true, isFreeSample: true, videoAssetKey: true },
    });
    if (!lesson) {
      throw new ApiError("LESSON_NOT_FOUND", "공개된 강의를 찾을 수 없습니다.", HttpStatus.NOT_FOUND);
    }
    await this.requireAccess(lesson, user);
    if (!lesson.videoAssetKey || !this.hls.isHlsKey(lesson.videoAssetKey)) {
      throw new ApiError("HLS_PLAYBACK_NOT_AVAILABLE", "HLS 재생목록이 준비되지 않았습니다.", HttpStatus.NOT_FOUND);
    }
    return this.hls.render(lesson.id, lesson.videoAssetKey, relativePath);
  }

  async requireLessonAccess(lessonId: string, user?: CurrentUser): Promise<LessonAccess> {
    const lesson = await this.prisma.lesson.findFirst({
      where: { id: lessonId, status: LessonStatus.PUBLISHED },
      select: { id: true, isFreeSample: true },
    });
    if (!lesson) {
      throw new ApiError("LESSON_NOT_FOUND", "공개된 강의를 찾을 수 없습니다.", HttpStatus.NOT_FOUND);
    }
    return this.requireAccess(lesson, user);
  }

  async listPlans() {
    const plans = await this.prisma.subscriptionPlan.findMany({
      where: { active: true },
      orderBy: { months: "asc" },
      select: { id: true, label: true, months: true, price: true, recommended: true },
    });
    return { items: plans };
  }

  private async requireAccess(
    lesson: { id: string; isFreeSample: boolean },
    user?: CurrentUser,
  ): Promise<LessonAccess> {
    if (lesson.isFreeSample) return { source: "free_sample", subscriptionEndsAt: null };
    if (user?.roles.some((role) => role === "operator" || role === "admin")) {
      return { source: "operator_preview", subscriptionEndsAt: null };
    }
    if (!user) {
      throw new ApiError("AUTH_REQUIRED", "구독 전용 강의는 로그인 후 이용할 수 있습니다.", HttpStatus.UNAUTHORIZED);
    }

    const now = new Date();
    const subscription = await this.prisma.accountSubscription.findFirst({
      where: {
        userId: user.id,
        paymentStatus: SubscriptionPaymentStatus.PAID,
        startsAt: { lte: now },
        endsAt: { gt: now },
      },
      orderBy: { endsAt: "desc" },
      select: { endsAt: true },
    });
    if (!subscription) {
      throw new ApiError("SUBSCRIPTION_REQUIRED", "활성 구독이 필요한 강의입니다.", HttpStatus.FORBIDDEN);
    }
    return { source: "subscription", subscriptionEndsAt: subscription.endsAt };
  }
}
