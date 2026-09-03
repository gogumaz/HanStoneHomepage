import { describe, expect, it } from "vitest";
import { loadAppConfig } from "./app-config.js";

function productionEnv(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://user:password@database.example.com:5432/app?sslmode=require",
    CORS_ORIGINS: "https://www.example.com",
    PUBLIC_APP_URL: "https://www.example.com",
    SMTP_HOST: "smtp.example.com",
    SMTP_PORT: "587",
    SMTP_SECURE: "false",
    SMTP_REQUIRE_TLS: "true",
    SMTP_USER: "smtp-user",
    SMTP_PASSWORD: "smtp-password",
    MAIL_FROM: "바둑타고 <no-reply@example.com>",
    MAIL_DKIM_SELECTOR: "mail2026",
    MAIL_BOUNCE_WEBHOOK_SECRET: "bounce_webhook_secret_1234567890_abcd",
    LEGAL_POLICY_VERSION: "guardian-link-v1",
    LEGAL_POLICY_APPROVED_AT: "2026-08-01T00:00:00.000Z",
    LEGAL_POLICY_APPROVAL_SHA256: "a".repeat(64),
  };
}

describe("loadAppConfig account mail settings", () => {
  it("rejects plaintext production transports", () => {
    expect(() => loadAppConfig({ ...productionEnv(), PUBLIC_APP_URL: "http://www.example.com" }))
      .toThrow(/PUBLIC_APP_URL.*HTTPS/);
    expect(() => loadAppConfig({ ...productionEnv(), CORS_ORIGINS: "http://www.example.com" }))
      .toThrow(/CORS_ORIGINS.*HTTPS/);
    expect(() => loadAppConfig({
      ...productionEnv(),
      DATABASE_URL: "postgresql://user:password@database.example.com:5432/app",
    })).toThrow(/DATABASE_URL.*sslmode/);
    expect(() => loadAppConfig({
      ...productionEnv(),
      RATE_LIMIT_REDIS_URL: "redis://redis.example.com:6379",
    })).toThrow(/RATE_LIMIT_REDIS_URL.*rediss/);
    expect(() => loadAppConfig({
      ...productionEnv(),
      OBJECT_STORAGE_BUCKET: "production-assets",
      OBJECT_STORAGE_ENDPOINT: "http://storage.example.com",
    })).toThrow(/OBJECT_STORAGE_ENDPOINT.*HTTPS/);
    expect(() => loadAppConfig({
      ...productionEnv(),
      SMTP_SECURE: "false",
      SMTP_REQUIRE_TLS: "false",
    })).toThrow(/SMTP.*STARTTLS/);
  });

  it("keeps the Toss Payments secret in server configuration only", () => {
    expect(loadAppConfig({
      DATABASE_URL: "postgresql://test:test@localhost/test",
      TOSS_PAYMENTS_SECRET_KEY: "  test_sk_server_only  ",
    }).tossPaymentsSecretKey).toBe("test_sk_server_only");
  });

  it("accepts only a 32-byte account mail encryption key", () => {
    const key = Buffer.alloc(32, 9).toString("base64");
    expect(loadAppConfig({
      DATABASE_URL: "postgresql://test:test@localhost/test",
      ACCOUNT_MAIL_ENCRYPTION_KEY_BASE64: key,
    }).accountMailEncryptionKeyBase64).toBe(key);
    expect(() => loadAppConfig({
      DATABASE_URL: "postgresql://test:test@localhost/test",
      ACCOUNT_MAIL_ENCRYPTION_KEY_BASE64: Buffer.alloc(16).toString("base64"),
    })).toThrow(/ACCOUNT_MAIL_ENCRYPTION_KEY_BASE64/);
  });

  it("validates the internal operations metrics token", () => {
    const token = "metrics_token_1234567890_abcdefghij";
    expect(loadAppConfig({
      DATABASE_URL: "postgresql://test:test@localhost/test",
      OPERATIONS_METRICS_TOKEN: token,
    }).operationsMetricsToken).toBe(token);
    expect(() => loadAppConfig({
      DATABASE_URL: "postgresql://test:test@localhost/test",
      OPERATIONS_METRICS_TOKEN: "short-token",
    })).toThrow(/OPERATIONS_METRICS_TOKEN/);
  });

  it("uses no trusted proxy by default and validates an explicit hop count", () => {
    expect(loadAppConfig({
      DATABASE_URL: "postgresql://test:test@localhost/test",
    }).trustProxyHops).toBe(0);
    expect(loadAppConfig({
      DATABASE_URL: "postgresql://test:test@localhost/test",
      TRUST_PROXY_HOPS: "2",
    }).trustProxyHops).toBe(2);
    expect(() => loadAppConfig({
      DATABASE_URL: "postgresql://test:test@localhost/test",
      TRUST_PROXY_HOPS: "-1",
    })).toThrow(/TRUST_PROXY_HOPS/);
  });

  it("defaults and bounds the parsed request body size", () => {
    const base = { DATABASE_URL: "postgresql://test:test@localhost/test" };
    expect(loadAppConfig(base).requestBodyMaxBytes).toBe(1_048_576);
    expect(loadAppConfig({ ...base, REQUEST_BODY_MAX_BYTES: "2048" }).requestBodyMaxBytes)
      .toBe(2_048);
    expect(() => loadAppConfig({ ...base, REQUEST_BODY_MAX_BYTES: "1023" }))
      .toThrow(/REQUEST_BODY_MAX_BYTES/);
    expect(() => loadAppConfig({ ...base, REQUEST_BODY_MAX_BYTES: "10485761" }))
      .toThrow(/REQUEST_BODY_MAX_BYTES/);
  });

  it("validates the optional distributed rate-limit store configuration", () => {
    const base = { DATABASE_URL: "postgresql://test:test@localhost/test" };
    expect(loadAppConfig(base)).toMatchObject({
      rateLimitRedisUrl: null,
      rateLimitKeyPrefix: "baduk-history:rate-limit:",
      rateLimitConnectTimeoutMs: 3_000,
    });
    expect(loadAppConfig({
      ...base,
      RATE_LIMIT_REDIS_URL: "rediss://user:password@redis.example.com:6380/1",
      RATE_LIMIT_KEY_PREFIX: "bhj:production:",
      RATE_LIMIT_CONNECT_TIMEOUT_MS: "5000",
    })).toMatchObject({
      rateLimitRedisUrl: "rediss://user:password@redis.example.com:6380/1",
      rateLimitKeyPrefix: "bhj:production:",
      rateLimitConnectTimeoutMs: 5_000,
    });
    expect(() => loadAppConfig({ ...base, RATE_LIMIT_REDIS_URL: "https://redis.example.com" }))
      .toThrow(/RATE_LIMIT_REDIS_URL/);
    expect(() => loadAppConfig({ ...base, RATE_LIMIT_KEY_PREFIX: "invalid prefix" }))
      .toThrow(/RATE_LIMIT_KEY_PREFIX/);
    expect(() => loadAppConfig({ ...base, RATE_LIMIT_CONNECT_TIMEOUT_MS: "499" }))
      .toThrow(/RATE_LIMIT_CONNECT_TIMEOUT_MS/);
  });

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
      mailDkimSelector: "mail2026",
      legalPolicyVersion: "guardian-link-v1",
      legalPolicyApprovedAt: "2026-08-01T00:00:00.000Z",
      legalPolicyApprovalSha256: "a".repeat(64),
    });
  });

  it("requires a signed current legal-policy approval in production", () => {
    expect(() => loadAppConfig({ ...productionEnv(), LEGAL_POLICY_VERSION: undefined }))
      .toThrow(/LEGAL_POLICY_VERSION/);
    expect(() => loadAppConfig({ ...productionEnv(), LEGAL_POLICY_VERSION: "guardian-link-v0" }))
      .toThrow(/guardian-link-v1/);
    expect(() => loadAppConfig({ ...productionEnv(), LEGAL_POLICY_APPROVED_AT: undefined }))
      .toThrow(/LEGAL_POLICY_APPROVED_AT/);
    expect(() => loadAppConfig({ ...productionEnv(), LEGAL_POLICY_APPROVED_AT: "2999-01-01T00:00:00.000Z" }))
      .toThrow(/미래/);
    expect(() => loadAppConfig({ ...productionEnv(), LEGAL_POLICY_APPROVAL_SHA256: undefined }))
      .toThrow(/LEGAL_POLICY_APPROVAL_SHA256/);
    expect(() => loadAppConfig({ ...productionEnv(), LEGAL_POLICY_APPROVAL_SHA256: "not-a-hash" }))
      .toThrow(/SHA-256/);
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
      INQUIRY_ATTACHMENT_RETENTION_HOURS: "720",
      COMMUNITY_ATTACHMENT_MAX_BYTES: "20971520",
      COMMUNITY_ATTACHMENT_RETENTION_HOURS: "720",
    })).toMatchObject({
      videoCleanupPollIntervalMs: 1000,
      videoCleanupMaxAttempts: 10,
      videoCleanupLockTimeoutMs: 60000,
      videoUploadAbandonedAfterHours: 1,
      videoReplacedRetentionHours: 2160,
      inquiryAttachmentRetentionHours: 720,
      communityAttachmentMaxBytes: 20_971_520,
      communityAttachmentRetentionHours: 720,
    });
    expect(() => loadAppConfig({
      DATABASE_URL: "postgresql://test:test@localhost/test",
      VIDEO_CLEANUP_MAX_ATTEMPTS: "11",
    })).toThrow(/VIDEO_CLEANUP_MAX_ATTEMPTS/);
    expect(() => loadAppConfig({
      DATABASE_URL: "postgresql://test:test@localhost/test",
      VIDEO_UPLOAD_ABANDONED_AFTER_HOURS: "721",
    })).toThrow(/VIDEO_UPLOAD_ABANDONED_AFTER_HOURS/);
    expect(() => loadAppConfig({
      DATABASE_URL: "postgresql://test:test@localhost/test",
      INQUIRY_ATTACHMENT_RETENTION_HOURS: "721",
    })).toThrow(/INQUIRY_ATTACHMENT_RETENTION_HOURS/);
    expect(() => loadAppConfig({
      DATABASE_URL: "postgresql://test:test@localhost/test",
      COMMUNITY_ATTACHMENT_RETENTION_HOURS: "721",
    })).toThrow(/COMMUNITY_ATTACHMENT_RETENTION_HOURS/);
  });

  it("bounds inquiry notification worker polling, retries, and stale-lock timeout", () => {
    expect(loadAppConfig({
      DATABASE_URL: "postgresql://test:test@localhost/test",
      INQUIRY_NOTIFICATION_POLL_INTERVAL_MS: "1000",
      INQUIRY_NOTIFICATION_MAX_ATTEMPTS: "10",
      INQUIRY_NOTIFICATION_LOCK_TIMEOUT_MS: "60000",
    })).toMatchObject({
      inquiryNotificationPollIntervalMs: 1000,
      inquiryNotificationMaxAttempts: 10,
      inquiryNotificationLockTimeoutMs: 60000,
    });
    expect(() => loadAppConfig({
      DATABASE_URL: "postgresql://test:test@localhost/test",
      INQUIRY_NOTIFICATION_MAX_ATTEMPTS: "11",
    })).toThrow(/INQUIRY_NOTIFICATION_MAX_ATTEMPTS/);
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

describe("loadAppConfig recovery readiness settings", () => {
  const base = { DATABASE_URL: "postgresql://test:test@localhost/test" };

  it("parses backup, RPO/RTO, and recovery drill declarations", () => {
    expect(loadAppConfig({
      ...base,
      DATABASE_PITR_ENABLED: "true",
      BACKUP_RETENTION_DAYS: "35",
      OBJECT_STORAGE_VERSIONING_ENABLED: "true",
      RECOVERY_RPO_MINUTES: "10",
      RECOVERY_RTO_MINUTES: "180",
      RECOVERY_DRILL_LAST_COMPLETED_AT: "2026-08-01T00:00:00+09:00",
      RECOVERY_DRILL_MAX_AGE_DAYS: "90",
    })).toMatchObject({
      databasePitrEnabled: true,
      backupRetentionDays: 35,
      objectStorageVersioningEnabled: true,
      recoveryRpoMinutes: 10,
      recoveryRtoMinutes: 180,
      recoveryDrillLastCompletedAt: "2026-07-31T15:00:00.000Z",
      recoveryDrillMaxAgeDays: 90,
    });
  });

  it("rejects invalid recovery declarations", () => {
    expect(() => loadAppConfig({ ...base, DATABASE_PITR_ENABLED: "yes" }))
      .toThrow(/DATABASE_PITR_ENABLED/);
    expect(() => loadAppConfig({ ...base, BACKUP_RETENTION_DAYS: "0" }))
      .toThrow(/BACKUP_RETENTION_DAYS/);
    expect(() => loadAppConfig({ ...base, RECOVERY_DRILL_LAST_COMPLETED_AT: "not-a-date" }))
      .toThrow(/RECOVERY_DRILL_LAST_COMPLETED_AT/);
  });
});
