import { beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaService } from "../database/prisma.service.js";
import { LessonVideoAssetStatus, ObjectDeletionJobStatus } from "../generated/prisma/enums.js";
import { ObjectStorageService } from "../storage/object-storage.service.js";
import { LessonVideoCleanupWorkerService } from "./lesson-video-cleanup-worker.service.js";

type Value = Record<string, any>;

function deletionHarness(options: { referenced?: boolean; deleteError?: Error; inquiryAttachment?: boolean } = {}) {
  const inquiryAttachment = options.inquiryAttachment === true;
  const job: Value = {
    id: "deletion-1",
    objectKey: inquiryAttachment
      ? "inquiry-attachments/00000000-0000-4000-8000-000000000701/source.pdf"
      : "lesson-videos/old.mp4",
    reason: inquiryAttachment ? "INQUIRY_ATTACHMENT_UNATTACHED_EXPIRED" : "LESSON_VIDEO_REPLACED",
    resourceType: inquiryAttachment ? "InquiryAttachment" : "Lesson",
    resourceId: inquiryAttachment ? "00000000-0000-4000-8000-000000000701" : "PRE-01",
    status: ObjectDeletionJobStatus.PENDING,
    attempts: 0,
    nextAttemptAt: new Date(Date.now() - 1_000),
    lockedAt: null,
    completedAt: null,
    lastError: null,
    requestedById: null,
    createdAt: new Date(Date.now() - 2_000),
  };
  const auditCreate = vi.fn(async () => ({ id: "audit-1" }));
  const prisma: Value = {
    lessonVideoAsset: {
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    objectDeletionJob: {
      findFirst: vi.fn(async () => ({ ...job })),
      updateMany: vi.fn(async ({ where, data }: Value) => {
        if (job.id !== where.id || job.status !== where.status || job.attempts !== where.attempts) {
          return { count: 0 };
        }
        Object.assign(job, data, {
          attempts: data.attempts?.increment ? job.attempts + data.attempts.increment : job.attempts,
        });
        return { count: 1 };
      }),
      update: vi.fn(async ({ data }: Value) => {
        Object.assign(job, data);
        return job;
      }),
    },
    lesson: { count: vi.fn(async () => options.referenced ? 1 : 0) },
    inquiryAttachment: { count: vi.fn(async () => options.referenced ? 1 : 0) },
    auditLog: { create: auditCreate },
    $transaction: vi.fn(async (callback: (transaction: Value) => unknown) => callback(prisma)),
  };
  const storage = {
    deleteVideoObject: options.deleteError
      ? vi.fn(async () => { throw options.deleteError; })
      : vi.fn(async () => undefined),
    deleteInquiryAttachmentObject: options.deleteError
      ? vi.fn(async () => { throw options.deleteError; })
      : vi.fn(async () => undefined),
  };
  const worker = new LessonVideoCleanupWorkerService(
    prisma as PrismaService,
    storage as unknown as ObjectStorageService,
  );
  return { worker, job, prisma, storage, auditCreate };
}

describe("LessonVideoCleanupWorkerService", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5432/test";
    process.env.VIDEO_CLEANUP_MAX_ATTEMPTS = "5";
    process.env.VIDEO_UPLOAD_ABANDONED_AFTER_HOURS = "24";
    process.env.INQUIRY_ATTACHMENT_RETENTION_HOURS = "24";
    process.env.COMMUNITY_ATTACHMENT_RETENTION_HOURS = "24";
  });

  it("atomically purges and schedules uploads abandoned for a day", async () => {
    const now = new Date("2026-08-23T12:00:00.000Z");
    const asset: Value = {
      id: "video-asset-1",
      lessonId: "PRE-01",
      objectKey: "lesson-videos/abandoned.mp4",
      status: LessonVideoAssetStatus.UPLOADING,
      requestedById: null,
      createdAt: new Date("2026-08-22T11:59:59.000Z"),
    };
    const deletionUpsert = vi.fn(async () => ({ id: "deletion-1" }));
    const auditCreate = vi.fn(async () => ({ id: "audit-1" }));
    const prisma: Value = {
      lessonVideoAsset: {
        findMany: vi.fn(async () => [{ ...asset }]),
        updateMany: vi.fn(async ({ data }: Value) => {
          if (asset.status !== LessonVideoAssetStatus.UPLOADING) return { count: 0 };
          Object.assign(asset, data);
          return { count: 1 };
        }),
      },
      objectDeletionJob: { upsert: deletionUpsert },
      auditLog: { create: auditCreate },
      $transaction: vi.fn(async (callback: (transaction: Value) => unknown) => callback(prisma)),
    };
    const worker = new LessonVideoCleanupWorkerService(
      prisma as PrismaService,
      { deleteVideoObject: vi.fn() } as unknown as ObjectStorageService,
    );

    await expect(worker.scheduleAbandonedUploads(now)).resolves.toBe(1);

    expect(asset).toMatchObject({
      status: LessonVideoAssetStatus.PURGED,
      lastError: "UPLOAD_ABANDONED",
    });
    expect(deletionUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { objectKey: "lesson-videos/abandoned.mp4" },
      create: expect.objectContaining({
        reason: "LESSON_VIDEO_UPLOAD_ABANDONED",
        nextAttemptAt: now,
      }),
    }));
  });

  it("deletes an unreferenced object and completes the durable job", async () => {
    const test = deletionHarness();

    await expect(test.worker.processNextDeletion()).resolves.toBe(true);

    expect(test.storage.deleteVideoObject).toHaveBeenCalledWith("lesson-videos/old.mp4");
    expect(test.prisma.lessonVideoAsset.updateMany).toHaveBeenCalledWith({
      where: {
        objectKey: "lesson-videos/old.mp4",
        status: LessonVideoAssetStatus.READY,
      },
      data: { status: LessonVideoAssetStatus.PURGED },
    });
    expect(test.job).toMatchObject({
      status: ObjectDeletionJobStatus.COMPLETED,
      attempts: 1,
      lockedAt: null,
      lastError: null,
    });
    expect(test.auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "lesson.video.cleanup_completed" }),
    });
  });

  it("atomically removes an unattached inquiry record and schedules its object after retention", async () => {
    const now = new Date("2026-08-24T12:00:00.000Z");
    const candidate: Value = {
      id: "00000000-0000-4000-8000-000000000701",
      ownerUserId: "00000000-0000-4000-8000-000000000401",
      inquiryId: null,
      objectKey: "inquiry-attachments/00000000-0000-4000-8000-000000000701/source.pdf",
      status: "READY",
      createdAt: new Date("2026-08-23T11:59:59.000Z"),
    };
    const deletionUpsert = vi.fn(async () => ({ id: "deletion-inquiry" }));
    const auditCreate = vi.fn(async () => ({ id: "audit-inquiry" }));
    const prisma: Value = {
      inquiryAttachment: {
        findMany: vi.fn(async () => [candidate]),
        deleteMany: vi.fn(async () => ({ count: candidate.inquiryId === null ? 1 : 0 })),
      },
      objectDeletionJob: { upsert: deletionUpsert },
      auditLog: { create: auditCreate },
      $transaction: vi.fn(async (callback: (transaction: Value) => unknown) => callback(prisma)),
    };
    const worker = new LessonVideoCleanupWorkerService(
      prisma as PrismaService,
      { deleteVideoObject: vi.fn(), deleteInquiryAttachmentObject: vi.fn() } as unknown as ObjectStorageService,
    );

    await expect(worker.scheduleAbandonedInquiryAttachments(now)).resolves.toBe(1);

    expect(prisma.inquiryAttachment.findMany).toHaveBeenCalledWith({
      where: { inquiryId: null, createdAt: { lte: new Date("2026-08-23T12:00:00.000Z") } },
      orderBy: { createdAt: "asc" },
      take: 20,
    });
    expect(deletionUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { objectKey: candidate.objectKey },
      create: expect.objectContaining({
        reason: "INQUIRY_ATTACHMENT_UNATTACHED_EXPIRED",
        resourceType: "InquiryAttachment",
        requestedById: candidate.ownerUserId,
      }),
    }));
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "inquiry.attachment.cleanup_scheduled" }),
    });
  });

  it("deletes an expired inquiry attachment object with the durable deletion worker", async () => {
    const test = deletionHarness({ inquiryAttachment: true });

    await expect(test.worker.processNextDeletion()).resolves.toBe(true);

    expect(test.storage.deleteInquiryAttachmentObject).toHaveBeenCalledWith(test.job.objectKey);
    expect(test.storage.deleteVideoObject).not.toHaveBeenCalled();
    expect(test.prisma.lessonVideoAsset.updateMany).not.toHaveBeenCalled();
    expect(test.job.status).toBe(ObjectDeletionJobStatus.COMPLETED);
    expect(test.auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "inquiry.attachment.cleanup_completed" }),
    });
  });

  it("removes an unattached community record and schedules private object cleanup", async () => {
    const now = new Date("2026-08-24T12:00:00.000Z");
    const candidate: Value = {
      id: "00000000-0000-4000-8000-000000000702",
      ownerUserId: "00000000-0000-4000-8000-000000000402",
      postId: null,
      objectKey: "community-attachments/00000000-0000-4000-8000-000000000702/source.pdf",
      status: "READY",
      createdAt: new Date("2026-08-23T11:59:59.000Z"),
    };
    const deletionUpsert = vi.fn(async () => ({ id: "deletion-community" }));
    const auditCreate = vi.fn(async () => ({ id: "audit-community" }));
    const prisma: Value = {
      communityAttachment: {
        findMany: vi.fn(async () => [candidate]),
        deleteMany: vi.fn(async () => ({ count: candidate.postId === null ? 1 : 0 })),
      },
      objectDeletionJob: { upsert: deletionUpsert },
      auditLog: { create: auditCreate },
      $transaction: vi.fn(async (callback: (transaction: Value) => unknown) => callback(prisma)),
    };
    const worker = new LessonVideoCleanupWorkerService(
      prisma as PrismaService,
      { deleteCommunityAttachmentObject: vi.fn() } as unknown as ObjectStorageService,
    );

    await expect(worker.scheduleAbandonedCommunityAttachments(now)).resolves.toBe(1);
    expect(deletionUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        reason: "COMMUNITY_ATTACHMENT_UNATTACHED_EXPIRED",
        resourceType: "CommunityAttachment",
        requestedById: candidate.ownerUserId,
      }),
    }));
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "community.attachment.cleanup_scheduled" }),
    });
  });

  it("cancels deletion when the object became current again", async () => {
    const test = deletionHarness({ referenced: true });

    await test.worker.processNextDeletion();

    expect(test.storage.deleteVideoObject).not.toHaveBeenCalled();
    expect(test.job.status).toBe(ObjectDeletionJobStatus.CANCELLED);
    expect(test.auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "lesson.video.cleanup_cancelled_referenced" }),
    });
  });

  it("records storage failures and schedules a bounded retry", async () => {
    const test = deletionHarness({ deleteError: new Error("storage unavailable") });

    await test.worker.processNextDeletion();

    expect(test.job).toMatchObject({
      status: ObjectDeletionJobStatus.ERROR,
      attempts: 1,
      lastError: "Error",
      lockedAt: null,
    });
    expect(test.job.nextAttemptAt).toBeInstanceOf(Date);
    expect(test.auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "lesson.video.cleanup_failed",
        metadata: expect.objectContaining({ retry: true }),
      }),
    });
  });
});
