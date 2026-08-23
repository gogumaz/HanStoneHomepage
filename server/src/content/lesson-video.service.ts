import { HttpStatus, Injectable } from "@nestjs/common";
import type { CurrentUser } from "../auth/auth.types.js";
import { ApiError } from "../common/api-error.js";
import { loadAppConfig } from "../config/app-config.js";
import { PrismaService } from "../database/prisma.service.js";
import { HlsTranscodeJobStatus, LessonVideoAssetStatus, ObjectDeletionJobStatus } from "../generated/prisma/enums.js";
import { ObjectStorageService } from "../storage/object-storage.service.js";
import { HlsManifestService } from "./hls-manifest.service.js";

type StartVideoUploadInput = {
  fileName: string;
  contentType: "video/mp4";
  size: number;
};

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function validateStartInput(body: unknown, maxBytes: number): StartVideoUploadInput {
  if (!body || typeof body !== "object") {
    throw new ApiError("INVALID_VIDEO_UPLOAD", "업로드할 영상 정보를 입력해 주세요.", HttpStatus.BAD_REQUEST);
  }
  const data = body as Record<string, unknown>;
  const fileName = readString(data.fileName);
  const contentType = readString(data.contentType);
  const size = data.size;
  if (
    !fileName
    || fileName.length > 255
    || fileName.includes("/")
    || fileName.includes("\\")
    || !fileName.toLowerCase().endsWith(".mp4")
    || contentType !== "video/mp4"
    || !Number.isSafeInteger(size)
    || (size as number) <= 0
    || (size as number) > maxBytes
  ) {
    throw new ApiError(
      "INVALID_VIDEO_UPLOAD",
      `MP4 영상만 업로드할 수 있으며 최대 크기는 ${Math.floor(maxBytes / 1024 / 1024)}MB입니다.`,
      HttpStatus.BAD_REQUEST,
    );
  }
  return { fileName, contentType: "video/mp4", size: size as number };
}

function validateCompleteInput(body: unknown): { assetKey: string } {
  if (!body || typeof body !== "object") {
    throw new ApiError("INVALID_VIDEO_UPLOAD", "업로드 완료 정보를 입력해 주세요.", HttpStatus.BAD_REQUEST);
  }
  const assetKey = readString((body as Record<string, unknown>).assetKey);
  if (!assetKey || assetKey.length > 1024) {
    throw new ApiError("INVALID_VIDEO_UPLOAD", "업로드 완료 정보를 확인해 주세요.", HttpStatus.BAD_REQUEST);
  }
  return { assetKey };
}

@Injectable()
export class LessonVideoService {
  private readonly replacedRetentionMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorageService,
    private readonly hls: HlsManifestService,
  ) {
    this.replacedRetentionMs = loadAppConfig().videoReplacedRetentionHours * 60 * 60_000;
  }

  async activateHls(user: CurrentUser, lessonId: string, body: unknown, requestId?: string) {
    const manifestKey = body && typeof body === "object"
      ? readString((body as Record<string, unknown>).manifestKey)
      : "";
    if (!manifestKey || manifestKey.length > 1024) {
      throw new ApiError("INVALID_HLS_SOURCE", "HLS 마스터 재생목록 경로를 입력해 주세요.", HttpStatus.BAD_REQUEST);
    }
    const lesson = await this.prisma.lesson.findUnique({
      where: { id: lessonId },
      select: { id: true, videoAssetKey: true },
    });
    if (!lesson) throw new ApiError("LESSON_NOT_FOUND", "강의를 찾을 수 없습니다.", HttpStatus.NOT_FOUND);
    await this.hls.validateMaster(lesson.id, manifestKey);
    const activatedAt = new Date();
    await this.prisma.$transaction(async (transaction) => {
      await transaction.lesson.update({ where: { id: lesson.id }, data: { videoAssetKey: manifestKey } });
      if (
        lesson.videoAssetKey
        && lesson.videoAssetKey !== manifestKey
        && lesson.videoAssetKey.startsWith("lesson-videos/")
        && lesson.videoAssetKey.endsWith(".mp4")
      ) {
        const eligibleAt = new Date(activatedAt.getTime() + this.replacedRetentionMs);
        await transaction.objectDeletionJob.upsert({
          where: { objectKey: lesson.videoAssetKey },
          create: {
            objectKey: lesson.videoAssetKey,
            reason: "LESSON_VIDEO_REPLACED",
            resourceType: "Lesson",
            resourceId: lesson.id,
            nextAttemptAt: eligibleAt,
            requestedById: user.id,
          },
          update: {
            status: ObjectDeletionJobStatus.PENDING,
            attempts: 0,
            nextAttemptAt: eligibleAt,
            lockedAt: null,
            completedAt: null,
            lastError: null,
            requestedById: user.id,
          },
        });
      }
      await transaction.auditLog.create({
        data: {
          actorId: user.id,
          action: "lesson.video.hls_activated",
          resourceType: "Lesson",
          resourceId: lesson.id,
          requestId: requestId ?? null,
          metadata: { manifestKey, previousAssetKey: lesson.videoAssetKey },
        },
      });
    });
    return {
      lessonId: lesson.id,
      format: "hls" as const,
      manifestKey,
      activatedAt,
    };
  }

  async startUpload(user: CurrentUser, lessonId: string, body: unknown, requestId?: string) {
    const lesson = await this.prisma.lesson.findUnique({
      where: { id: lessonId },
      select: { id: true },
    });
    if (!lesson) {
      throw new ApiError("LESSON_NOT_FOUND", "강의를 찾을 수 없습니다.", HttpStatus.NOT_FOUND);
    }
    const input = validateStartInput(body, this.storage.getVideoUploadMaxBytes());
    const upload = await this.storage.createVideoUpload(lesson.id, input.size);
    const videoAsset = await this.prisma.$transaction(async (transaction) => {
      const created = await transaction.lessonVideoAsset.create({
        data: {
          lessonId: lesson.id,
          objectKey: upload.assetKey,
          originalName: input.fileName,
          contentType: input.contentType,
          expectedSize: BigInt(input.size),
          requestedById: user.id,
        },
      });
      await transaction.auditLog.create({
        data: {
          actorId: user.id,
          action: "lesson.video.upload_requested",
          resourceType: "LessonVideoAsset",
          resourceId: created.id,
          requestId: requestId ?? null,
          metadata: {
            lessonId: lesson.id,
            assetKey: upload.assetKey,
            fileName: input.fileName,
            contentType: input.contentType,
            size: input.size,
          },
        },
      });
      return created;
    });
    return {
      lessonId: lesson.id,
      videoAsset: this.view(videoAsset, lesson.id, null),
      upload: {
        method: upload.method,
        url: upload.url,
        fields: upload.fields,
        assetKey: upload.assetKey,
        expiresAt: upload.expiresAt,
        maxBytes: this.storage.getVideoUploadMaxBytes(),
      },
    };
  }

  async completeUpload(user: CurrentUser, lessonId: string, body: unknown, requestId?: string) {
    const input = validateCompleteInput(body);
    const lesson = await this.prisma.lesson.findUnique({
      where: { id: lessonId },
      select: { id: true, videoAssetKey: true },
    });
    if (!lesson) {
      throw new ApiError("LESSON_NOT_FOUND", "강의를 찾을 수 없습니다.", HttpStatus.NOT_FOUND);
    }
    const videoAsset = await this.prisma.lessonVideoAsset.findFirst({
      where: { lessonId: lesson.id, objectKey: input.assetKey },
    });
    if (!videoAsset) {
      throw new ApiError("VIDEO_UPLOAD_NOT_FOUND", "등록된 영상 업로드 요청을 찾을 수 없습니다.", HttpStatus.NOT_FOUND);
    }
    if (videoAsset.status !== LessonVideoAssetStatus.UPLOADING) {
      return this.view(videoAsset, lesson.id, lesson.videoAssetKey);
    }
    const inspected = await this.storage.inspectVideoUpload(input.assetKey, lesson.id);
    const queued = await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.lessonVideoAsset.update({
        where: { id: videoAsset.id },
        data: {
          actualSize: BigInt(inspected.size),
          status: LessonVideoAssetStatus.QUARANTINED,
          previousAssetKey: lesson.videoAssetKey,
          nextAttemptAt: new Date(),
          lastError: null,
        },
      });
      await transaction.auditLog.create({
        data: {
          actorId: user.id,
          action: "lesson.video.scan_queued",
          resourceType: "LessonVideoAsset",
          resourceId: videoAsset.id,
          requestId: requestId ?? null,
          metadata: {
            lessonId: lesson.id,
            assetKey: inspected.assetKey,
            previousAssetKey: lesson.videoAssetKey,
            contentType: inspected.contentType,
            size: inspected.size,
          },
        },
      });
      return updated;
    });
    return this.view(queued, lesson.id, lesson.videoAssetKey);
  }

  async listUploads(lessonId: string) {
    const lesson = await this.prisma.lesson.findUnique({
      where: { id: lessonId },
      select: { id: true, videoAssetKey: true },
    });
    if (!lesson) throw new ApiError("LESSON_NOT_FOUND", "강의를 찾을 수 없습니다.", HttpStatus.NOT_FOUND);
    const items = await this.prisma.lessonVideoAsset.findMany({
      where: { lessonId },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: {
        hlsTranscodeJob: {
          select: {
            status: true,
            attempts: true,
            manifestKey: true,
            lastError: true,
            completedAt: true,
          },
        },
      },
    });
    return { items: items.map((item) => this.view(item, lesson.id, lesson.videoAssetKey)) };
  }

  async retryScan(user: CurrentUser, lessonId: string, assetId: string, requestId?: string) {
    const asset = await this.prisma.lessonVideoAsset.findFirst({ where: { id: assetId, lessonId } });
    if (!asset) throw new ApiError("VIDEO_UPLOAD_NOT_FOUND", "영상 검사 작업을 찾을 수 없습니다.", HttpStatus.NOT_FOUND);
    if (asset.status !== LessonVideoAssetStatus.ERROR) {
      throw new ApiError("VIDEO_SCAN_RETRY_NOT_ALLOWED", "오류 상태의 영상 검사만 다시 시도할 수 있습니다.", HttpStatus.CONFLICT);
    }
    const retried = await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.lessonVideoAsset.update({
        where: { id: asset.id },
        data: {
          status: LessonVideoAssetStatus.QUARANTINED,
          attempts: 0,
          nextAttemptAt: new Date(),
          lockedAt: null,
          lastError: null,
        },
      });
      await transaction.auditLog.create({
        data: {
          actorId: user.id,
          action: "lesson.video.scan_retried",
          resourceType: "LessonVideoAsset",
          resourceId: asset.id,
          requestId: requestId ?? null,
          metadata: { lessonId },
        },
      });
      return updated;
    });
    const lesson = await this.prisma.lesson.findUnique({
      where: { id: lessonId },
      select: { videoAssetKey: true },
    });
    return this.view(retried, lessonId, lesson?.videoAssetKey ?? null);
  }

  async retryHlsTranscode(user: CurrentUser, lessonId: string, assetId: string, requestId?: string) {
    const job = await this.prisma.hlsTranscodeJob.findFirst({
      where: { lessonId, sourceAssetId: assetId },
    });
    if (!job) {
      throw new ApiError("HLS_TRANSCODE_JOB_NOT_FOUND", "HLS 변환 작업을 찾을 수 없습니다.", HttpStatus.NOT_FOUND);
    }
    if (job.status !== HlsTranscodeJobStatus.ERROR) {
      throw new ApiError(
        "HLS_TRANSCODE_RETRY_NOT_ALLOWED",
        "오류 상태의 HLS 변환 작업만 다시 시도할 수 있습니다.",
        HttpStatus.CONFLICT,
      );
    }
    const lesson = await this.prisma.lesson.findUnique({
      where: { id: lessonId },
      select: { videoAssetKey: true },
    });
    if (lesson?.videoAssetKey !== job.sourceObjectKey) {
      throw new ApiError(
        "HLS_TRANSCODE_SOURCE_SUPERSEDED",
        "현재 영상이 변경되어 이 변환 작업을 다시 시도할 수 없습니다.",
        HttpStatus.CONFLICT,
      );
    }
    const retried = await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.hlsTranscodeJob.update({
        where: { id: job.id },
        data: {
          status: HlsTranscodeJobStatus.PENDING,
          attempts: 0,
          nextAttemptAt: new Date(),
          lockedAt: null,
          completedAt: null,
          manifestKey: null,
          lastError: null,
        },
      });
      await transaction.auditLog.create({
        data: {
          actorId: user.id,
          action: "lesson.video.hls_transcode_retried",
          resourceType: "HlsTranscodeJob",
          resourceId: job.id,
          requestId: requestId ?? null,
          metadata: { lessonId, sourceAssetId: assetId },
        },
      });
      return updated;
    });
    return {
      status: retried.status.toLowerCase(),
      attempts: retried.attempts,
      manifestKey: retried.manifestKey,
      lastError: retried.lastError,
      completedAt: retried.completedAt,
    };
  }

  private view(asset: {
    id: string;
    objectKey: string;
    originalName: string;
    contentType: string;
    expectedSize: bigint;
    actualSize: bigint | null;
    status: LessonVideoAssetStatus;
    scanProvider: string | null;
    scanResult: string | null;
    scannedAt: Date | null;
    attachedAt: Date | null;
    attempts: number;
    nextAttemptAt: Date | null;
    lastError: string | null;
    createdAt: Date;
    hlsTranscodeJob?: {
      status: HlsTranscodeJobStatus;
      attempts: number;
      manifestKey: string | null;
      lastError: string | null;
      completedAt: Date | null;
    } | null;
  }, lessonId: string, currentAssetKey: string | null) {
    return {
      id: asset.id,
      lessonId,
      status: asset.status.toLowerCase(),
      fileName: asset.originalName,
      contentType: asset.contentType,
      expectedSize: Number(asset.expectedSize),
      size: asset.actualSize === null ? null : Number(asset.actualSize),
      scanProvider: asset.scanProvider,
      scanResult: asset.scanResult,
      scannedAt: asset.scannedAt,
      attachedAt: asset.attachedAt,
      attempts: asset.attempts,
      nextAttemptAt: asset.nextAttemptAt,
      lastError: asset.lastError,
      isCurrent: asset.objectKey === currentAssetKey,
      createdAt: asset.createdAt,
      hlsTranscode: asset.hlsTranscodeJob ? {
        status: asset.hlsTranscodeJob.status.toLowerCase(),
        attempts: asset.hlsTranscodeJob.attempts,
        manifestKey: asset.hlsTranscodeJob.manifestKey,
        lastError: asset.hlsTranscodeJob.lastError,
        completedAt: asset.hlsTranscodeJob.completedAt,
      } : null,
    };
  }
}
