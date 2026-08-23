import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApiError } from "../common/api-error.js";
import { ObjectStorageService } from "./object-storage.service.js";

const STORAGE_KEYS = [
  "DATABASE_URL",
  "OBJECT_STORAGE_ENDPOINT",
  "OBJECT_STORAGE_REGION",
  "OBJECT_STORAGE_BUCKET",
  "OBJECT_STORAGE_ACCESS_KEY_ID",
  "OBJECT_STORAGE_SECRET_ACCESS_KEY",
  "OBJECT_STORAGE_FORCE_PATH_STYLE",
  "PLAYBACK_URL_TTL_SECONDS",
  "VIDEO_UPLOAD_URL_TTL_SECONDS",
  "VIDEO_UPLOAD_MAX_BYTES",
] as const;

describe("ObjectStorageService", () => {
  const original = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const key of STORAGE_KEYS) {
      original.set(key, process.env[key]);
      delete process.env[key];
    }
    process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5432/test";
  });

  afterEach(() => {
    for (const key of STORAGE_KEYS) {
      const value = original.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("keeps playback signing disabled when no private bucket is configured", async () => {
    const storage = new ObjectStorageService();
    expect(storage.isConfigured()).toBe(false);
    await expect(storage.signPlaybackUrl("lessons/PRE-01/video.mp4")).rejects.toMatchObject({
      code: "OBJECT_STORAGE_NOT_CONFIGURED",
    } satisfies Partial<ApiError>);
  });

  it("creates a short-lived Signature V4 URL without a network request", async () => {
    process.env.OBJECT_STORAGE_ENDPOINT = "https://storage.example.test";
    process.env.OBJECT_STORAGE_REGION = "ap-northeast-2";
    process.env.OBJECT_STORAGE_BUCKET = "private-media";
    process.env.OBJECT_STORAGE_ACCESS_KEY_ID = "test-access-key";
    process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY = "test-secret-key";
    process.env.OBJECT_STORAGE_FORCE_PATH_STYLE = "true";
    process.env.PLAYBACK_URL_TTL_SECONDS = "120";
    const before = Date.now();

    const signed = await new ObjectStorageService().signPlaybackUrl(
      "lessons/PRE-01/video.mp4",
    );
    const url = new URL(signed.url);
    expect(url.origin).toBe("https://storage.example.test");
    expect(url.pathname).toBe("/private-media/lessons/PRE-01/video.mp4");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("120");
    expect(url.searchParams.get("X-Amz-Signature")).toBeTruthy();
    expect(signed.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 119_000);
    expect(signed.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 121_000);
  });

  it("reads a bounded HLS manifest and signs only package-scoped media objects", async () => {
    process.env.OBJECT_STORAGE_ENDPOINT = "https://storage.example.test";
    process.env.OBJECT_STORAGE_BUCKET = "private-media";
    process.env.OBJECT_STORAGE_ACCESS_KEY_ID = "test-access-key";
    process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY = "test-secret-key";
    process.env.OBJECT_STORAGE_FORCE_PATH_STYLE = "true";
    const readStorage = new ObjectStorageService();
    const manifest = Buffer.from("#EXTM3U\n#EXTINF:6,\nsegment-001.m4s");
    const send = vi.fn()
      .mockResolvedValueOnce({ ContentType: "application/vnd.apple.mpegurl", ContentLength: manifest.length })
      .mockResolvedValueOnce({ Body: { transformToByteArray: async () => manifest } });
    Object.assign(readStorage as object, { client: { send } });

    await expect(readStorage.readHlsManifest("lesson-hls/PRE-01/v1/master.m3u8"))
      .resolves.toContain("#EXTM3U");
    const storage = new ObjectStorageService();
    const signed = await storage.signHlsAssetUrl("lesson-hls/PRE-01/v1/segment-001.m4s");
    expect(new URL(signed.url).pathname).toBe("/private-media/lesson-hls/PRE-01/v1/segment-001.m4s");
    await expect(storage.signHlsAssetUrl("lesson-hls/PRE-01/v1/child.m3u8")).rejects.toMatchObject({
      code: "INVALID_HLS_ASSET",
    } satisfies Partial<ApiError>);
    await expect(storage.signHlsAssetUrl("lesson-hls/../secret.ts")).rejects.toMatchObject({
      code: "INVALID_VIDEO_ASSET",
    } satisfies Partial<ApiError>);
  });

  it("signs lesson assets with inline or attachment response headers", async () => {
    process.env.OBJECT_STORAGE_ENDPOINT = "https://storage.example.test";
    process.env.OBJECT_STORAGE_REGION = "ap-northeast-2";
    process.env.OBJECT_STORAGE_BUCKET = "private-media";
    process.env.OBJECT_STORAGE_ACCESS_KEY_ID = "test-access-key";
    process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY = "test-secret-key";
    process.env.OBJECT_STORAGE_FORCE_PATH_STYLE = "true";
    process.env.PLAYBACK_URL_TTL_SECONDS = "120";

    const storage = new ObjectStorageService();
    const material = await storage.signAssetUrl("lesson-assets/material/source.pdf", {
      contentType: "application/pdf",
      fileName: "활동지\r\n.pdf",
      inline: false,
    });
    const materialUrl = new URL(material.url);
    expect(materialUrl.searchParams.get("response-content-type")).toBe("application/pdf");
    expect(materialUrl.searchParams.get("response-cache-control")).toBe("private, no-store");
    expect(materialUrl.searchParams.get("response-content-disposition")).toContain("attachment;");
    expect(materialUrl.searchParams.get("response-content-disposition")).not.toContain("\r");
    expect(materialUrl.searchParams.get("response-content-disposition")).not.toContain("\n");
    expect(materialUrl.searchParams.get("X-Amz-Expires")).toBe("120");

    const thumbnail = await storage.signAssetUrl("lesson-assets/thumbnail/source.webp", {
      contentType: "image/webp",
      fileName: "대표.webp",
      inline: true,
    });
    expect(new URL(thumbnail.url).searchParams.get("response-content-disposition")).toContain("inline;");
  });

  it("rejects traversal and URL-like asset keys before signing", async () => {
    process.env.OBJECT_STORAGE_BUCKET = "private-media";
    process.env.OBJECT_STORAGE_ACCESS_KEY_ID = "test-access-key";
    process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY = "test-secret-key";
    const storage = new ObjectStorageService();

    await expect(storage.signPlaybackUrl("../secret/video.mp4")).rejects.toMatchObject({
      code: "INVALID_VIDEO_ASSET",
    } satisfies Partial<ApiError>);
    await expect(storage.signPlaybackUrl("https://example.test/video.mp4")).rejects.toMatchObject({
      code: "INVALID_VIDEO_ASSET",
    } satisfies Partial<ApiError>);
  });

  it("rejects partial credentials and playback URLs longer than fifteen minutes", () => {
    process.env.OBJECT_STORAGE_BUCKET = "private-media";
    process.env.OBJECT_STORAGE_ACCESS_KEY_ID = "test-access-key";
    expect(() => new ObjectStorageService()).toThrow(
      "객체 저장소 Access Key와 Secret Key는 함께 설정해야 합니다.",
    );

    process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY = "test-secret-key";
    process.env.PLAYBACK_URL_TTL_SECONDS = "901";
    expect(() => new ObjectStorageService()).toThrow(
      "PLAYBACK_URL_TTL_SECONDS는 900초 이하여야 합니다.",
    );
  });

  it("creates a constrained presigned POST for an MP4 upload", async () => {
    process.env.OBJECT_STORAGE_ENDPOINT = "https://storage.example.test";
    process.env.OBJECT_STORAGE_BUCKET = "private-media";
    process.env.OBJECT_STORAGE_ACCESS_KEY_ID = "test-access-key";
    process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY = "test-secret-key";
    process.env.OBJECT_STORAGE_FORCE_PATH_STYLE = "true";
    process.env.VIDEO_UPLOAD_URL_TTL_SECONDS = "180";
    process.env.VIDEO_UPLOAD_MAX_BYTES = "10485760";

    const upload = await new ObjectStorageService().createVideoUpload("PRE-01", 4096);
    expect(upload.method).toBe("POST");
    expect(upload.url).toBe("https://storage.example.test/private-media");
    expect(upload.assetKey).toMatch(/^lesson-videos\/[0-9a-f-]+\.mp4$/);
    expect(upload.fields).toMatchObject({
      key: upload.assetKey,
      "Content-Type": "video/mp4",
      "x-amz-meta-lesson-id": "PRE-01",
      "x-amz-meta-expected-size": "4096",
    });
    const encodedPolicy = upload.fields.Policy ?? upload.fields.policy;
    expect(encodedPolicy).toBeTruthy();
    if (!encodedPolicy) throw new Error("presigned POST policy is missing");
    const policy = JSON.parse(Buffer.from(encodedPolicy, "base64").toString("utf8")) as {
      conditions: unknown[];
    };
    expect(policy.conditions).toContainEqual(["content-length-range", 1, 10485760]);
    expect(policy.conditions).toContainEqual(["eq", "$Content-Type", "video/mp4"]);
  });

  it("verifies object metadata and the MP4 ftyp signature before attachment", async () => {
    process.env.OBJECT_STORAGE_BUCKET = "private-media";
    process.env.OBJECT_STORAGE_ACCESS_KEY_ID = "test-access-key";
    process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY = "test-secret-key";
    const storage = new ObjectStorageService();
    const send = vi.fn()
      .mockResolvedValueOnce({
        ContentType: "video/mp4",
        ContentLength: 12,
        Metadata: { "lesson-id": "PRE-01", "expected-size": "12" },
      })
      .mockResolvedValueOnce({
        Body: { transformToByteArray: async () => Uint8Array.from([0, 0, 0, 12, 102, 116, 121, 112, 105, 115, 111, 109]) },
      });
    Object.assign(storage as object, { client: { send } });

    await expect(storage.inspectVideoUpload("lesson-videos/test.mp4", "PRE-01")).resolves.toEqual({
      assetKey: "lesson-videos/test.mp4",
      contentType: "video/mp4",
      size: 12,
    });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("rejects a file whose bytes are not an MP4 signature", async () => {
    process.env.OBJECT_STORAGE_BUCKET = "private-media";
    process.env.OBJECT_STORAGE_ACCESS_KEY_ID = "test-access-key";
    process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY = "test-secret-key";
    const storage = new ObjectStorageService();
    const send = vi.fn()
      .mockResolvedValueOnce({
        ContentType: "video/mp4",
        ContentLength: 12,
        Metadata: { "lesson-id": "PRE-01", "expected-size": "12" },
      })
      .mockResolvedValueOnce({
        Body: { transformToByteArray: async () => Uint8Array.from([0, 0, 0, 12, 110, 111, 116, 33, 0, 0, 0, 0]) },
      });
    Object.assign(storage as object, { client: { send } });

    await expect(storage.inspectVideoUpload("lesson-videos/test.mp4", "PRE-01")).rejects.toMatchObject({
      code: "VIDEO_FILE_SIGNATURE_INVALID",
    } satisfies Partial<ApiError>);
  });

  it("opens an MP4 as an async stream without buffering the full object", async () => {
    process.env.OBJECT_STORAGE_BUCKET = "private-media";
    process.env.OBJECT_STORAGE_ACCESS_KEY_ID = "test-access-key";
    process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY = "test-secret-key";
    const storage = new ObjectStorageService();
    const body = (async function* () {
      yield Uint8Array.from([1, 2]);
      yield Uint8Array.from([3, 4]);
    })();
    const send = vi.fn().mockResolvedValue({ Body: body });
    Object.assign(storage as object, { client: { send } });

    const stream = await storage.openVideoScanStream("lesson-videos/test.mp4");
    const chunks: number[][] = [];
    for await (const chunk of stream) chunks.push([...chunk]);

    expect(chunks).toEqual([[1, 2], [3, 4]]);
    expect(send).toHaveBeenCalledOnce();
  });

  it("deletes only validated private MP4 object keys", async () => {
    process.env.OBJECT_STORAGE_BUCKET = "private-media";
    process.env.OBJECT_STORAGE_ACCESS_KEY_ID = "test-access-key";
    process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY = "test-secret-key";
    const storage = new ObjectStorageService();
    const send = vi.fn().mockResolvedValue({});
    Object.assign(storage as object, { client: { send } });

    await expect(storage.deleteVideoObject("lesson-videos/old.mp4")).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]?.[0]?.input).toEqual({
      Bucket: "private-media",
      Key: "lesson-videos/old.mp4",
    });
    await expect(storage.deleteVideoObject("lesson-assets/old.pdf")).rejects.toMatchObject({
      code: "INVALID_VIDEO_ASSET",
    } satisfies Partial<ApiError>);
    expect(send).toHaveBeenCalledOnce();
  });

  it("verifies write, read, and delete access with a temporary private object", async () => {
    process.env.OBJECT_STORAGE_BUCKET = "private-media";
    process.env.OBJECT_STORAGE_ACCESS_KEY_ID = "test-access-key";
    process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY = "test-secret-key";
    const storage = new ObjectStorageService();
    const probe = Uint8Array.from([98, 97, 100, 117, 107, 45, 112, 114, 101, 102, 108, 105, 103, 104, 116]);
    const send = vi.fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ Body: { transformToByteArray: async () => probe } })
      .mockResolvedValueOnce({});
    Object.assign(storage as object, { client: { send } });

    await expect(storage.verifyVideoStorageAccess()).resolves.toBeUndefined();

    expect(send).toHaveBeenCalledTimes(3);
    expect(send.mock.calls.map(([command]) => command.constructor.name)).toEqual([
      "PutObjectCommand",
      "GetObjectCommand",
      "DeleteObjectCommand",
    ]);
    const keys = send.mock.calls.map(([command]) => command.input.Key);
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toMatch(/^lesson-videos\/preflight\/[0-9a-f-]+\.mp4$/);
  });

  it("attempts to delete the temporary object when the preflight read is invalid", async () => {
    process.env.OBJECT_STORAGE_BUCKET = "private-media";
    process.env.OBJECT_STORAGE_ACCESS_KEY_ID = "test-access-key";
    process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY = "test-secret-key";
    const storage = new ObjectStorageService();
    const send = vi.fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ Body: { transformToByteArray: async () => Uint8Array.from([0]) } })
      .mockResolvedValueOnce({});
    Object.assign(storage as object, { client: { send } });

    await expect(storage.verifyVideoStorageAccess()).rejects.toMatchObject({
      code: "OBJECT_STORAGE_PREFLIGHT_FAILED",
    } satisfies Partial<ApiError>);
    expect(send.mock.calls.map(([command]) => command.constructor.name)).toEqual([
      "PutObjectCommand",
      "GetObjectCommand",
      "DeleteObjectCommand",
    ]);
  });

  it("verifies a temporary object through a CDN signed URL and always deletes it", async () => {
    process.env.OBJECT_STORAGE_BUCKET = "private-media";
    process.env.OBJECT_STORAGE_ACCESS_KEY_ID = "test-access-key";
    process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY = "test-secret-key";
    const storage = new ObjectStorageService();
    let probe = Buffer.alloc(0);
    const send = vi.fn(async (command: { constructor: { name: string }; input: { Body?: Uint8Array } }) => {
      if (command.constructor.name === "PutObjectCommand") probe = Buffer.from(command.input.Body ?? []);
      return {};
    });
    Object.assign(storage as object, { client: { send } });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(probe, { status: 200 }));
    const signUrl = vi.fn(async () => ({ url: "https://media.example.test/probe?signed=1" }));

    await expect(storage.verifyCdnDelivery(signUrl)).resolves.toBeUndefined();

    expect(send.mock.calls.map(([command]) => command.constructor.name)).toEqual([
      "PutObjectCommand",
      "DeleteObjectCommand",
    ]);
    expect(signUrl).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://media.example.test/probe?signed=1",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    fetchMock.mockRestore();
  });

  it("deletes the CDN probe even when the signed fetch fails", async () => {
    process.env.OBJECT_STORAGE_BUCKET = "private-media";
    process.env.OBJECT_STORAGE_ACCESS_KEY_ID = "test-access-key";
    process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY = "test-secret-key";
    const storage = new ObjectStorageService();
    const send = vi.fn(async (_command: { constructor: { name: string } }) => ({}));
    Object.assign(storage as object, { client: { send } });
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("denied", { status: 403 }));

    await expect(storage.verifyCdnDelivery(async () => ({ url: "https://media.example.test/denied" })))
      .rejects.toMatchObject({ code: "CDN_PREFLIGHT_FAILED" } satisfies Partial<ApiError>);

    expect(send.mock.calls.map(([command]) => command.constructor.name)).toEqual([
      "PutObjectCommand",
      "DeleteObjectCommand",
    ]);
    fetchMock.mockRestore();
  });

  it("uploads a complete versioned HLS package with cache-safe metadata", async () => {
    process.env.OBJECT_STORAGE_BUCKET = "private-media";
    process.env.OBJECT_STORAGE_ACCESS_KEY_ID = "test-access-key";
    process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY = "test-secret-key";
    const storage = new ObjectStorageService();
    const send = vi.fn(async (_command: { input: Record<string, any> }) => ({}));
    Object.assign(storage as object, { client: { send } });
    const root = await mkdtemp(join(tmpdir(), "baduk-hls-upload-test-"));
    try {
      await mkdir(join(root, "360p"));
      await writeFile(join(root, "master.m3u8"), "#EXTM3U\n360p/index.m3u8\n");
      await writeFile(join(root, "360p", "index.m3u8"), "#EXTM3U\nsegment-00001.m4s\n");
      await writeFile(join(root, "360p", "init.mp4"), Buffer.from([1]));
      await writeFile(join(root, "360p", "segment-00001.m4s"), Buffer.from([2]));

      await expect(storage.uploadHlsPackage(root, "lesson-hls/PRE-01/job-1")).resolves.toEqual({
        manifestKey: "lesson-hls/PRE-01/job-1/master.m3u8",
        fileCount: 4,
      });
      const putInputs = send.mock.calls.map(([command]) => command.input);
      expect(putInputs).toHaveLength(4);
      expect(putInputs.find((input) => input.Key.endsWith("master.m3u8"))).toMatchObject({
        ContentType: "application/vnd.apple.mpegurl",
        CacheControl: "private, no-cache",
      });
      expect(putInputs.find((input) => input.Key.endsWith("segment-00001.m4s"))).toMatchObject({
        ContentType: "video/iso.segment",
        CacheControl: "public, max-age=31536000, immutable",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
