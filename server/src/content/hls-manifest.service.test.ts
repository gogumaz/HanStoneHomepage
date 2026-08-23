import { describe, expect, it, vi } from "vitest";
import { ObjectStorageService } from "../storage/object-storage.service.js";
import { MediaDeliveryService } from "../storage/media-delivery.service.js";
import { HlsManifestService } from "./hls-manifest.service.js";

function harness(manifests: Record<string, string>) {
  const signHlsAssetUrl = vi.fn(async (key: string) => ({
    url: `https://storage.example.test/${key}?signed=1`,
    expiresAt: new Date(Date.now() + 300_000),
  }));
  const storage = {
    readHlsManifest: vi.fn(async (key: string) => {
      const manifest = manifests[key];
      if (manifest === undefined) throw new Error("missing manifest");
      return manifest;
    }),
  } as unknown as ObjectStorageService;
  const delivery = { signHlsAssetUrl } as unknown as MediaDeliveryService;
  return { service: new HlsManifestService(storage, delivery), signHlsAssetUrl };
}

describe("HlsManifestService", () => {
  it("proxies nested playlists and signs media, map, key, and subtitle objects", async () => {
    const masterKey = "lesson-hls/PRE-01/version-1/master.m3u8";
    const { service, signHlsAssetUrl } = harness({
      [masterKey]: [
        "#EXTM3U",
        '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",URI="subtitles/ko.m3u8"',
        "#EXT-X-STREAM-INF:BANDWIDTH=800000,SUBTITLES=\"subs\"",
        "720p/index.m3u8",
      ].join("\n"),
      "lesson-hls/PRE-01/version-1/720p/index.m3u8": [
        "#EXTM3U",
        '#EXT-X-KEY:METHOD=AES-128,URI="../keys/video.key"',
        '#EXT-X-MAP:URI="init.mp4"',
        "#EXTINF:6,",
        "segment-001.m4s",
        "#EXT-X-ENDLIST",
      ].join("\n"),
    });

    const master = await service.render("PRE-01", masterKey);
    expect(master).toContain("/api/v1/lessons/PRE-01/hls-manifest?path=subtitles%2Fko.m3u8");
    expect(master).toContain("/api/v1/lessons/PRE-01/hls-manifest?path=720p%2Findex.m3u8");

    const media = await service.render("PRE-01", masterKey, "720p/index.m3u8");
    expect(media).toContain("https://storage.example.test/lesson-hls/PRE-01/version-1/keys/video.key?signed=1");
    expect(media).toContain("https://storage.example.test/lesson-hls/PRE-01/version-1/720p/init.mp4?signed=1");
    expect(media).toContain("https://storage.example.test/lesson-hls/PRE-01/version-1/720p/segment-001.m4s?signed=1");
    expect(signHlsAssetUrl).toHaveBeenCalledTimes(3);
  });

  it("rejects external, absolute, and package-escaping references", async () => {
    const masterKey = "lesson-hls/PRE-01/version-1/master.m3u8";
    for (const reference of ["https://evil.example/video.ts", "/private/video.ts", "../../outside.ts"]) {
      const { service } = harness({ [masterKey]: `#EXTM3U\n#EXTINF:6,\n${reference}` });
      await expect(service.render("PRE-01", masterKey)).rejects.toMatchObject({ code: "HLS_MANIFEST_INVALID" });
    }
  });

  it("requires a lesson-scoped HLS master key and the EXTM3U signature", async () => {
    const wrongLesson = "lesson-hls/OTHER/version-1/master.m3u8";
    const { service } = harness({ [wrongLesson]: "#EXTM3U" });
    await expect(service.render("PRE-01", wrongLesson)).rejects.toMatchObject({ code: "HLS_MANIFEST_INVALID" });

    const masterKey = "lesson-hls/PRE-01/version-1/master.m3u8";
    const invalid = harness({ [masterKey]: "not a playlist" });
    await expect(invalid.service.render("PRE-01", masterKey)).rejects.toMatchObject({ code: "HLS_MANIFEST_INVALID" });
  });
});
