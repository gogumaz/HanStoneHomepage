import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Injectable, Logger } from "@nestjs/common";
import { ApiError } from "../common/api-error.js";
import { loadAppConfig } from "../config/app-config.js";
import { PrismaService } from "../database/prisma.service.js";
import { HlsTranscodeJobStatus, ObjectDeletionJobStatus } from "../generated/prisma/enums.js";
import { ObjectStorageService } from "../storage/object-storage.service.js";
import { HlsTranscoderService } from "./hls-transcoder.service.js";

const RETRY_DELAYS_MS = [5 * 60_000, 30 * 60_000, 2 * 60 * 60_000] as const;

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolvePromise) => {
    if (signal.aborted) return resolvePromise();
    const finish = () => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", finish);
      resolvePromise();
    };
    const timeout = setTimeout(finish, milliseconds);
    signal.addEventListener("abort", finish, { once: true });
  });
}

function errorCode(error: unknown): string {
  if (error instanceof ApiError) return error.code;
  if (error instanceof Error && error.name) return error.name.slice(0, 100);
  return "HLS_TRANSCODE_FAILED";
}

@Injectable()
export class LessonHlsTranscodeWorkerService {
  private readonly logger = new Logger(LessonHlsTranscodeWorkerService.name);
  private readonly pollIntervalMs: number;
  private readonly maxAttempts: number;
  private readonly lockTimeoutMs: number;
  private readonly replacedRetentionMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorageService,
    private readonly transcoder: HlsTranscoderService,
  ) {
    const config = loadAppConfig();
    this.pollIntervalMs = config.hlsTranscodePollIntervalMs;
    this.maxAttempts = config.hlsTranscodeMaxAttempts;
    this.lockTimeoutMs = config.hlsTranscodeLockTimeoutMs;
    this.replacedRetentionMs = config.videoReplacedRetentionHours * 60 * 60_000;
  }

  async runForever(signal: AbortSignal): Promise<void> {
    await this.transcoder.verifyBinaries();
    this.logger.log("Lesson HLS transcode worker started");
    while (!signal.aborted) {
      try {
        const processed = await this.processNext();
        if (!processed) await wait(this.pollIntervalMs, signal);
      } catch (error) {
        this.logger.error(`HLS transcode polling failed: ${errorCode(error)}`);
        await wait(this.pollIntervalMs, signal);
      }
    }
    this.logger.log("Lesson HLS transcode worker stopped");
  }

  async processNext(): Promise<boolean> {
    const now = new Date();
    const staleLock = new Date(now.getTime() - this.lockTimeoutMs);
    const candidate = await this.prisma.hlsTranscodeJob.findFirst({
      where: {
        attempts: { lt: this.maxAttempts },
        OR: [
          { status: HlsTranscodeJobStatus.PENDING, nextAttemptAt: { lte: now } },
          { status: HlsTranscodeJobStatus.ERROR, nextAttemptAt: { lte: now } },
          { status: HlsTranscodeJobStatus.TRANSCODING, lockedAt: { lt: staleLock } },
        ],
      },
      orderBy: { createdAt: "asc" },
    });
    if (!candidate) return false;
    const claimed = await this.prisma.hlsTranscodeJob.updateMany({
      where: { id: candidate.id, status: candidate.status, attempts: candidate.attempts },
      data: {
        status: HlsTranscodeJobStatus.TRANSCODING,
        attempts: { increment: 1 },
        lockedAt: now,
        nextAttemptAt: now,
        lastError: null,
      },
    });
    if (claimed.count !== 1) return true;

    const lesson = await this.prisma.lesson.findUnique({
      where: { id: candidate.lessonId },
      select: { videoAssetKey: true },
    });
    if (lesson?.videoAssetKey !== candidate.sourceObjectKey) {
      await this.markSuperseded(candidate.id, candidate.requestedById, candidate.lessonId);
      return true;
    }

    const attempt = candidate.attempts + 1;
    const packagePrefix = `lesson-hls/${candidate.lessonId}/${candidate.id}`;
    const temporaryRoot = await mkdtemp(join(tmpdir(), "baduk-hls-"));
    const inputPath = join(temporaryRoot, "source.mp4");
    const outputDirectory = join(temporaryRoot, "output");
    let uploaded = false;
    try {
      await mkdir(outputDirectory);
      await this.storage.downloadVideoToFile(candidate.sourceObjectKey, inputPath);
      const transcoded = await this.transcoder.transcode(inputPath, outputDirectory);
      const uploadedPackage = await this.storage.uploadHlsPackage(outputDirectory, packagePrefix);
      uploaded = true;
      const completedAt = new Date();
      const attached = await this.prisma.$transaction(async (transaction) => {
        const currentLesson = await transaction.lesson.findUnique({
          where: { id: candidate.lessonId },
          select: { videoAssetKey: true },
        });
        if (currentLesson?.videoAssetKey !== candidate.sourceObjectKey) {
          await transaction.hlsTranscodeJob.update({
            where: { id: candidate.id },
            data: {
              status: HlsTranscodeJobStatus.SUPERSEDED,
              manifestKey: null,
              lockedAt: null,
              completedAt,
              nextAttemptAt: completedAt,
            },
          });
          return false;
        }
        await transaction.lesson.update({
          where: { id: candidate.lessonId },
          data: { videoAssetKey: uploadedPackage.manifestKey },
        });
        await transaction.hlsTranscodeJob.update({
          where: { id: candidate.id },
          data: {
            status: HlsTranscodeJobStatus.READY,
            manifestKey: uploadedPackage.manifestKey,
            lockedAt: null,
            completedAt,
            nextAttemptAt: completedAt,
            lastError: null,
          },
        });
        const eligibleAt = new Date(completedAt.getTime() + this.replacedRetentionMs);
        await transaction.objectDeletionJob.upsert({
          where: { objectKey: candidate.sourceObjectKey },
          create: {
            objectKey: candidate.sourceObjectKey,
            reason: "LESSON_VIDEO_HLS_TRANSCODED",
            resourceType: "Lesson",
            resourceId: candidate.lessonId,
            nextAttemptAt: eligibleAt,
            requestedById: candidate.requestedById,
          },
          update: {
            reason: "LESSON_VIDEO_HLS_TRANSCODED",
            status: ObjectDeletionJobStatus.PENDING,
            attempts: 0,
            nextAttemptAt: eligibleAt,
            lockedAt: null,
            completedAt: null,
            lastError: null,
          },
        });
        await transaction.auditLog.create({
          data: {
            actorId: candidate.requestedById,
            action: "lesson.video.hls_transcode_completed",
            resourceType: "HlsTranscodeJob",
            resourceId: candidate.id,
            metadata: {
              lessonId: candidate.lessonId,
              manifestKey: uploadedPackage.manifestKey,
              fileCount: uploadedPackage.fileCount,
              renditionCount: transcoded.renditionCount,
              sourceDeletionEligibleAt: eligibleAt.toISOString(),
            },
          },
        });
        return true;
      });
      if (!attached) {
        await this.storage.deleteHlsPackage(packagePrefix);
        uploaded = false;
      }
    } catch (error) {
      if (uploaded) {
        try {
          await this.storage.deleteHlsPackage(packagePrefix);
        } catch {
          // Lifecycle cleanup is the final safety net for an unreferenced failed package.
        }
      }
      const code = errorCode(error);
      const retry = attempt < this.maxAttempts;
      const delay = RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)] ?? RETRY_DELAYS_MS[0];
      await this.prisma.$transaction(async (transaction) => {
        await transaction.hlsTranscodeJob.update({
          where: { id: candidate.id },
          data: {
            status: HlsTranscodeJobStatus.ERROR,
            lockedAt: null,
            lastError: code,
            nextAttemptAt: retry ? new Date(Date.now() + delay) : new Date(),
          },
        });
        await transaction.auditLog.create({
          data: {
            actorId: candidate.requestedById,
            action: "lesson.video.hls_transcode_failed",
            resourceType: "HlsTranscodeJob",
            resourceId: candidate.id,
            metadata: { lessonId: candidate.lessonId, attempt, retry, errorCode: code },
          },
        });
      });
      this.logger.warn(`HLS transcode failed: ${candidate.id} (${code}, attempt ${attempt})`);
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
    return true;
  }

  private async markSuperseded(jobId: string, actorId: string | null, lessonId: string): Promise<void> {
    const completedAt = new Date();
    await this.prisma.$transaction(async (transaction) => {
      await transaction.hlsTranscodeJob.update({
        where: { id: jobId },
        data: {
          status: HlsTranscodeJobStatus.SUPERSEDED,
          lockedAt: null,
          completedAt,
          nextAttemptAt: completedAt,
        },
      });
      await transaction.auditLog.create({
        data: {
          actorId,
          action: "lesson.video.hls_transcode_superseded",
          resourceType: "HlsTranscodeJob",
          resourceId: jobId,
          metadata: { lessonId },
        },
      });
    });
  }
}
