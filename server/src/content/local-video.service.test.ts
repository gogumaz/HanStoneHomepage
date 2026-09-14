import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";

const roots: string[] = [];

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "hanstone-local-video-"));
  roots.push(root);
  return root;
}

async function service(root: string, maxBytes = 1024) {
  vi.resetModules();
  vi.stubEnv("DATABASE_URL", "postgresql://test:test@localhost/test");
  vi.stubEnv("MEDIA_DELIVERY_MODE", "local-download");
  vi.stubEnv("LOCAL_VIDEO_ROOT", root);
  vi.stubEnv("LOCAL_VIDEO_MAX_BYTES", String(maxBytes));
  const { LocalVideoService } = await import("./local-video.service.js");
  return new LocalVideoService();
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("LocalVideoService", () => {
  it("opens only the conventional lesson MP4 from the configured directory", async () => {
    const root = await createRoot();
    await writeFile(join(root, "LESSON-01.mp4"), Buffer.from("video-bytes"));
    const local = await service(root);

    await expect(local.verifyRoot()).resolves.toBeUndefined();
    await expect(local.hasVideo("LESSON-01")).resolves.toBe(true);
    const video = await local.openVideo("LESSON-01");
    expect(video).toMatchObject({ fileName: "LESSON-01.mp4", size: 11 });
    video.stream.destroy();
  });

  it("rejects traversal-shaped IDs, non-files, and oversized downloads", async () => {
    const root = await createRoot();
    await mkdir(join(root, "LESSON-01.mp4"));
    const local = await service(root, 4);

    await expect(local.hasVideo("../outside")).rejects.toMatchObject({ code: "INVALID_LESSON_ID" });
    await expect(local.hasVideo("LESSON-01")).resolves.toBe(false);
    await writeFile(join(root, "LESSON-02.mp4"), Buffer.from("large"));
    await expect(local.openVideo("LESSON-02")).rejects.toMatchObject({ code: "LOCAL_VIDEO_TOO_LARGE" });
  });
});
