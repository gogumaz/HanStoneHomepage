import { Injectable, Logger } from "@nestjs/common";
import { ApiError } from "../common/api-error.js";
import { loadAppConfig } from "../config/app-config.js";
import { PrismaService } from "../database/prisma.service.js";
import { HlsTranscodeJobStatus, LessonVideoAssetStatus, ObjectDeletionJobStatus } from "../generated/prisma/enums.js";
import { MalwareScannerService } from "../storage/malware-scanner.service.js";
import { ObjectStorageService } from "../storage/object-storage.service.js";

const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000] as const;

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const finish = () => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timeout = setTimeout(finish, milliseconds);
    signal.addEventListener("abort", finish, { once: true });
  });
}

function errorCode(error: unknown): string {
  if (error instanceof ApiError) return error.code;
  if (error instanceof Error && error.name) return error.name.slice(0, 100);
  return "VIDEO_SCAN_FAILED";
}

@Injectable()
export class LessonVideoScanWorkerService {
  private readonly logger = new Logger(LessonVideoScanWorkerService.name);
  private readonly pollIntervalMs: number;
  private readonly maxAttempts: number;
  private readonly lockTimeoutMs: number;
  private readonly replacedRetentionMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorageService,
    private readonly scanner: MalwareScannerService,
  ) {
    const config = loadAppConfig();
    this.pollIntervalMs = config.videoScanPollIntervalMs;
    this.maxAttempts = config.videoScanMaxAttempts;
    this.lockTimeoutMs = config.videoScanLockTimeoutMs;
    this.replacedRetentionMs = config.videoReplacedRetentionHours * 60 * 60_000;
  }

  async runForever(signal: AbortSignal): Promise<void> {
    this.logger.log("Lesson video malware scan worker started");
    while (!signal.aborted) {
      try {
        const processed = await this.processNext();
        if (!processed) await wait(this.pollIntervalMs, signal);
      } catch (error) {
        this.logger.error(`Lesson video worker polling failed: ${errorCode(error)}`);
        await wait(this.pollIntervalMs, signal);
      }
    }
    this.logger.log("Lesson video malware scan worker stopped");
  }

  async processNext(): Promise<boolean> {
    const now = new Date();
    const staleLock = new Date(now.getTime() - this.lockTimeoutMs);
    const candidate = await this.prisma.lessonVideoAsset.findFirst({
      where: {
        attempts: { lt: this.maxAttempts },
        OR: [
          { status: LessonVideoAssetStatus.QUARANTINED, nextAttemptAt: { lte: now } },
          { status: LessonVideoAssetStatus.ERROR, nextAttemptAt: { lte: now } },
          { status: LessonVideoAssetStatus.SCANNING, lockedAt: { lt: staleLock } },
        ],
      },
      orderBy: { createdAt: "asc" },
    });
    if (!candidate) return false;

    const claimed = await this.prisma.lessonVideoAsset.updateMany({
      where: { id: candidate.id, status: candidate.status, attempts: candidate.attempts },
      data: {
        status: LessonVideoAssetStatus.SCANNING,
        attempts: { increment: 1 },
        lockedAt: now,
        nextAttemptAt: null,
        lastError: null,
      },
    });
    if (claimed.count !== 1) return true;

    const attempt = candidate.attempts + 1;
    try {
      const stream = await this.storage.openVideoScanStream(candidate.objectKey);
      const scan = await this.scanner.scanStream(stream);
      const completedAt = new Date();
      if (!scan.clean) {
        await this.prisma.$transaction(async (transaction) => {
          await transaction.lessonVideoAsset.update({
            where: { id: candidate.id },
            data: {
              status: LessonVideoAssetStatus.REJECTED,
              scanProvider: scan.provider,
              scanResult: scan.result,
              scannedAt: completedAt,
              lockedAt: null,
              nextAttemptAt: null,
            },
          });
          await transaction.auditLog.create({
            data: {
              actorId: candidate.requestedById,
              action: "lesson.video.scan_rejected",
              resourceType: "LessonVideoAsset",
              resourceId: candidate.id,
              metadata: { lessonId: candidate.lessonId, provider: scan.provider, result: scan.result },
            },
          });
        });
        return true;
      }

      await this.prisma.$transaction(async (transaction) => {
        const lesson = await transaction.lesson.findUnique({
          where: { id: candidate.lessonId },
          select: { videoAssetKey: true },
        });
        const currentAsset = lesson?.videoAssetKey
          ? await transaction.lessonVideoAsset.findUnique({ where: { objectKey: lesson.videoAssetKey } })
          : null;
        const shouldAttach = !currentAsset || currentAsset.createdAt <= candidate.createdAt;
        await transaction.lessonVideoAsset.update({
          where: { id: candidate.id },
          data: {
            status: LessonVideoAssetStatus.READY,
            scanProvider: scan.provider,
            scanResult: scan.result,
            scannedAt: completedAt,
            attachedAt: shouldAttach ? completedAt : null,
            lockedAt: null,
            nextAttemptAt: null,
          },
        });
        if (shouldAttach) {
          const replacedKey = lesson?.videoAssetKey;
          await transaction.lesson.update({
            where: { id: candidate.lessonId },
            data: { videoAssetKey: candidate.objectKey },
          });
          await transaction.hlsTranscodeJob.upsert({
            where: { sourceAssetId: candidate.id },
            create: {
              lessonId: candidate.lessonId,
              sourceAssetId: candidate.id,
              sourceObjectKey: candidate.objectKey,
              requestedById: candidate.requestedById,
            },
            update: {
              status: HlsTranscodeJobStatus.PENDING,
              attempts: 0,
              nextAttemptAt: completedAt,
              lockedAt: null,
              completedAt: null,
              lastError: null,
              manifestKey: null,
              requestedById: candidate.requestedById,
            },
          });
          if (
            replacedKey
            && replacedKey !== candidate.objectKey
            && replacedKey.startsWith("lesson-videos/")
            && replacedKey.endsWith(".mp4")
          ) {
            const eligibleAt = new Date(completedAt.getTime() + this.replacedRetentionMs);
            await transaction.objectDeletionJob.upsert({
              where: { objectKey: replacedKey },
              create: {
                objectKey: replacedKey,
                reason: "LESSON_VIDEO_REPLACED",
                resourceType: "Lesson",
                resourceId: candidate.lessonId,
                nextAttemptAt: eligibleAt,
                requestedById: candidate.requestedById,
              },
              update: {
                reason: "LESSON_VIDEO_REPLACED",
                resourceType: "Lesson",
                resourceId: candidate.lessonId,
                status: ObjectDeletionJobStatus.PENDING,
                attempts: 0,
                nextAttemptAt: eligibleAt,
                lockedAt: null,
                completedAt: null,
                lastError: null,
                requestedById: candidate.requestedById,
              },
            });
            await transaction.auditLog.create({
              data: {
                actorId: candidate.requestedById,
                action: "lesson.video.cleanup_scheduled_replaced",
                resourceType: "Lesson",
                resourceId: candidate.lessonId,
                metadata: { objectKey: replacedKey, eligibleAt: eligibleAt.toISOString() },
              },
            });
          }
        }
        await transaction.auditLog.create({
          data: {
            actorId: candidate.requestedById,
            action: shouldAttach ? "lesson.video.scan_passed_attached" : "lesson.video.scan_passed_superseded",
            resourceType: "LessonVideoAsset",
            resourceId: candidate.id,
            metadata: {
              lessonId: candidate.lessonId,
              provider: scan.provider,
              previousAssetKey: candidate.previousAssetKey,
            },
          },
        });
        if (shouldAttach) {
          await transaction.auditLog.create({
            data: {
              actorId: candidate.requestedById,
              action: "lesson.video.hls_transcode_queued",
              resourceType: "LessonVideoAsset",
              resourceId: candidate.id,
              metadata: { lessonId: candidate.lessonId, sourceObjectKey: candidate.objectKey },
            },
          });
        }
      });
    } catch (error) {
      const code = errorCode(error);
      const retry = attempt < this.maxAttempts;
      const delay = RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)] ?? RETRY_DELAYS_MS[0];
      await this.prisma.$transaction(async (transaction) => {
        await transaction.lessonVideoAsset.update({
          where: { id: candidate.id },
          data: {
            status: LessonVideoAssetStatus.ERROR,
            lockedAt: null,
            lastError: code,
            nextAttemptAt: retry ? new Date(Date.now() + delay) : null,
          },
        });
        await transaction.auditLog.create({
          data: {
            actorId: candidate.requestedById,
            action: "lesson.video.scan_failed",
            resourceType: "LessonVideoAsset",
            resourceId: candidate.id,
            metadata: { lessonId: candidate.lessonId, attempt, retry, errorCode: code },
          },
        });
      });
      this.logger.warn(`Lesson video scan failed: ${candidate.id} (${code}, attempt ${attempt})`);
    }
    return true;
  }
}
