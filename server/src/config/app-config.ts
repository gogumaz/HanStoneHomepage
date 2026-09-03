import { CURRENT_LEGAL_POLICY_VERSION } from "../common/legal-policy.js";

export type AppConfig = {
  nodeEnv: "development" | "test" | "production";
  port: number;
  trustProxyHops: number;
  requestBodyMaxBytes: number;
  rateLimitRedisUrl: string | null;
  rateLimitKeyPrefix: string;
  rateLimitConnectTimeoutMs: number;
  databaseUrl: string;
  corsOrigins: string[];
  sessionCookieName: string;
  sessionTtlHours: number;
  oauthStateTtlMinutes: number;
  passwordResetTtlMinutes: number;
  emailVerificationTtlHours: number;
  publicAppUrl: string;
  smtpHost: string | null;
  smtpPort: number;
  smtpSecure: boolean;
  smtpRequireTls: boolean;
  smtpUser: string | null;
  smtpPassword: string | null;
  smtpFrom: string | null;
  mailDkimSelector: string | null;
  mailBounceWebhookSecret: string | null;
  smtpConnectionTimeoutMs: number;
  accountMailEncryptionKeyBase64: string | null;
  accountMailPollIntervalMs: number;
  accountMailMaxAttempts: number;
  accountMailLockTimeoutMs: number;
  workerHealthBacklogMinutes: number;
  operationsMetricsToken: string | null;
  legalPolicyVersion: string | null;
  legalPolicyApprovedAt: string | null;
  legalPolicyApprovalSha256: string | null;
  inquiryNotificationPollIntervalMs: number;
  inquiryNotificationMaxAttempts: number;
  inquiryNotificationLockTimeoutMs: number;
  guardianInvitationTtlHours: number;
  tossPaymentsSecretKey: string | null;
  objectStorageEndpoint: string | null;
  objectStorageRegion: string;
  objectStorageBucket: string | null;
  objectStorageAccessKeyId: string | null;
  objectStorageSecretAccessKey: string | null;
  objectStorageForcePathStyle: boolean;
  playbackCdnProvider: "cloudfront" | null;
  playbackCdnBaseUrl: string | null;
  playbackCdnKeyPairId: string | null;
  playbackCdnPrivateKeyBase64: string | null;
  preflightRequireCdn: boolean;
  databasePitrEnabled: boolean;
  backupRetentionDays: number;
  objectStorageVersioningEnabled: boolean;
  recoveryRpoMinutes: number;
  recoveryRtoMinutes: number;
  recoveryDrillLastCompletedAt: string | null;
  recoveryDrillMaxAgeDays: number;
  playbackUrlTtlSeconds: number;
  videoUploadUrlTtlSeconds: number;
  videoUploadMaxBytes: number;
  lessonAssetMaxBytes: number;
  inquiryAttachmentMaxBytes: number;
  inquiryAttachmentRetentionHours: number;
  communityAttachmentMaxBytes: number;
  communityAttachmentRetentionHours: number;
  malwareScannerHost: string | null;
  malwareScannerPort: number;
  malwareScannerTimeoutMs: number;
  videoScanPollIntervalMs: number;
  videoScanMaxAttempts: number;
  videoScanLockTimeoutMs: number;
  videoCleanupPollIntervalMs: number;
  videoCleanupMaxAttempts: number;
  videoCleanupLockTimeoutMs: number;
  videoUploadAbandonedAfterHours: number;
  videoReplacedRetentionHours: number;
  hlsTranscodePollIntervalMs: number;
  hlsTranscodeMaxAttempts: number;
  hlsTranscodeLockTimeoutMs: number;
  hlsSegmentDurationSeconds: number;
  ffmpegPath: string;
  ffprobePath: string;
  logLevel: string;
};

const allowedEnvironments = new Set(["development", "test", "production"]);

function required(value: string | undefined, key: string): string {
  if (!value?.trim()) {
    throw new Error(`${key} 환경 변수가 필요합니다.`);
  }
  return value.trim();
}

function positiveInteger(value: string | undefined, fallback: number, key: string): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${key}는 1 이상의 정수여야 합니다.`);
  }
  return parsed;
}

function nonNegativeInteger(value: string | undefined, fallback: number, key: string): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${key} must be a non-negative integer.`);
  }
  return parsed;
}

function booleanValue(value: string | undefined, fallback: boolean, key: string): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${key}는 true 또는 false여야 합니다.`);
}

function optionalUrl(value: string | undefined, key: string): string | null {
  if (!value?.trim()) return null;
  const candidate = value.trim();
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error();
    return url.toString().replace(/\/$/, "");
  } catch {
    throw new Error(`${key}는 올바른 HTTP(S) URL이어야 합니다.`);
  }
}

function optionalRedisUrl(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  const candidate = value.trim();
  try {
    const url = new URL(candidate);
    if (url.protocol !== "redis:" && url.protocol !== "rediss:") throw new Error();
    if (!url.hostname || url.search || url.hash) throw new Error();
    return url.toString();
  } catch {
    throw new Error("RATE_LIMIT_REDIS_URL은 올바른 redis:// 또는 rediss:// URL이어야 합니다.");
  }
}

function optionalIsoTimestamp(value: string | undefined, key: string): string | null {
  if (!value?.trim()) return null;
  const candidate = value.trim();
  const timestamp = Date.parse(candidate);
  if (!Number.isFinite(timestamp)) {
    throw new Error(`${key}는 ISO 8601 날짜·시간이어야 합니다.`);
  }
  return new Date(timestamp).toISOString();
}

function optionalEncryptionKey(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  const candidate = value.trim();
  if (!/^[A-Za-z0-9+/]{43}=$/.test(candidate) || Buffer.from(candidate, "base64").byteLength !== 32) {
    throw new Error("ACCOUNT_MAIL_ENCRYPTION_KEY_BASE64는 32바이트 키의 base64 값이어야 합니다.");
  }
  return candidate;
}

function optionalMetricsToken(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  const candidate = value.trim();
  if (!/^[A-Za-z0-9_-]{32,200}$/.test(candidate)) {
    throw new Error("OPERATIONS_METRICS_TOKEN은 영문·숫자·_·- 조합의 32~200자 값이어야 합니다.");
  }
  return candidate;
}

function optionalLegalPolicyVersion(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  const candidate = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(candidate)) {
    throw new Error("LEGAL_POLICY_VERSION은 영문·숫자·점·_·- 조합의 1~100자 값이어야 합니다.");
  }
  return candidate;
}

function optionalSha256(value: string | undefined, key: string): string | null {
  if (!value?.trim()) return null;
  const candidate = value.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(candidate)) {
    throw new Error(`${key}는 64자리 SHA-256 16진수여야 합니다.`);
  }
  return candidate;
}

function optionalMailDkimSelector(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  const candidate = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(candidate)) {
    throw new Error("MAIL_DKIM_SELECTOR는 영문·숫자·_·- 조합의 1~63자 값이어야 합니다.");
  }
  return candidate;
}

function optionalWebhookSecret(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  const candidate = value.trim();
  if (!/^[A-Za-z0-9_-]{32,200}$/.test(candidate)) {
    throw new Error("MAIL_BOUNCE_WEBHOOK_SECRET은 영문·숫자·_·- 조합의 32~200자 값이어야 합니다.");
  }
  return candidate;
}

export function loadAppConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = env.NODE_ENV ?? "development";
  if (!allowedEnvironments.has(nodeEnv)) {
    throw new Error("NODE_ENV는 development, test, production 중 하나여야 합니다.");
  }

  const corsOrigins = (env.CORS_ORIGINS ?? "http://127.0.0.1:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (corsOrigins.length === 0) {
    throw new Error("CORS_ORIGINS에 하나 이상의 origin이 필요합니다.");
  }

  const publicAppUrl = optionalUrl(
    nodeEnv === "production" ? required(env.PUBLIC_APP_URL, "PUBLIC_APP_URL") : env.PUBLIC_APP_URL ?? corsOrigins[0],
    "PUBLIC_APP_URL",
  ) as string;
  const smtpHost = env.SMTP_HOST?.trim() || null;
  const smtpUser = env.SMTP_USER?.trim() || null;
  const smtpPassword = env.SMTP_PASSWORD?.trim() || null;
  const smtpFrom = env.MAIL_FROM?.trim() || null;
  const mailDkimSelector = optionalMailDkimSelector(env.MAIL_DKIM_SELECTOR);
  const mailBounceWebhookSecret = optionalWebhookSecret(env.MAIL_BOUNCE_WEBHOOK_SECRET);
  const accountMailEncryptionKeyBase64 = optionalEncryptionKey(env.ACCOUNT_MAIL_ENCRYPTION_KEY_BASE64);
  const operationsMetricsToken = optionalMetricsToken(env.OPERATIONS_METRICS_TOKEN);
  if (Boolean(smtpUser) !== Boolean(smtpPassword)) {
    throw new Error("SMTP_USER와 SMTP_PASSWORD는 함께 설정해야 합니다.");
  }
  if (smtpFrom && /[\r\n]/.test(smtpFrom)) {
    throw new Error("MAIL_FROM에는 줄바꿈을 사용할 수 없습니다.");
  }
  if (nodeEnv === "production" && (!smtpHost || !smtpFrom)) {
    throw new Error("운영 환경에는 SMTP_HOST와 MAIL_FROM이 필요합니다.");
  }

  const objectStorageBucket = env.OBJECT_STORAGE_BUCKET?.trim() || null;
  const objectStorageEndpoint = optionalUrl(env.OBJECT_STORAGE_ENDPOINT, "OBJECT_STORAGE_ENDPOINT");
  const objectStorageAccessKeyId = env.OBJECT_STORAGE_ACCESS_KEY_ID?.trim() || null;
  const objectStorageSecretAccessKey = env.OBJECT_STORAGE_SECRET_ACCESS_KEY?.trim() || null;
  const storageValuesPresent = Boolean(
    objectStorageEndpoint || objectStorageAccessKeyId || objectStorageSecretAccessKey,
  );
  if (storageValuesPresent && !objectStorageBucket) {
    throw new Error("객체 저장소 설정에는 OBJECT_STORAGE_BUCKET이 필요합니다.");
  }
  if (Boolean(objectStorageAccessKeyId) !== Boolean(objectStorageSecretAccessKey)) {
    throw new Error("객체 저장소 Access Key와 Secret Key는 함께 설정해야 합니다.");
  }
  const cdnProviderValue = env.PLAYBACK_CDN_PROVIDER?.trim().toLowerCase() || null;
  if (cdnProviderValue && cdnProviderValue !== "cloudfront") {
    throw new Error("PLAYBACK_CDN_PROVIDER는 cloudfront만 지원합니다.");
  }
  const playbackCdnBaseUrl = optionalUrl(env.PLAYBACK_CDN_BASE_URL, "PLAYBACK_CDN_BASE_URL");
  const playbackCdnKeyPairId = env.PLAYBACK_CDN_KEY_PAIR_ID?.trim() || null;
  const playbackCdnPrivateKeyBase64 = env.PLAYBACK_CDN_PRIVATE_KEY_BASE64?.trim() || null;
  const preflightRequireCdn = booleanValue(env.PREFLIGHT_REQUIRE_CDN, false, "PREFLIGHT_REQUIRE_CDN");
  const databasePitrEnabled = booleanValue(env.DATABASE_PITR_ENABLED, false, "DATABASE_PITR_ENABLED");
  const backupRetentionDays = positiveInteger(env.BACKUP_RETENTION_DAYS, 30, "BACKUP_RETENTION_DAYS");
  const objectStorageVersioningEnabled = booleanValue(
    env.OBJECT_STORAGE_VERSIONING_ENABLED,
    false,
    "OBJECT_STORAGE_VERSIONING_ENABLED",
  );
  const recoveryRpoMinutes = positiveInteger(env.RECOVERY_RPO_MINUTES, 15, "RECOVERY_RPO_MINUTES");
  const recoveryRtoMinutes = positiveInteger(env.RECOVERY_RTO_MINUTES, 240, "RECOVERY_RTO_MINUTES");
  const recoveryDrillLastCompletedAt = optionalIsoTimestamp(
    env.RECOVERY_DRILL_LAST_COMPLETED_AT,
    "RECOVERY_DRILL_LAST_COMPLETED_AT",
  );
  const recoveryDrillMaxAgeDays = positiveInteger(
    env.RECOVERY_DRILL_MAX_AGE_DAYS,
    100,
    "RECOVERY_DRILL_MAX_AGE_DAYS",
  );
  const cdnValuesPresent = Boolean(
    cdnProviderValue || playbackCdnBaseUrl || playbackCdnKeyPairId || playbackCdnPrivateKeyBase64,
  );
  if (cdnValuesPresent && (!cdnProviderValue || !playbackCdnBaseUrl || !playbackCdnKeyPairId || !playbackCdnPrivateKeyBase64)) {
    throw new Error("CDN 설정은 공급자·기본 URL·키 페어 ID·개인키를 함께 입력해야 합니다.");
  }
  if (preflightRequireCdn && !cdnValuesPresent) {
    throw new Error("PREFLIGHT_REQUIRE_CDN=true이면 CDN 설정이 필요합니다.");
  }
  if (playbackCdnBaseUrl) {
    const cdnUrl = new URL(playbackCdnBaseUrl);
    if (
      cdnUrl.protocol !== "https:"
      || cdnUrl.pathname !== "/"
      || cdnUrl.search
      || cdnUrl.hash
      || cdnUrl.username
      || cdnUrl.password
    ) throw new Error("PLAYBACK_CDN_BASE_URL은 경로·쿼리 없는 HTTPS origin이어야 합니다.");
  }
  if (playbackCdnKeyPairId && (!/^[A-Za-z0-9_-]{1,128}$/.test(playbackCdnKeyPairId))) {
    throw new Error("PLAYBACK_CDN_KEY_PAIR_ID 형식을 확인해 주세요.");
  }
  if (playbackCdnPrivateKeyBase64 && playbackCdnPrivateKeyBase64.length > 32_768) {
    throw new Error("PLAYBACK_CDN_PRIVATE_KEY_BASE64가 너무 깁니다.");
  }
  const playbackUrlTtlSeconds = positiveInteger(
    env.PLAYBACK_URL_TTL_SECONDS,
    300,
    "PLAYBACK_URL_TTL_SECONDS",
  );
  if (playbackUrlTtlSeconds > 900) {
    throw new Error("PLAYBACK_URL_TTL_SECONDS는 900초 이하여야 합니다.");
  }
  const videoUploadUrlTtlSeconds = positiveInteger(
    env.VIDEO_UPLOAD_URL_TTL_SECONDS,
    300,
    "VIDEO_UPLOAD_URL_TTL_SECONDS",
  );
  if (videoUploadUrlTtlSeconds > 900) {
    throw new Error("VIDEO_UPLOAD_URL_TTL_SECONDS는 900초 이하여야 합니다.");
  }
  const videoUploadMaxBytes = positiveInteger(
    env.VIDEO_UPLOAD_MAX_BYTES,
    2_147_483_648,
    "VIDEO_UPLOAD_MAX_BYTES",
  );
  const lessonAssetMaxBytes = positiveInteger(
    env.LESSON_ASSET_MAX_BYTES,
    20_971_520,
    "LESSON_ASSET_MAX_BYTES",
  );
  const inquiryAttachmentMaxBytes = positiveInteger(
    env.INQUIRY_ATTACHMENT_MAX_BYTES,
    10 * 1024 * 1024,
    "INQUIRY_ATTACHMENT_MAX_BYTES",
  );
  const inquiryAttachmentRetentionHours = positiveInteger(
    env.INQUIRY_ATTACHMENT_RETENTION_HOURS,
    24,
    "INQUIRY_ATTACHMENT_RETENTION_HOURS",
  );
  if (inquiryAttachmentRetentionHours > 24 * 30) {
    throw new Error("INQUIRY_ATTACHMENT_RETENTION_HOURS는 720시간 이하여야 합니다.");
  }
  const communityAttachmentMaxBytes = positiveInteger(
    env.COMMUNITY_ATTACHMENT_MAX_BYTES,
    20 * 1024 * 1024,
    "COMMUNITY_ATTACHMENT_MAX_BYTES",
  );
  const communityAttachmentRetentionHours = positiveInteger(
    env.COMMUNITY_ATTACHMENT_RETENTION_HOURS,
    24,
    "COMMUNITY_ATTACHMENT_RETENTION_HOURS",
  );
  if (communityAttachmentRetentionHours > 24 * 30) {
    throw new Error("COMMUNITY_ATTACHMENT_RETENTION_HOURS는 720시간 이하여야 합니다.");
  }
  const videoScanPollIntervalMs = positiveInteger(
    env.VIDEO_SCAN_POLL_INTERVAL_MS,
    5_000,
    "VIDEO_SCAN_POLL_INTERVAL_MS",
  );
  if (videoScanPollIntervalMs < 1_000 || videoScanPollIntervalMs > 60_000) {
    throw new Error("VIDEO_SCAN_POLL_INTERVAL_MS는 1000~60000ms여야 합니다.");
  }
  const videoScanMaxAttempts = positiveInteger(
    env.VIDEO_SCAN_MAX_ATTEMPTS,
    3,
    "VIDEO_SCAN_MAX_ATTEMPTS",
  );
  if (videoScanMaxAttempts > 10) {
    throw new Error("VIDEO_SCAN_MAX_ATTEMPTS는 10 이하여야 합니다.");
  }
  const videoScanLockTimeoutMs = positiveInteger(
    env.VIDEO_SCAN_LOCK_TIMEOUT_MS,
    7_200_000,
    "VIDEO_SCAN_LOCK_TIMEOUT_MS",
  );
  if (videoScanLockTimeoutMs < 60_000) {
    throw new Error("VIDEO_SCAN_LOCK_TIMEOUT_MS는 60000ms 이상이어야 합니다.");
  }
  const videoCleanupPollIntervalMs = positiveInteger(
    env.VIDEO_CLEANUP_POLL_INTERVAL_MS,
    60_000,
    "VIDEO_CLEANUP_POLL_INTERVAL_MS",
  );
  if (videoCleanupPollIntervalMs < 1_000 || videoCleanupPollIntervalMs > 3_600_000) {
    throw new Error("VIDEO_CLEANUP_POLL_INTERVAL_MS는 1000~3600000ms여야 합니다.");
  }
  const videoCleanupMaxAttempts = positiveInteger(
    env.VIDEO_CLEANUP_MAX_ATTEMPTS,
    5,
    "VIDEO_CLEANUP_MAX_ATTEMPTS",
  );
  if (videoCleanupMaxAttempts > 10) {
    throw new Error("VIDEO_CLEANUP_MAX_ATTEMPTS는 10 이하여야 합니다.");
  }
  const videoCleanupLockTimeoutMs = positiveInteger(
    env.VIDEO_CLEANUP_LOCK_TIMEOUT_MS,
    600_000,
    "VIDEO_CLEANUP_LOCK_TIMEOUT_MS",
  );
  if (videoCleanupLockTimeoutMs < 60_000) {
    throw new Error("VIDEO_CLEANUP_LOCK_TIMEOUT_MS는 60000ms 이상이어야 합니다.");
  }
  const inquiryNotificationPollIntervalMs = positiveInteger(
    env.INQUIRY_NOTIFICATION_POLL_INTERVAL_MS,
    5_000,
    "INQUIRY_NOTIFICATION_POLL_INTERVAL_MS",
  );
  if (inquiryNotificationPollIntervalMs < 1_000 || inquiryNotificationPollIntervalMs > 60_000) {
    throw new Error("INQUIRY_NOTIFICATION_POLL_INTERVAL_MS는 1000~60000ms여야 합니다.");
  }
  const inquiryNotificationMaxAttempts = positiveInteger(
    env.INQUIRY_NOTIFICATION_MAX_ATTEMPTS,
    5,
    "INQUIRY_NOTIFICATION_MAX_ATTEMPTS",
  );
  if (inquiryNotificationMaxAttempts > 10) {
    throw new Error("INQUIRY_NOTIFICATION_MAX_ATTEMPTS는 10 이하여야 합니다.");
  }
  const inquiryNotificationLockTimeoutMs = positiveInteger(
    env.INQUIRY_NOTIFICATION_LOCK_TIMEOUT_MS,
    60_000,
    "INQUIRY_NOTIFICATION_LOCK_TIMEOUT_MS",
  );
  if (inquiryNotificationLockTimeoutMs < 60_000) {
    throw new Error("INQUIRY_NOTIFICATION_LOCK_TIMEOUT_MS는 60000ms 이상이어야 합니다.");
  }
  const videoUploadAbandonedAfterHours = positiveInteger(
    env.VIDEO_UPLOAD_ABANDONED_AFTER_HOURS,
    24,
    "VIDEO_UPLOAD_ABANDONED_AFTER_HOURS",
  );
  if (videoUploadAbandonedAfterHours > 720) {
    throw new Error("VIDEO_UPLOAD_ABANDONED_AFTER_HOURS는 720시간 이하여야 합니다.");
  }
  const videoReplacedRetentionHours = positiveInteger(
    env.VIDEO_REPLACED_RETENTION_HOURS,
    24,
    "VIDEO_REPLACED_RETENTION_HOURS",
  );
  if (videoReplacedRetentionHours > 2_160) {
    throw new Error("VIDEO_REPLACED_RETENTION_HOURS는 2160시간 이하여야 합니다.");
  }
  const hlsTranscodePollIntervalMs = positiveInteger(
    env.HLS_TRANSCODE_POLL_INTERVAL_MS,
    5_000,
    "HLS_TRANSCODE_POLL_INTERVAL_MS",
  );
  if (hlsTranscodePollIntervalMs < 1_000 || hlsTranscodePollIntervalMs > 60_000) {
    throw new Error("HLS_TRANSCODE_POLL_INTERVAL_MS는 1000~60000ms여야 합니다.");
  }
  const hlsTranscodeMaxAttempts = positiveInteger(
    env.HLS_TRANSCODE_MAX_ATTEMPTS,
    3,
    "HLS_TRANSCODE_MAX_ATTEMPTS",
  );
  if (hlsTranscodeMaxAttempts > 10) {
    throw new Error("HLS_TRANSCODE_MAX_ATTEMPTS는 10 이하여야 합니다.");
  }
  const hlsTranscodeLockTimeoutMs = positiveInteger(
    env.HLS_TRANSCODE_LOCK_TIMEOUT_MS,
    14_400_000,
    "HLS_TRANSCODE_LOCK_TIMEOUT_MS",
  );
  if (hlsTranscodeLockTimeoutMs < 60_000) {
    throw new Error("HLS_TRANSCODE_LOCK_TIMEOUT_MS는 60000ms 이상이어야 합니다.");
  }
  const hlsSegmentDurationSeconds = positiveInteger(
    env.HLS_SEGMENT_DURATION_SECONDS,
    6,
    "HLS_SEGMENT_DURATION_SECONDS",
  );
  if (hlsSegmentDurationSeconds < 2 || hlsSegmentDurationSeconds > 10) {
    throw new Error("HLS_SEGMENT_DURATION_SECONDS는 2~10초여야 합니다.");
  }
  const ffmpegPath = env.FFMPEG_PATH?.trim() || "ffmpeg";
  const ffprobePath = env.FFPROBE_PATH?.trim() || "ffprobe";
  if (ffmpegPath.length > 1024 || ffprobePath.length > 1024) {
    throw new Error("FFmpeg 실행 파일 경로가 너무 깁니다.");
  }

  const passwordResetTtlMinutes = positiveInteger(
    env.PASSWORD_RESET_TTL_MINUTES,
    30,
    "PASSWORD_RESET_TTL_MINUTES",
  );
  if (passwordResetTtlMinutes > 1_440) {
    throw new Error("PASSWORD_RESET_TTL_MINUTES는 1440분 이하여야 합니다.");
  }
  const emailVerificationTtlHours = positiveInteger(
    env.EMAIL_VERIFICATION_TTL_HOURS,
    24,
    "EMAIL_VERIFICATION_TTL_HOURS",
  );
  if (emailVerificationTtlHours > 168) {
    throw new Error("EMAIL_VERIFICATION_TTL_HOURS는 168시간 이하여야 합니다.");
  }
  const requestBodyMaxBytes = positiveInteger(
    env.REQUEST_BODY_MAX_BYTES,
    1_048_576,
    "REQUEST_BODY_MAX_BYTES",
  );
  if (requestBodyMaxBytes < 1_024 || requestBodyMaxBytes > 10_485_760) {
    throw new Error("REQUEST_BODY_MAX_BYTES는 1024~10485760바이트여야 합니다.");
  }
  const rateLimitRedisUrl = optionalRedisUrl(env.RATE_LIMIT_REDIS_URL);
  const rateLimitKeyPrefix = env.RATE_LIMIT_KEY_PREFIX?.trim() || "baduk-history:rate-limit:";
  if (!/^[A-Za-z0-9:_-]{1,80}$/u.test(rateLimitKeyPrefix)) {
    throw new Error("RATE_LIMIT_KEY_PREFIX는 영문, 숫자, :, _, - 조합의 1~80자여야 합니다.");
  }
  const rateLimitConnectTimeoutMs = positiveInteger(
    env.RATE_LIMIT_CONNECT_TIMEOUT_MS,
    3_000,
    "RATE_LIMIT_CONNECT_TIMEOUT_MS",
  );
  if (rateLimitConnectTimeoutMs < 500 || rateLimitConnectTimeoutMs > 30_000) {
    throw new Error("RATE_LIMIT_CONNECT_TIMEOUT_MS는 500~30000ms여야 합니다.");
  }

  const databaseUrl = required(env.DATABASE_URL, "DATABASE_URL");
  const smtpSecure = booleanValue(env.SMTP_SECURE, false, "SMTP_SECURE");
  const smtpRequireTls = booleanValue(env.SMTP_REQUIRE_TLS, nodeEnv === "production", "SMTP_REQUIRE_TLS");
  const legalPolicyVersion = optionalLegalPolicyVersion(env.LEGAL_POLICY_VERSION);
  const legalPolicyApprovedAt = optionalIsoTimestamp(env.LEGAL_POLICY_APPROVED_AT, "LEGAL_POLICY_APPROVED_AT");
  const legalPolicyApprovalSha256 = optionalSha256(
    env.LEGAL_POLICY_APPROVAL_SHA256,
    "LEGAL_POLICY_APPROVAL_SHA256",
  );
  if (nodeEnv === "production") {
    const publicUrl = new URL(publicAppUrl);
    if (publicUrl.protocol !== "https:" || publicUrl.username || publicUrl.password) {
      throw new Error("운영 PUBLIC_APP_URL은 자격정보가 없는 HTTPS URL이어야 합니다.");
    }
    for (const origin of corsOrigins) {
      const url = new URL(origin);
      if (url.protocol !== "https:" || url.origin !== origin.replace(/\/$/u, "") || url.username || url.password) {
        throw new Error("운영 CORS_ORIGINS는 HTTPS origin만 허용합니다.");
      }
    }
    const database = new URL(databaseUrl);
    const sslMode = database.searchParams.get("sslmode")?.toLowerCase();
    if (!sslMode || !["require", "verify-ca", "verify-full"].includes(sslMode)) {
      throw new Error("운영 DATABASE_URL에는 sslmode=require, verify-ca 또는 verify-full이 필요합니다.");
    }
    if (rateLimitRedisUrl && new URL(rateLimitRedisUrl).protocol !== "rediss:") {
      throw new Error("운영 RATE_LIMIT_REDIS_URL은 rediss:// TLS 연결이어야 합니다.");
    }
    if (objectStorageEndpoint && new URL(objectStorageEndpoint).protocol !== "https:") {
      throw new Error("운영 OBJECT_STORAGE_ENDPOINT는 HTTPS URL이어야 합니다.");
    }
    if (!smtpSecure && !smtpRequireTls) {
      throw new Error("운영 SMTP는 SMTPS 또는 STARTTLS를 강제해야 합니다.");
    }
    if (legalPolicyVersion !== CURRENT_LEGAL_POLICY_VERSION) {
      throw new Error(`운영 LEGAL_POLICY_VERSION은 ${CURRENT_LEGAL_POLICY_VERSION}이어야 합니다.`);
    }
    if (!legalPolicyApprovedAt) {
      throw new Error("운영 LEGAL_POLICY_APPROVED_AT이 필요합니다.");
    }
    if (Date.parse(legalPolicyApprovedAt) > Date.now()) {
      throw new Error("운영 LEGAL_POLICY_APPROVED_AT은 미래 시각일 수 없습니다.");
    }
    if (!legalPolicyApprovalSha256) {
      throw new Error("운영 LEGAL_POLICY_APPROVAL_SHA256가 필요합니다.");
    }
  }

  return {
    nodeEnv: nodeEnv as AppConfig["nodeEnv"],
    port: positiveInteger(env.PORT, 3000, "PORT"),
    trustProxyHops: nonNegativeInteger(env.TRUST_PROXY_HOPS, 0, "TRUST_PROXY_HOPS"),
    requestBodyMaxBytes,
    rateLimitRedisUrl,
    rateLimitKeyPrefix,
    rateLimitConnectTimeoutMs,
    databaseUrl,
    corsOrigins,
    sessionCookieName: env.SESSION_COOKIE_NAME?.trim() || "baduk_session",
    sessionTtlHours: positiveInteger(env.SESSION_TTL_HOURS, 168, "SESSION_TTL_HOURS"),
    oauthStateTtlMinutes: positiveInteger(env.OAUTH_STATE_TTL_MINUTES, 10, "OAUTH_STATE_TTL_MINUTES"),
    passwordResetTtlMinutes,
    emailVerificationTtlHours,
    publicAppUrl,
    smtpHost,
    smtpPort: positiveInteger(env.SMTP_PORT, 587, "SMTP_PORT"),
    smtpSecure,
    smtpRequireTls,
    smtpUser,
    smtpPassword,
    smtpFrom,
    mailDkimSelector,
    mailBounceWebhookSecret,
    smtpConnectionTimeoutMs: positiveInteger(
      env.SMTP_CONNECTION_TIMEOUT_MS,
      10_000,
      "SMTP_CONNECTION_TIMEOUT_MS",
    ),
    accountMailEncryptionKeyBase64,
    accountMailPollIntervalMs: positiveInteger(
      env.ACCOUNT_MAIL_POLL_INTERVAL_MS,
      5_000,
      "ACCOUNT_MAIL_POLL_INTERVAL_MS",
    ),
    accountMailMaxAttempts: positiveInteger(
      env.ACCOUNT_MAIL_MAX_ATTEMPTS,
      5,
      "ACCOUNT_MAIL_MAX_ATTEMPTS",
    ),
    accountMailLockTimeoutMs: positiveInteger(
      env.ACCOUNT_MAIL_LOCK_TIMEOUT_MS,
      60_000,
      "ACCOUNT_MAIL_LOCK_TIMEOUT_MS",
    ),
    workerHealthBacklogMinutes: positiveInteger(
      env.WORKER_HEALTH_BACKLOG_MINUTES,
      15,
      "WORKER_HEALTH_BACKLOG_MINUTES",
    ),
    operationsMetricsToken,
    legalPolicyVersion,
    legalPolicyApprovedAt,
    legalPolicyApprovalSha256,
    inquiryNotificationPollIntervalMs,
    inquiryNotificationMaxAttempts,
    inquiryNotificationLockTimeoutMs,
    guardianInvitationTtlHours: positiveInteger(
      env.GUARDIAN_INVITATION_TTL_HOURS,
      72,
      "GUARDIAN_INVITATION_TTL_HOURS",
    ),
    tossPaymentsSecretKey: env.TOSS_PAYMENTS_SECRET_KEY?.trim() || null,
    objectStorageEndpoint,
    objectStorageRegion: env.OBJECT_STORAGE_REGION?.trim() || "ap-northeast-2",
    objectStorageBucket,
    objectStorageAccessKeyId,
    objectStorageSecretAccessKey,
    objectStorageForcePathStyle: booleanValue(
      env.OBJECT_STORAGE_FORCE_PATH_STYLE,
      false,
      "OBJECT_STORAGE_FORCE_PATH_STYLE",
    ),
    playbackCdnProvider: cdnProviderValue as "cloudfront" | null,
    playbackCdnBaseUrl,
    playbackCdnKeyPairId,
    playbackCdnPrivateKeyBase64,
    preflightRequireCdn,
    databasePitrEnabled,
    backupRetentionDays,
    objectStorageVersioningEnabled,
    recoveryRpoMinutes,
    recoveryRtoMinutes,
    recoveryDrillLastCompletedAt,
    recoveryDrillMaxAgeDays,
    playbackUrlTtlSeconds,
    videoUploadUrlTtlSeconds,
    videoUploadMaxBytes,
    lessonAssetMaxBytes,
    inquiryAttachmentMaxBytes,
    inquiryAttachmentRetentionHours,
    communityAttachmentMaxBytes,
    communityAttachmentRetentionHours,
    malwareScannerHost: env.MALWARE_SCANNER_HOST?.trim() || null,
    malwareScannerPort: positiveInteger(env.MALWARE_SCANNER_PORT, 3310, "MALWARE_SCANNER_PORT"),
    malwareScannerTimeoutMs: positiveInteger(
      env.MALWARE_SCANNER_TIMEOUT_MS,
      30_000,
      "MALWARE_SCANNER_TIMEOUT_MS",
    ),
    videoScanPollIntervalMs,
    videoScanMaxAttempts,
    videoScanLockTimeoutMs,
    videoCleanupPollIntervalMs,
    videoCleanupMaxAttempts,
    videoCleanupLockTimeoutMs,
    videoUploadAbandonedAfterHours,
    videoReplacedRetentionHours,
    hlsTranscodePollIntervalMs,
    hlsTranscodeMaxAttempts,
    hlsTranscodeLockTimeoutMs,
    hlsSegmentDurationSeconds,
    ffmpegPath,
    ffprobePath,
    logLevel: env.LOG_LEVEL?.trim() || "info",
  };
}
