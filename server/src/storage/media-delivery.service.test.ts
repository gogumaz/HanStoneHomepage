import { describe, expect, it, vi } from "vitest";
import { CloudFrontPlaybackProvider } from "./cloudfront-playback.provider.js";
import { MediaDeliveryService } from "./media-delivery.service.js";
import { ObjectStorageService } from "./object-storage.service.js";

describe("MediaDeliveryService", () => {
  it("uses CloudFront when enabled", async () => {
    const storage = {
      isConfigured: vi.fn(() => true),
      signPlaybackUrl: vi.fn(),
      signHlsAssetUrl: vi.fn(),
      verifyCdnDelivery: vi.fn(async (sign: (key: string) => Promise<unknown>) => {
        await sign("lesson-hls/preflight/probe.m4s");
      }),
    } as unknown as ObjectStorageService;
    const signed = {
      url: "https://media.example.test/object?signed=1",
      expiresAt: new Date(),
      provider: "cloudfront" as const,
    };
    const cloudFront = {
      isConfigured: vi.fn(() => true),
      sign: vi.fn(() => signed),
      verifyLocalSigning: vi.fn(),
    } as unknown as CloudFrontPlaybackProvider;
    const delivery = new MediaDeliveryService(storage, cloudFront);

    await expect(delivery.signPlaybackUrl("lesson-videos/test.mp4")).resolves.toBe(signed);
    await expect(delivery.signHlsAssetUrl("lesson-hls/test/segment.m4s")).resolves.toBe(signed);
    await expect(delivery.verifyCdnConnection()).resolves.toBe("cloudfront");
    expect(storage.signPlaybackUrl).not.toHaveBeenCalled();
    expect(storage.signHlsAssetUrl).not.toHaveBeenCalled();
    expect(storage.verifyCdnDelivery).toHaveBeenCalledOnce();
  });

  it("falls back to direct object-storage signed URLs when CDN is disabled", async () => {
    const expiresAt = new Date();
    const storage = {
      isConfigured: vi.fn(() => true),
      getPlaybackExpiresAt: vi.fn(() => expiresAt),
      signPlaybackUrl: vi.fn(async () => ({ url: "https://storage.test/video", expiresAt })),
      signHlsAssetUrl: vi.fn(async () => ({ url: "https://storage.test/segment", expiresAt })),
    } as unknown as ObjectStorageService;
    const cloudFront = { isConfigured: vi.fn(() => false) } as unknown as CloudFrontPlaybackProvider;
    const delivery = new MediaDeliveryService(storage, cloudFront);

    await expect(delivery.signPlaybackUrl("lesson-videos/test.mp4")).resolves.toMatchObject({
      provider: "object-storage",
    });
    await expect(delivery.verifyCdnConnection()).resolves.toBe("disabled");
  });
});
