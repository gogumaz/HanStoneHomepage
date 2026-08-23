import { beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaService } from "../database/prisma.service.js";
import { LessonVideoAssetStatus } from "../generated/prisma/enums.js";
import { MalwareScannerService } from "../storage/malware-scanner.service.js";
import { ObjectStorageService } from "../storage/object-storage.service.js";
import { LessonVideoScanWorkerService } from "./lesson-video-scan-worker.service.js";
import { LessonVideoService } from "./lesson-video.service.js";
import { HlsManifestService } from "./hls-manifest.service.js";

type Value = Record<string, any>;

function harness(scanResult: unknown, scanError?: Error) {
  const asset: Value = {
    id: "video-asset-1",
    lessonId: "PRE-01",
    objectKey: "lesson-videos/video-1.mp4",
    originalName: "lesson.mp4",
    contentType: "video/mp4",
    expectedSize: 1024n,
    actualSize: 1024n,
    status: LessonVideoAssetStatus.QUARANTINED,
    scanProvider: null,
    scanResult: null,
    scannedAt: null,
    attachedAt: null,
    attempts: 0,
    nextAttemptAt: new Date(Date.now() - 1_000),
    lockedAt: null,
    lastError: null,
    previousAssetKey: "lesson-videos/previous.mp4",
    requestedById: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const lesson: Value = { id: "PRE-01", videoAssetKey: "lesson-videos/previous.mp4" };
  const auditCreate = vi.fn(async () => ({ id: "audit-1" }));
  const deletionUpsert = vi.fn(async () => ({ id: "deletion-1" }));
  const hlsUpsert = vi.fn(async () => ({ id: "hls-job-1" }));
  const prisma: Value = {
    lessonVideoAsset: {
      findFirst: vi.fn(async () => ({ ...asset })),
      findUnique: vi.fn(async ({ where }: Value) => where.objectKey === asset.objectKey ? asset : null),
      updateMany: vi.fn(async ({ where, data }: Value) => {
        if (asset.id !== where.id || asset.status !== where.status || asset.attempts !== where.attempts) return { count: 0 };
        const attempts = data.attempts?.increment ? asset.attempts + data.attempts.increment : asset.attempts;
        Object.assign(asset, data, {
          attempts,
        });
        return { count: 1 };
      }),
      update: vi.fn(async ({ data }: Value) => {
        Object.assign(asset, data);
        return asset;
      }),
    },
    lesson: {
      findUnique: vi.fn(async () => lesson),
      update: vi.fn(async ({ data }: Value) => {
        Object.assign(lesson, data);
        return lesson;
      }),
    },
    objectDeletionJob: { upsert: deletionUpsert },
    hlsTranscodeJob: { upsert: hlsUpsert },
    auditLog: { create: auditCreate },
    $transaction: vi.fn(async (callback: (transaction: Value) => unknown) => callback(prisma)),
  };
  const storage = {
    openVideoScanStream: vi.fn(async () => (async function* () {
      yield Uint8Array.from([0, 1, 2]);
    })()),
  };
  const scanner = {
    scanStream: scanError
      ? vi.fn(async () => { throw scanError; })
      : vi.fn(async () => scanResult),
  };
  const worker = new LessonVideoScanWorkerService(
    prisma as PrismaService,
    storage as unknown as ObjectStorageService,
    scanner as unknown as MalwareScannerService,
  );
  return { worker, asset, lesson, storage, scanner, auditCreate, deletionUpsert, hlsUpsert, prisma };
}

describe("LessonVideoScanWorkerService", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5432/test";
    process.env.VIDEO_SCAN_MAX_ATTEMPTS = "3";
  });

  it("streams a clean video and only then attaches it to the lesson", async () => {
    const test = harness({ clean: true, provider: "clamav", result: "OK" });

    await expect(test.worker.processNext()).resolves.toBe(true);

    expect(test.storage.openVideoScanStream).toHaveBeenCalledWith("lesson-videos/video-1.mp4");
    expect(test.scanner.scanStream).toHaveBeenCalledOnce();
    expect(test.asset).toMatchObject({
      status: LessonVideoAssetStatus.READY,
      scanProvider: "clamav",
      scanResult: "OK",
      attempts: 1,
    });
    expect(test.lesson.videoAssetKey).toBe("lesson-videos/video-1.mp4");
    expect(test.deletionUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { objectKey: "lesson-videos/previous.mp4" },
      create: expect.objectContaining({ reason: "LESSON_VIDEO_REPLACED" }),
    }));
    expect(test.hlsUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { sourceAssetId: "video-asset-1" },
      create: expect.objectContaining({ sourceObjectKey: "lesson-videos/video-1.mp4" }),
    }));
    expect(test.auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "lesson.video.scan_passed_attached" }),
    });
  });

  it("keeps an infected video detached and marks it rejected", async () => {
    const test = harness({ clean: false, provider: "clamav", result: "Eicar-Signature" });

    await test.worker.processNext();

    expect(test.asset).toMatchObject({
      status: LessonVideoAssetStatus.REJECTED,
      scanProvider: "clamav",
      scanResult: "Eicar-Signature",
    });
    expect(test.lesson.videoAssetKey).toBe("lesson-videos/previous.mp4");
  });

  it("records a scanner outage and schedules a bounded retry", async () => {
    const test = harness(null, new Error("scanner unavailable"));

    await test.worker.processNext();

    expect(test.asset.status).toBe(LessonVideoAssetStatus.ERROR);
    expect(test.asset.attempts).toBe(1);
    expect(test.asset.lastError).toBe("Error");
    expect(test.asset.nextAttemptAt).toBeInstanceOf(Date);
    expect(test.lesson.videoAssetKey).toBe("lesson-videos/previous.mp4");
  });

  it("lets an operator reset a failed job for an immediate retry", async () => {
    const test = harness(null, new Error("scanner unavailable"));
    test.asset.status = LessonVideoAssetStatus.ERROR;
    test.asset.attempts = 3;
    test.asset.lastError = "MALWARE_SCAN_FAILED";
    test.asset.nextAttemptAt = null;
    const service = new LessonVideoService(
      test.prisma as PrismaService,
      test.storage as unknown as ObjectStorageService,
      {} as HlsManifestService,
    );

    const result = await service.retryScan({
      id: "00000000-0000-0000-0000-000000000001",
      email: "operator@example.com",
      emailVerified: true,
      displayName: "운영자",
      roles: ["operator"],
    }, "PRE-01", test.asset.id, "request-retry");

    expect(result).toMatchObject({ status: "quarantined", attempts: 0, lastError: null });
    expect(test.auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "lesson.video.scan_retried" }),
    });
  });
});
