import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LessonStatus } from "../generated/prisma/enums.js";
import type { PrismaService } from "../database/prisma.service.js";
import type { MediaDeliveryService } from "../storage/media-delivery.service.js";
import type { HlsManifestService } from "./hls-manifest.service.js";

const roots: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("LessonAccessService local download mode", () => {
  it("keeps access checks and returns an authenticated full-download endpoint", async () => {
    const root = await mkdtemp(join(tmpdir(), "hanstone-access-video-"));
    roots.push(root);
    await writeFile(join(root, "FREE-01.mp4"), Buffer.from("video-bytes"));
    vi.stubEnv("DATABASE_URL", "postgresql://test:test@localhost/test");
    vi.stubEnv("MEDIA_DELIVERY_MODE", "local-download");
    vi.stubEnv("LOCAL_VIDEO_ROOT", root);
    vi.resetModules();
    const [{ LocalVideoService }, { LessonAccessService }] = await Promise.all([
      import("./local-video.service.js"),
      import("./lesson-access.service.js"),
    ]);
    const prisma = {
      lesson: {
        findFirst: vi.fn(async () => ({
          id: "FREE-01",
          status: LessonStatus.PUBLISHED,
          isFreeSample: true,
          videoAssetKey: null,
        })),
      },
      accountSubscription: { findFirst: vi.fn(async () => null) },
    } as unknown as PrismaService;
    const delivery = { isConfigured: vi.fn(() => false) } as unknown as MediaDeliveryService;
    const hls = {} as HlsManifestService;
    const access = new LessonAccessService(prisma, delivery, hls, new LocalVideoService());

    await expect(access.getPlayback("FREE-01")).resolves.toMatchObject({
      access: { source: "free_sample" },
      playback: {
        status: "ready",
        format: "mp4",
        delivery: "local-download",
        url: "/api/v1/lessons/FREE-01/video-download",
        expiresAt: null,
      },
    });
    const video = await access.downloadLocalVideo("FREE-01");
    expect(video).toMatchObject({ fileName: "FREE-01.mp4", size: 11 });
    video.stream.destroy();
    expect(delivery.isConfigured).not.toHaveBeenCalled();
  }, 15_000);
});
