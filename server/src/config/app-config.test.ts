import { describe, expect, it } from "vitest";
import { loadAppConfig } from "./app-config.js";

function productionEnv(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://user:password@database.example.com:5432/app",
    CORS_ORIGINS: "https://www.example.com",
    PUBLIC_APP_URL: "https://www.example.com",
    SMTP_HOST: "smtp.example.com",
    SMTP_PORT: "587",
    SMTP_SECURE: "false",
    SMTP_REQUIRE_TLS: "true",
    SMTP_USER: "smtp-user",
    SMTP_PASSWORD: "smtp-password",
    MAIL_FROM: "바둑타고 <no-reply@example.com>",
  };
}

describe("loadAppConfig account mail settings", () => {
  it("requires the public URL and SMTP sender settings in production", () => {
    const missingPublicUrl = productionEnv();
    delete missingPublicUrl.PUBLIC_APP_URL;
    expect(() => loadAppConfig(missingPublicUrl)).toThrow(/PUBLIC_APP_URL/);

    const missingSmtp = productionEnv();
    delete missingSmtp.SMTP_HOST;
    expect(() => loadAppConfig(missingSmtp)).toThrow(/SMTP_HOST/);
  });

  it("accepts a TLS-required authenticated SMTP configuration", () => {
    expect(loadAppConfig(productionEnv())).toMatchObject({
      publicAppUrl: "https://www.example.com",
      smtpHost: "smtp.example.com",
      smtpPort: 587,
      smtpSecure: false,
      smtpRequireTls: true,
      smtpUser: "smtp-user",
      smtpFrom: "바둑타고 <no-reply@example.com>",
    });
  });

  it("rejects incomplete credentials and header injection", () => {
    const missingPassword = productionEnv();
    delete missingPassword.SMTP_PASSWORD;
    expect(() => loadAppConfig(missingPassword)).toThrow(/SMTP_USER와 SMTP_PASSWORD/);

    const invalidFrom = productionEnv();
    invalidFrom.MAIL_FROM = "바둑타고\r\nBcc: attacker@example.com";
    expect(() => loadAppConfig(invalidFrom)).toThrow(/줄바꿈/);
  });

  it("bounds the video scan worker polling, retries, and stale-lock timeout", () => {
    expect(loadAppConfig({
      DATABASE_URL: "postgresql://test:test@localhost/test",
      VIDEO_SCAN_POLL_INTERVAL_MS: "1000",
      VIDEO_SCAN_MAX_ATTEMPTS: "10",
      VIDEO_SCAN_LOCK_TIMEOUT_MS: "60000",
    })).toMatchObject({
      videoScanPollIntervalMs: 1000,
      videoScanMaxAttempts: 10,
      videoScanLockTimeoutMs: 60000,
    });
    expect(() => loadAppConfig({
      DATABASE_URL: "postgresql://test:test@localhost/test",
      VIDEO_SCAN_MAX_ATTEMPTS: "11",
    })).toThrow(/VIDEO_SCAN_MAX_ATTEMPTS/);
  });

  it("bounds the video cleanup retention, polling, retries, and stale-lock timeout", () => {
    expect(loadAppConfig({
      DATABASE_URL: "postgresql://test:test@localhost/test",
      VIDEO_CLEANUP_POLL_INTERVAL_MS: "1000",
      VIDEO_CLEANUP_MAX_ATTEMPTS: "10",
      VIDEO_CLEANUP_LOCK_TIMEOUT_MS: "60000",
      VIDEO_UPLOAD_ABANDONED_AFTER_HOURS: "1",
      VIDEO_REPLACED_RETENTION_HOURS: "2160",
    })).toMatchObject({
      videoCleanupPollIntervalMs: 1000,
      videoCleanupMaxAttempts: 10,
      videoCleanupLockTimeoutMs: 60000,
      videoUploadAbandonedAfterHours: 1,
      videoReplacedRetentionHours: 2160,
    });
    expect(() => loadAppConfig({
      DATABASE_URL: "postgresql://test:test@localhost/test",
      VIDEO_CLEANUP_MAX_ATTEMPTS: "11",
    })).toThrow(/VIDEO_CLEANUP_MAX_ATTEMPTS/);
    expect(() => loadAppConfig({
      DATABASE_URL: "postgresql://test:test@localhost/test",
      VIDEO_UPLOAD_ABANDONED_AFTER_HOURS: "721",
    })).toThrow(/VIDEO_UPLOAD_ABANDONED_AFTER_HOURS/);
  });

  it("bounds HLS transcode worker polling, retries, locks, and segment duration", () => {
    expect(loadAppConfig({
      DATABASE_URL: "postgresql://test:test@localhost/test",
      HLS_TRANSCODE_POLL_INTERVAL_MS: "1000",
      HLS_TRANSCODE_MAX_ATTEMPTS: "10",
      HLS_TRANSCODE_LOCK_TIMEOUT_MS: "60000",
      HLS_SEGMENT_DURATION_SECONDS: "10",
      FFMPEG_PATH: "custom-ffmpeg",
      FFPROBE_PATH: "custom-ffprobe",
    })).toMatchObject({
      hlsTranscodePollIntervalMs: 1000,
      hlsTranscodeMaxAttempts: 10,
      hlsTranscodeLockTimeoutMs: 60000,
      hlsSegmentDurationSeconds: 10,
      ffmpegPath: "custom-ffmpeg",
      ffprobePath: "custom-ffprobe",
    });
    expect(() => loadAppConfig({
      DATABASE_URL: "postgresql://test:test@localhost/test",
      HLS_SEGMENT_DURATION_SECONDS: "11",
    })).toThrow(/HLS_SEGMENT_DURATION_SECONDS/);
  });
});

describe("loadAppConfig CDN settings", () => {
  const base = { DATABASE_URL: "postgresql://test:test@localhost/test" };

  it("accepts a complete CloudFront signed URL configuration", () => {
    expect(loadAppConfig({
      ...base,
      PLAYBACK_CDN_PROVIDER: "cloudfront",
      PLAYBACK_CDN_BASE_URL: "https://media.example.com",
      PLAYBACK_CDN_KEY_PAIR_ID: "K123_TEST",
      PLAYBACK_CDN_PRIVATE_KEY_BASE64: Buffer.from("private-key").toString("base64"),
      PREFLIGHT_REQUIRE_CDN: "true",
    })).toMatchObject({
      playbackCdnProvider: "cloudfront",
      playbackCdnBaseUrl: "https://media.example.com",
      playbackCdnKeyPairId: "K123_TEST",
      preflightRequireCdn: true,
    });
  });

  it("rejects partial, insecure, and unsupported CDN settings", () => {
    expect(() => loadAppConfig({ ...base, PLAYBACK_CDN_PROVIDER: "cloudfront" }))
      .toThrow(/CDN/);
    expect(() => loadAppConfig({
      ...base,
      PLAYBACK_CDN_PROVIDER: "cloudfront",
      PLAYBACK_CDN_BASE_URL: "http://media.example.com/path",
      PLAYBACK_CDN_KEY_PAIR_ID: "K123",
      PLAYBACK_CDN_PRIVATE_KEY_BASE64: "dGVzdA==",
    })).toThrow(/PLAYBACK_CDN_BASE_URL/);
    expect(() => loadAppConfig({ ...base, PLAYBACK_CDN_PROVIDER: "other" }))
      .toThrow(/PLAYBACK_CDN_PROVIDER/);
    expect(() => loadAppConfig({ ...base, PREFLIGHT_REQUIRE_CDN: "true" }))
      .toThrow(/PREFLIGHT_REQUIRE_CDN/);
  });
});
