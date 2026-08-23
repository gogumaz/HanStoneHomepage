import { generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CloudFrontPlaybackProvider } from "./cloudfront-playback.provider.js";

const ENV_KEYS = [
  "DATABASE_URL",
  "PLAYBACK_CDN_PROVIDER",
  "PLAYBACK_CDN_BASE_URL",
  "PLAYBACK_CDN_KEY_PAIR_ID",
  "PLAYBACK_CDN_PRIVATE_KEY_BASE64",
  "PLAYBACK_URL_TTL_SECONDS",
] as const;

describe("CloudFrontPlaybackProvider", () => {
  const original = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      original.set(key, process.env[key]);
      delete process.env[key];
    }
    process.env.DATABASE_URL = "postgresql://test:test@localhost/test";
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = original.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("creates a short-lived SHA-256 CloudFront signed URL", () => {
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    process.env.PLAYBACK_CDN_PROVIDER = "cloudfront";
    process.env.PLAYBACK_CDN_BASE_URL = "https://media.example.com";
    process.env.PLAYBACK_CDN_KEY_PAIR_ID = "KTEST123";
    process.env.PLAYBACK_CDN_PRIVATE_KEY_BASE64 = Buffer.from(privateKey).toString("base64");
    process.env.PLAYBACK_URL_TTL_SECONDS = "120";

    const provider = new CloudFrontPlaybackProvider();
    const signed = provider.sign("lesson-hls/PRE-01/v1/segment-001.m4s");
    const url = new URL(signed.url);

    expect(provider.isConfigured()).toBe(true);
    expect(signed.provider).toBe("cloudfront");
    expect(url.origin).toBe("https://media.example.com");
    expect(url.pathname).toBe("/lesson-hls/PRE-01/v1/segment-001.m4s");
    expect(url.searchParams.get("Key-Pair-Id")).toBe("KTEST123");
    expect(url.searchParams.get("Signature")).toBeTruthy();
    expect(url.searchParams.get("Hash-Algorithm")).toBe("SHA256");
    expect(Number(url.searchParams.get("Expires"))).toBeGreaterThan(Math.floor(Date.now() / 1000) + 118);
    expect(() => provider.verifyLocalSigning()).not.toThrow();
    expect(() => provider.sign("lesson-hls/../secret.m4s")).toThrow("CDN_OBJECT_KEY_INVALID");
  });

  it("stays disabled without settings and rejects invalid keys and paths", () => {
    expect(new CloudFrontPlaybackProvider().isConfigured()).toBe(false);
    process.env.PLAYBACK_CDN_PROVIDER = "cloudfront";
    process.env.PLAYBACK_CDN_BASE_URL = "https://media.example.com";
    process.env.PLAYBACK_CDN_KEY_PAIR_ID = "KTEST123";
    process.env.PLAYBACK_CDN_PRIVATE_KEY_BASE64 = Buffer.from("not a private key").toString("base64");
    expect(() => new CloudFrontPlaybackProvider()).toThrow("PLAYBACK_CDN_PRIVATE_KEY_INVALID");
  });
});
