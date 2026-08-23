import { beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaService } from "../database/prisma.service.js";
import { HlsTranscodeJobStatus } from "../generated/prisma/enums.js";
import { ObjectStorageService } from "../storage/object-storage.service.js";
import { HlsTranscoderService } from "./hls-transcoder.service.js";
import { HlsManifestService } from "./hls-manifest.service.js";
import { LessonHlsTranscodeWorkerService } from "./lesson-hls-transcode-worker.service.js";
import { LessonVideoService } from "./lesson-video.service.js";

type Value = Record<string, any>;

function harness(options: { currentKey?: string; transcodeError?: Error } = {}) {
  const job: Value = {
    id: "00000000-0000-0000-0000-000000000010",
    lessonId: "PRE-01",
    sourceAssetId: "00000000-0000-0000-0000-000000000020",
    sourceObjectKey: "lesson-videos/source.mp4",
    manifestKey: null,
    status: HlsTranscodeJobStatus.PENDING,
    attempts: 0,
    nextAttemptAt: new Date(Date.now() - 1000),
    lockedAt: null,
    completedAt: null,
    lastError: null,
    requestedById: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const lesson: Value = { videoAssetKey: options.currentKey ?? job.sourceObjectKey };
  const auditCreate = vi.fn(async () => ({ id: "audit-1" }));
  const deletionUpsert = vi.fn(async () => ({ id: "deletion-1" }));
  const prisma: Value = {
    hlsTranscodeJob: {
      findFirst: vi.fn(async () => ({ ...job })),
      updateMany: vi.fn(async ({ where, data }: Value) => {
        if (job.id !== where.id || job.status !== where.status || job.attempts !== where.attempts) return { count: 0 };
        Object.assign(job, data, { attempts: job.attempts + (data.attempts?.increment ?? 0) });
        return { count: 1 };
      }),
      update: vi.fn(async ({ data }: Value) => {
        Object.assign(job, data);
        return job;
      }),
    },
    lesson: {
      findUnique: vi.fn(async () => ({ ...lesson })),
      update: vi.fn(async ({ data }: Value) => {
        Object.assign(lesson, data);
        return lesson;
      }),
    },
    objectDeletionJob: { upsert: deletionUpsert },
    auditLog: { create: auditCreate },
    $transaction: vi.fn(async (callback: (transaction: Value) => unknown) => callback(prisma)),
  };
  const storage = {
    downloadVideoToFile: vi.fn(async () => undefined),
    uploadHlsPackage: vi.fn(async (_directory: string, prefix: string) => ({
      manifestKey: `${prefix}/master.m3u8`,
      fileCount: 12,
    })),
    deleteHlsPackage: vi.fn(async () => undefined),
  };
  const transcoder = {
    transcode: options.transcodeError
      ? vi.fn(async () => { throw options.transcodeError; })
      : vi.fn(async () => ({ renditionCount: 2 })),
  };
  const worker = new LessonHlsTranscodeWorkerService(
    prisma as PrismaService,
    storage as unknown as ObjectStorageService,
    transcoder as unknown as HlsTranscoderService,
  );
  return { worker, job, lesson, prisma, storage, transcoder, auditCreate, deletionUpsert };
}

describe("LessonHlsTranscodeWorkerService", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5432/test";
    process.env.HLS_TRANSCODE_MAX_ATTEMPTS = "3";
  });

  it("transcodes the current MP4, uploads HLS, and atomically attaches the manifest", async () => {
    const test = harness();

    await expect(test.worker.processNext()).resolves.toBe(true);

    expect(test.storage.downloadVideoToFile).toHaveBeenCalledWith(
      "lesson-videos/source.mp4",
      expect.stringMatching(/source\.mp4$/),
    );
    expect(test.storage.uploadHlsPackage).toHaveBeenCalledWith(
      expect.any(String),
      "lesson-hls/PRE-01/00000000-0000-0000-0000-000000000010",
    );
    expect(test.lesson.videoAssetKey).toBe(
      "lesson-hls/PRE-01/00000000-0000-0000-0000-000000000010/master.m3u8",
    );
    expect(test.job).toMatchObject({ status: HlsTranscodeJobStatus.READY, attempts: 1 });
    expect(test.deletionUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { objectKey: "lesson-videos/source.mp4" },
      create: expect.objectContaining({ reason: "LESSON_VIDEO_HLS_TRANSCODED" }),
    }));
    expect(test.auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "lesson.video.hls_transcode_completed" }),
    });
  });

  it("marks a job superseded before spending transcode resources", async () => {
    const test = harness({ currentKey: "lesson-videos/newer.mp4" });

    await test.worker.processNext();

    expect(test.job.status).toBe(HlsTranscodeJobStatus.SUPERSEDED);
    expect(test.transcoder.transcode).not.toHaveBeenCalled();
    expect(test.storage.uploadHlsPackage).not.toHaveBeenCalled();
  });

  it("records a bounded retry without exposing converter error details", async () => {
    const test = harness({ transcodeError: new Error("private path and command detail") });

    await test.worker.processNext();

    expect(test.job).toMatchObject({
      status: HlsTranscodeJobStatus.ERROR,
      attempts: 1,
      lastError: "Error",
    });
    expect(test.job.nextAttemptAt).toBeInstanceOf(Date);
    expect(JSON.stringify(test.auditCreate.mock.calls)).not.toContain("private path");
  });

  it("lets an operator retry a terminal HLS conversion error for the current source", async () => {
    const test = harness();
    test.job.status = HlsTranscodeJobStatus.ERROR;
    test.job.attempts = 3;
    test.job.lastError = "HLS_TRANSCODE_FAILED";
    const service = new LessonVideoService(
      test.prisma as PrismaService,
      test.storage as unknown as ObjectStorageService,
      {} as HlsManifestService,
    );

    const result = await service.retryHlsTranscode({
      id: "00000000-0000-0000-0000-000000000001",
      email: "operator@example.com",
      emailVerified: true,
      displayName: "운영자",
      roles: ["operator"],
    }, "PRE-01", test.job.sourceAssetId, "request-hls-retry");

    expect(result).toMatchObject({ status: "pending", attempts: 0, lastError: null });
    expect(test.auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "lesson.video.hls_transcode_retried" }),
    });
  });
});
