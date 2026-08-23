import { Injectable, Logger } from "@nestjs/common";
import { ApiError } from "../common/api-error.js";
import { loadAppConfig } from "../config/app-config.js";
import { PrismaService } from "../database/prisma.service.js";
import {
  LessonVideoAssetStatus,
  ObjectDeletionJobStatus,
} from "../generated/prisma/enums.js";
import { ObjectStorageService } from "../storage/object-storage.service.js";

const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000, 12 * 60 * 60_000] as const;

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
  return "VIDEO_CLEANUP_FAILED";
}

@Injectable()
export class LessonVideoCleanupWorkerService {
  private readonly logger = new Logger(LessonVideoCleanupWorkerService.name);
  private readonly pollIntervalMs: number;
  private readonly maxAttempts: number;
  private readonly lockTimeoutMs: number;
  private readonly abandonedAfterMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorageService,
  ) {
    const config = loadAppConfig();
    this.pollIntervalMs = config.videoCleanupPollIntervalMs;
    this.maxAttempts = config.videoCleanupMaxAttempts;
    this.lockTimeoutMs = config.videoCleanupLockTimeoutMs;
    this.abandonedAfterMs = config.videoUploadAbandonedAfterHours * 60 * 60_000;
  }

  async runForever(signal: AbortSignal): Promise<void> {
    this.logger.log("Lesson video object cleanup worker started");
    while (!signal.aborted) {
      try {
        const scheduled = await this.scheduleAbandonedUploads();
        const processed = await this.processNextDeletion();
        if (scheduled === 0 && !processed) await wait(this.pollIntervalMs, signal);
      } catch (error) {
        this.logger.error(`Lesson video cleanup polling failed: ${errorCode(error)}`);
        await wait(this.pollIntervalMs, signal);
      }
    }
    this.logger.log("Lesson video object cleanup worker stopped");
  }

  async scheduleAbandonedUploads(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - this.abandonedAfterMs);
    const candidates = await this.prisma.lessonVideoAsset.findMany({
      where: {
        status: LessonVideoAssetStatus.UPLOADING,
        createdAt: { lte: cutoff },
      },
      orderBy: { createdAt: "asc" },
      take: 20,
    });
    let scheduled = 0;
    for (const candidate of candidates) {
      const claimed = await this.prisma.$transaction(async (transaction) => {
        const updated = await transaction.lessonVideoAsset.updateMany({
          where: {
            id: candidate.id,
            status: LessonVideoAssetStatus.UPLOADING,
            createdAt: { lte: cutoff },
          },
          data: {
            status: LessonVideoAssetStatus.PURGED,
            nextAttemptAt: null,
            lockedAt: null,
            lastError: "UPLOAD_ABANDONED",
          },
        });
        if (updated.count !== 1) return false;
        await transaction.objectDeletionJob.upsert({
          where: { objectKey: candidate.objectKey },
          create: {
            objectKey: candidate.objectKey,
            reason: "LESSON_VIDEO_UPLOAD_ABANDONED",
            resourceType: "LessonVideoAsset",
            resourceId: candidate.id,
            nextAttemptAt: now,
            requestedById: candidate.requestedById,
          },
          update: {
            reason: "LESSON_VIDEO_UPLOAD_ABANDONED",
            resourceType: "LessonVideoAsset",
            resourceId: candidate.id,
            status: ObjectDeletionJobStatus.PENDING,
            attempts: 0,
            nextAttemptAt: now,
            lockedAt: null,
            completedAt: null,
            lastError: null,
            requestedById: candidate.requestedById,
          },
        });
        await transaction.auditLog.create({
          data: {
            actorId: candidate.requestedById,
            action: "lesson.video.cleanup_scheduled_abandoned",
            resourceType: "LessonVideoAsset",
            resourceId: candidate.id,
            metadata: { lessonId: candidate.lessonId, objectKey: candidate.objectKey },
          },
        });
        return true;
      });
      if (claimed) scheduled += 1;
    }
    return scheduled;
  }

  async processNextDeletion(now = new Date()): Promise<boolean> {
    const staleLock = new Date(now.getTime() - this.lockTimeoutMs);
    const candidate = await this.prisma.objectDeletionJob.findFirst({
      where: {
        OR: [
          {
            attempts: { lt: this.maxAttempts },
            status: ObjectDeletionJobStatus.PENDING,
            nextAttemptAt: { lte: now },
          },
          {
            attempts: { lt: this.maxAttempts },
            status: ObjectDeletionJobStatus.ERROR,
            nextAttemptAt: { lte: now },
          },
          {
            attempts: { lte: this.maxAttempts },
            status: ObjectDeletionJobStatus.DELETING,
            lockedAt: { lt: staleLock },
          },
        ],
      },
      orderBy: { createdAt: "asc" },
    });
    if (!candidate) return false;

    const claimed = await this.prisma.objectDeletionJob.updateMany({
      where: { id: candidate.id, status: candidate.status, attempts: candidate.attempts },
      data: {
        status: ObjectDeletionJobStatus.DELETING,
        attempts: { increment: 1 },
        lockedAt: now,
        lastError: null,
      },
    });
    if (claimed.count !== 1) return true;

    const attempt = candidate.attempts + 1;
    try {
      const referenceCount = await this.prisma.lesson.count({
        where: { videoAssetKey: candidate.objectKey },
      });
      if (referenceCount > 0) {
        await this.prisma.$transaction(async (transaction) => {
          await transaction.objectDeletionJob.update({
            where: { id: candidate.id },
            data: {
              status: ObjectDeletionJobStatus.CANCELLED,
              completedAt: new Date(),
              lockedAt: null,
              lastError: null,
            },
          });
          await transaction.auditLog.create({
            data: {
              actorId: candidate.requestedById,
              action: "lesson.video.cleanup_cancelled_referenced",
              resourceType: candidate.resourceType,
              resourceId: candidate.resourceId,
              metadata: { objectKey: candidate.objectKey, reason: candidate.reason },
            },
          });
        });
        return true;
      }

      await this.storage.deleteVideoObject(candidate.objectKey);
      await this.prisma.$transaction(async (transaction) => {
        await transaction.lessonVideoAsset.updateMany({
          where: {
            objectKey: candidate.objectKey,
            status: LessonVideoAssetStatus.READY,
          },
          data: { status: LessonVideoAssetStatus.PURGED },
        });
        await transaction.objectDeletionJob.update({
          where: { id: candidate.id },
          data: {
            status: ObjectDeletionJobStatus.COMPLETED,
            completedAt: new Date(),
            lockedAt: null,
            lastError: null,
          },
        });
        await transaction.auditLog.create({
          data: {
            actorId: candidate.requestedById,
            action: "lesson.video.cleanup_completed",
            resourceType: candidate.resourceType,
            resourceId: candidate.resourceId,
            metadata: { objectKey: candidate.objectKey, reason: candidate.reason, attempt },
          },
        });
      });
    } catch (error) {
      const code = errorCode(error);
      const delay = RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)] ?? RETRY_DELAYS_MS[0];
      await this.prisma.$transaction(async (transaction) => {
        await transaction.objectDeletionJob.update({
          where: { id: candidate.id },
          data: {
            status: ObjectDeletionJobStatus.ERROR,
            lockedAt: null,
            lastError: code,
            nextAttemptAt: new Date(Date.now() + delay),
          },
        });
        await transaction.auditLog.create({
          data: {
            actorId: candidate.requestedById,
            action: "lesson.video.cleanup_failed",
            resourceType: candidate.resourceType,
            resourceId: candidate.resourceId,
            metadata: {
              objectKey: candidate.objectKey,
              reason: candidate.reason,
              attempt,
              retry: attempt < this.maxAttempts,
              errorCode: code,
            },
          },
        });
      });
      this.logger.warn(`Lesson video cleanup failed: ${candidate.id} (${code}, attempt ${attempt})`);
    }
    return true;
  }
}
