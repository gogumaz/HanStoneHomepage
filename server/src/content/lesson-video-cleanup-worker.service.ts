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
  return "OBJECT_CLEANUP_FAILED";
}

@Injectable()
export class LessonVideoCleanupWorkerService {
  private readonly logger = new Logger(LessonVideoCleanupWorkerService.name);
  private readonly pollIntervalMs: number;
  private readonly maxAttempts: number;
  private readonly lockTimeoutMs: number;
  private readonly abandonedAfterMs: number;
  private readonly inquiryAttachmentRetentionMs: number;
  private readonly communityAttachmentRetentionMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorageService,
  ) {
    const config = loadAppConfig();
    this.pollIntervalMs = config.videoCleanupPollIntervalMs;
    this.maxAttempts = config.videoCleanupMaxAttempts;
    this.lockTimeoutMs = config.videoCleanupLockTimeoutMs;
    this.abandonedAfterMs = config.videoUploadAbandonedAfterHours * 60 * 60_000;
    this.inquiryAttachmentRetentionMs = config.inquiryAttachmentRetentionHours * 60 * 60_000;
    this.communityAttachmentRetentionMs = config.communityAttachmentRetentionHours * 60 * 60_000;
  }

  async runForever(signal: AbortSignal): Promise<void> {
    this.logger.log("Managed object cleanup worker started");
    while (!signal.aborted) {
      try {
        const scheduledVideos = await this.scheduleAbandonedUploads();
        const scheduledAttachments = await this.scheduleAbandonedInquiryAttachments();
        const scheduledCommunityAttachments = await this.scheduleAbandonedCommunityAttachments();
        const scheduledTeachingMaterialAssets = await this.scheduleAbandonedTeachingMaterialAssets();
        const scheduledClassHelperAssets = await this.scheduleAbandonedClassHelperAssets();
        const processed = await this.processNextDeletion();
        if (scheduledVideos === 0 && scheduledAttachments === 0 && scheduledCommunityAttachments === 0 && scheduledTeachingMaterialAssets === 0 && scheduledClassHelperAssets === 0 && !processed) {
          await wait(this.pollIntervalMs, signal);
        }
      } catch (error) {
        this.logger.error(`Managed object cleanup polling failed: ${errorCode(error)}`);
        await wait(this.pollIntervalMs, signal);
      }
    }
    this.logger.log("Managed object cleanup worker stopped");
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

  async scheduleAbandonedInquiryAttachments(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - this.inquiryAttachmentRetentionMs);
    const candidates = await this.prisma.inquiryAttachment.findMany({
      where: { inquiryId: null, createdAt: { lte: cutoff } },
      orderBy: { createdAt: "asc" },
      take: 20,
    });
    let scheduled = 0;
    for (const candidate of candidates) {
      const claimed = await this.prisma.$transaction(async (transaction) => {
        const deleted = await transaction.inquiryAttachment.deleteMany({
          where: { id: candidate.id, inquiryId: null, createdAt: { lte: cutoff } },
        });
        if (deleted.count !== 1) return false;
        await transaction.objectDeletionJob.upsert({
          where: { objectKey: candidate.objectKey },
          create: {
            objectKey: candidate.objectKey,
            reason: "INQUIRY_ATTACHMENT_UNATTACHED_EXPIRED",
            resourceType: "InquiryAttachment",
            resourceId: candidate.id,
            nextAttemptAt: now,
            requestedById: candidate.ownerUserId,
          },
          update: {
            reason: "INQUIRY_ATTACHMENT_UNATTACHED_EXPIRED",
            resourceType: "InquiryAttachment",
            resourceId: candidate.id,
            status: ObjectDeletionJobStatus.PENDING,
            attempts: 0,
            nextAttemptAt: now,
            lockedAt: null,
            completedAt: null,
            lastError: null,
            requestedById: candidate.ownerUserId,
          },
        });
        await transaction.auditLog.create({
          data: {
            actorId: candidate.ownerUserId,
            action: "inquiry.attachment.cleanup_scheduled",
            resourceType: "InquiryAttachment",
            resourceId: candidate.id,
            metadata: { reason: "unattached_expired", status: candidate.status.toLowerCase() },
          },
        });
        return true;
      });
      if (claimed) scheduled += 1;
    }
    return scheduled;
  }

  async scheduleAbandonedCommunityAttachments(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - this.communityAttachmentRetentionMs);
    const candidates = await this.prisma.communityAttachment.findMany({
      where: { postId: null, createdAt: { lte: cutoff } },
      orderBy: { createdAt: "asc" },
      take: 20,
    });
    let scheduled = 0;
    for (const candidate of candidates) {
      const claimed = await this.prisma.$transaction(async (transaction) => {
        const deleted = await transaction.communityAttachment.deleteMany({
          where: { id: candidate.id, postId: null, createdAt: { lte: cutoff } },
        });
        if (deleted.count !== 1) return false;
        await transaction.objectDeletionJob.upsert({
          where: { objectKey: candidate.objectKey },
          create: {
            objectKey: candidate.objectKey,
            reason: "COMMUNITY_ATTACHMENT_UNATTACHED_EXPIRED",
            resourceType: "CommunityAttachment",
            resourceId: candidate.id,
            nextAttemptAt: now,
            requestedById: candidate.ownerUserId,
          },
          update: {
            reason: "COMMUNITY_ATTACHMENT_UNATTACHED_EXPIRED",
            resourceType: "CommunityAttachment",
            resourceId: candidate.id,
            status: ObjectDeletionJobStatus.PENDING,
            attempts: 0,
            nextAttemptAt: now,
            lockedAt: null,
            completedAt: null,
            lastError: null,
            requestedById: candidate.ownerUserId,
          },
        });
        await transaction.auditLog.create({
          data: {
            actorId: candidate.ownerUserId,
            action: "community.attachment.cleanup_scheduled",
            resourceType: "CommunityAttachment",
            resourceId: candidate.id,
            metadata: { reason: "unattached_expired", status: candidate.status.toLowerCase() },
          },
        });
        return true;
      });
      if (claimed) scheduled += 1;
    }
    return scheduled;
  }

  async scheduleAbandonedTeachingMaterialAssets(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - this.communityAttachmentRetentionMs);
    const candidates = await this.prisma.teachingMaterialAsset.findMany({
      where: {
        materialId: null,
        OR: [{ detachedAt: { lte: cutoff } }, { detachedAt: null, createdAt: { lte: cutoff } }],
      },
      orderBy: { createdAt: "asc" },
      take: 20,
    });
    let scheduled = 0;
    for (const candidate of candidates) {
      const claimed = await this.prisma.$transaction(async (transaction) => {
        const deleted = await transaction.teachingMaterialAsset.deleteMany({
          where: {
            id: candidate.id,
            materialId: null,
            OR: [{ detachedAt: { lte: cutoff } }, { detachedAt: null, createdAt: { lte: cutoff } }],
          },
        });
        if (deleted.count !== 1) return false;
        await transaction.objectDeletionJob.upsert({
          where: { objectKey: candidate.objectKey },
          create: {
            objectKey: candidate.objectKey,
            reason: "TEACHING_MATERIAL_ASSET_UNATTACHED_EXPIRED",
            resourceType: "TeachingMaterialAsset",
            resourceId: candidate.id,
            nextAttemptAt: now,
            requestedById: candidate.ownerUserId,
          },
          update: {
            reason: "TEACHING_MATERIAL_ASSET_UNATTACHED_EXPIRED",
            resourceType: "TeachingMaterialAsset",
            resourceId: candidate.id,
            status: ObjectDeletionJobStatus.PENDING,
            attempts: 0,
            nextAttemptAt: now,
            lockedAt: null,
            completedAt: null,
            lastError: null,
            requestedById: candidate.ownerUserId,
          },
        });
        await transaction.auditLog.create({
          data: {
            actorId: candidate.ownerUserId,
            action: "teaching_material.asset.cleanup_scheduled",
            resourceType: "TeachingMaterialAsset",
            resourceId: candidate.id,
            metadata: { reason: candidate.detachedAt ? "replaced_expired" : "unattached_expired", status: candidate.status.toLowerCase() },
          },
        });
        return true;
      });
      if (claimed) scheduled += 1;
    }
    return scheduled;
  }

  async scheduleAbandonedClassHelperAssets(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - this.communityAttachmentRetentionMs);
    const candidates = await this.prisma.classHelperAsset.findMany({
      where: {
        classHelperId: null,
        OR: [{ detachedAt: { lte: cutoff } }, { detachedAt: null, createdAt: { lte: cutoff } }],
      },
      orderBy: { createdAt: "asc" },
      take: 20,
    });
    let scheduled = 0;
    for (const candidate of candidates) {
      const claimed = await this.prisma.$transaction(async (transaction) => {
        const deleted = await transaction.classHelperAsset.deleteMany({
          where: {
            id: candidate.id,
            classHelperId: null,
            OR: [{ detachedAt: { lte: cutoff } }, { detachedAt: null, createdAt: { lte: cutoff } }],
          },
        });
        if (deleted.count !== 1) return false;
        await transaction.objectDeletionJob.upsert({
          where: { objectKey: candidate.objectKey },
          create: {
            objectKey: candidate.objectKey,
            reason: "CLASS_HELPER_ASSET_UNATTACHED_EXPIRED",
            resourceType: "ClassHelperAsset",
            resourceId: candidate.id,
            nextAttemptAt: now,
            requestedById: candidate.ownerUserId,
          },
          update: {
            reason: "CLASS_HELPER_ASSET_UNATTACHED_EXPIRED",
            resourceType: "ClassHelperAsset",
            resourceId: candidate.id,
            status: ObjectDeletionJobStatus.PENDING,
            attempts: 0,
            nextAttemptAt: now,
            lockedAt: null,
            completedAt: null,
            lastError: null,
            requestedById: candidate.ownerUserId,
          },
        });
        await transaction.auditLog.create({ data: {
          actorId: candidate.ownerUserId,
          action: "class_helper.asset.cleanup_scheduled",
          resourceType: "ClassHelperAsset",
          resourceId: candidate.id,
          metadata: { reason: candidate.detachedAt ? "replaced_expired" : "unattached_expired", status: candidate.status.toLowerCase() },
        } });
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
    const isInquiryAttachment = candidate.resourceType === "InquiryAttachment";
    const isCommunityAttachment = candidate.resourceType === "CommunityAttachment";
    const isTeachingMaterialAsset = candidate.resourceType === "TeachingMaterialAsset";
    const isClassHelperAsset = candidate.resourceType === "ClassHelperAsset";
    const isManagedAttachment = isInquiryAttachment || isCommunityAttachment || isTeachingMaterialAsset || isClassHelperAsset;
    const auditPrefix = isInquiryAttachment
      ? "inquiry.attachment"
      : isCommunityAttachment
        ? "community.attachment"
        : isTeachingMaterialAsset
          ? "teaching_material.asset"
          : isClassHelperAsset
            ? "class_helper.asset"
            : "lesson.video";
    try {
      const referenceCount = isInquiryAttachment
        ? await this.prisma.inquiryAttachment.count({ where: { objectKey: candidate.objectKey } })
        : isCommunityAttachment
          ? await this.prisma.communityAttachment.count({ where: { objectKey: candidate.objectKey } })
          : isTeachingMaterialAsset
            ? await this.prisma.teachingMaterialAsset.count({ where: { objectKey: candidate.objectKey } })
            : isClassHelperAsset
              ? await this.prisma.classHelperAsset.count({ where: { objectKey: candidate.objectKey } })
              : await this.prisma.lesson.count({ where: { videoAssetKey: candidate.objectKey } });
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
              action: `${auditPrefix}.cleanup_cancelled_referenced`,
              resourceType: candidate.resourceType,
              resourceId: candidate.resourceId,
              metadata: { objectKey: candidate.objectKey, reason: candidate.reason },
            },
          });
        });
        return true;
      }

      if (isInquiryAttachment) await this.storage.deleteInquiryAttachmentObject(candidate.objectKey);
      else if (isCommunityAttachment) await this.storage.deleteCommunityAttachmentObject(candidate.objectKey);
      else if (isTeachingMaterialAsset) await this.storage.deleteTeachingMaterialAssetObject(candidate.objectKey);
      else if (isClassHelperAsset) await this.storage.deleteClassHelperAssetObject(candidate.objectKey);
      else await this.storage.deleteVideoObject(candidate.objectKey);
      await this.prisma.$transaction(async (transaction) => {
        if (!isManagedAttachment) {
          await transaction.lessonVideoAsset.updateMany({
            where: {
              objectKey: candidate.objectKey,
              status: LessonVideoAssetStatus.READY,
            },
            data: { status: LessonVideoAssetStatus.PURGED },
          });
        }
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
            action: `${auditPrefix}.cleanup_completed`,
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
            action: `${auditPrefix}.cleanup_failed`,
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
      this.logger.warn(`Managed object cleanup failed: ${candidate.id} (${code}, attempt ${attempt})`);
    }
    return true;
  }
}
