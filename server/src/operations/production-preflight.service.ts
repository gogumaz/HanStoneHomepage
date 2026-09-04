import { loadOAuthComponentOptions } from "../auth/oauth-options.js";
import { ApiError } from "../common/api-error.js";
import { PaymentComponentError } from "../components/payments/payment-provider.js";
import { loadAppConfig } from "../config/app-config.js";
import { PrismaService } from "../database/prisma.service.js";
import { AccountMailService } from "../mail/account-mail.service.js";
import { MalwareScannerService } from "../storage/malware-scanner.service.js";
import { MediaDeliveryService } from "../storage/media-delivery.service.js";
import { HlsTranscoderService } from "../content/hls-transcoder.service.js";
import { ObjectStorageService } from "../storage/object-storage.service.js";
import type { RateLimitStore } from "../common/rate-limit.store.js";
import { loadReleaseIdentity } from "./release-identity.js";

export type PreflightCheckName =
  | "configuration"
  | "recoveryPolicy"
  | "database"
  | "rateLimitStore"
  | "objectStorage"
  | "cdn"
  | "hlsTranscoder"
  | "malwareScanner"
  | "smtp";

export type PreflightCheck = {
  name: PreflightCheckName;
  status: "pass" | "fail";
  durationMs: number;
  detail: string;
};

export type ProductionPreflightReport = {
  ok: boolean;
  checkedAt: string;
  checks: PreflightCheck[];
};

export const REQUIRED_PRODUCTION_MIGRATION = "20260904000100_mission_era_catalog";

class ConfigurationError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "ConfigurationError";
  }
}

function errorCode(error: unknown): string {
  if (error instanceof ConfigurationError) return error.code;
  if (error instanceof ApiError || error instanceof PaymentComponentError) return error.code;
  if (error instanceof Error && error.name) return error.name.slice(0, 100);
  return "PREFLIGHT_CHECK_FAILED";
}

function requiredOAuthProviders(env: NodeJS.ProcessEnv): Array<"naver" | "kakao" | "google"> {
  const raw = env.PREFLIGHT_REQUIRED_OAUTH_PROVIDERS
    ?? (env.NODE_ENV === "production" ? "naver,kakao,google" : "");
  const providers = raw.split(",").map((value) => value.trim()).filter(Boolean);
  const allowed = new Set(["naver", "kakao", "google"]);
  if (providers.some((provider) => !allowed.has(provider))) {
    throw new ConfigurationError("PREFLIGHT_OAUTH_PROVIDER_INVALID");
  }
  return [...new Set(providers)] as Array<"naver" | "kakao" | "google">;
}

export class ProductionPreflightService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorageService,
    private readonly delivery: MediaDeliveryService,
    private readonly transcoder: HlsTranscoderService,
    private readonly scanner: MalwareScannerService,
    private readonly mail: AccountMailService,
    private readonly rateLimitStore: RateLimitStore,
  ) {}

  async run(env: NodeJS.ProcessEnv = process.env): Promise<ProductionPreflightReport> {
    const config = loadAppConfig(env);
    const checks = await Promise.all([
      this.check("configuration", async () => {
        loadReleaseIdentity(env);
        const oauth = loadOAuthComponentOptions(env);
        const configuredProviders = Object.keys(oauth.providers);
        const missingProviders = requiredOAuthProviders(env)
          .filter((provider) => !(provider in oauth.providers));
        if (missingProviders.length > 0) throw new ConfigurationError("OAUTH_PROVIDERS_MISSING");
        if (!config.tossPaymentsSecretKey) {
          throw new ConfigurationError("TOSS_PAYMENTS_NOT_CONFIGURED");
        }
        if (!config.accountMailEncryptionKeyBase64) {
          throw new ConfigurationError("ACCOUNT_MAIL_QUEUE_KEY_REQUIRED");
        }
        if (!config.mailDkimSelector) {
          throw new ConfigurationError("MAIL_DKIM_SELECTOR_REQUIRED");
        }
        if (!config.mailBounceWebhookSecret) {
          throw new ConfigurationError("MAIL_BOUNCE_WEBHOOK_SECRET_REQUIRED");
        }
        if (!config.operationsMetricsToken) {
          throw new ConfigurationError("OPERATIONS_METRICS_TOKEN_REQUIRED");
        }
        if (!config.rateLimitRedisUrl) {
          throw new ConfigurationError("RATE_LIMIT_REDIS_REQUIRED");
        }
        if (config.nodeEnv === "production" && new URL(config.publicAppUrl).protocol !== "https:") {
          throw new ConfigurationError("PUBLIC_APP_URL_HTTPS_REQUIRED");
        }
        if (config.nodeEnv === "production" && Object.values(oauth.providers).some(
          (provider) => new URL(provider.redirectUri).protocol !== "https:",
        )) {
          throw new ConfigurationError("OAUTH_REDIRECT_HTTPS_REQUIRED");
        }
        if (!config.corsOrigins.includes(new URL(config.publicAppUrl).origin)) {
          throw new ConfigurationError("PUBLIC_APP_ORIGIN_NOT_ALLOWED_BY_CORS");
        }
        return [
          `oauth=${configuredProviders.sort().join(",") || "none"}`,
          "tossPayments=configured",
          `legalPolicy=${config.legalPolicyVersion}`,
          `legalApprovedAt=${config.legalPolicyApprovedAt}`,
          "legalApprovalSha256=verified",
        ].join("; ");
      }),
      this.check("recoveryPolicy", async () => {
        if (!config.databasePitrEnabled) throw new ConfigurationError("DATABASE_PITR_REQUIRED");
        if (config.backupRetentionDays < 30) throw new ConfigurationError("BACKUP_RETENTION_INSUFFICIENT");
        if (!config.objectStorageVersioningEnabled) {
          throw new ConfigurationError("OBJECT_STORAGE_VERSIONING_REQUIRED");
        }
        if (config.recoveryRpoMinutes > 15) throw new ConfigurationError("RECOVERY_RPO_TOO_HIGH");
        if (config.recoveryRtoMinutes > 240) throw new ConfigurationError("RECOVERY_RTO_TOO_HIGH");
        if (!config.recoveryDrillLastCompletedAt) throw new ConfigurationError("RECOVERY_DRILL_REQUIRED");
        const drillAgeMs = Date.now() - Date.parse(config.recoveryDrillLastCompletedAt);
        if (drillAgeMs < 0) throw new ConfigurationError("RECOVERY_DRILL_TIMESTAMP_INVALID");
        if (drillAgeMs > config.recoveryDrillMaxAgeDays * 24 * 60 * 60 * 1_000) {
          throw new ConfigurationError("RECOVERY_DRILL_EXPIRED");
        }
        return [
          "databasePitr=declared",
          `retentionDays=${config.backupRetentionDays}`,
          "objectVersioning=declared",
          `rpoMinutes=${config.recoveryRpoMinutes}`,
          `rtoMinutes=${config.recoveryRtoMinutes}`,
          `drillCompletedAt=${config.recoveryDrillLastCompletedAt}`,
        ].join("; ");
      }),
      this.check("database", async () => {
        await this.prisma.$queryRaw`SELECT 1`;
        const migrations = await this.prisma.$queryRaw<Array<{ migration_name: string }>>`
          SELECT "migration_name"
           FROM "_prisma_migrations"
           WHERE "migration_name" = ${REQUIRED_PRODUCTION_MIGRATION}
             AND "finished_at" IS NOT NULL
             AND "rolled_back_at" IS NULL
           LIMIT 1`;
        if (migrations.length === 0) {
          throw new ConfigurationError("DATABASE_MIGRATION_REQUIRED");
        }
        await Promise.all([
          this.prisma.objectDeletionJob.count(),
          this.prisma.oAuthLoginAttempt.findFirst({
            select: { purpose: true, userId: true },
          }),
          this.prisma.badukMission.findFirst({
            select: { rewardId: true, rewardQuantity: true },
          }),
          this.prisma.rewardGrant.findFirst({
            select: { rewardTypeSnapshot: true, rewardTitleSnapshot: true },
          }),
          this.prisma.missionFavorite.findFirst({
            select: { userId: true, missionId: true },
          }),
          this.prisma.consultation.findFirst({
            select: { privacyConsentVersion: true, status: true },
          }),
          this.prisma.inquiry.findFirst({
            select: { requesterUserId: true, status: true, answeredAt: true, answerVersion: true },
          }),
          this.prisma.inquiryNotificationJob.findFirst({
            select: { inquiryId: true, answerVersion: true, status: true, nextAttemptAt: true },
          }),
          this.prisma.userNotification.findFirst({ select: { userId: true, kind: true, readAt: true } }),
          this.prisma.inquiryAttachment.findFirst({
            select: { ownerUserId: true, inquiryId: true, status: true, scannedAt: true },
          }),
          this.prisma.editorialContent.findFirst({
            select: { type: true, status: true, publishedAt: true },
          }),
          this.prisma.communityPost.findFirst({
            select: { type: true, authorUserId: true, status: true, publicationConsentVersion: true },
          }),
          this.prisma.communityPostReport.findFirst({
            select: { postId: true, reporterUserId: true, reason: true, status: true, resolution: true },
          }),
          this.prisma.communityAttachment.findFirst({
            select: { ownerUserId: true, postId: true, kind: true, status: true, scannedAt: true },
          }),
          this.prisma.teachingMaterial.findFirst({
            select: { lessonId: true, accessLevel: true, status: true, publishedAt: true, revision: true },
          }),
          this.prisma.teachingMaterialAsset.findFirst({
            select: { ownerUserId: true, materialId: true, status: true, scannedAt: true, detachedAt: true },
          }),
          this.prisma.teachingMaterialRevision.findFirst({ select: { materialId: true, revision: true, changedById: true } }),
          this.prisma.classHelper.findFirst({
            select: { lessonId: true, badukMissionId: true, status: true, publishedAt: true, revision: true },
          }),
          this.prisma.classHelperAsset.findFirst({
            select: { ownerUserId: true, classHelperId: true, kind: true, status: true, scannedAt: true, detachedAt: true },
          }),
          this.prisma.classHelperRevision.findFirst({ select: { classHelperId: true, revision: true, changedById: true } }),
          this.prisma.storeProduct.findFirst({
            select: { active: true, price: true, requiresShipping: true, stockQuantity: true, sortOrder: true },
          }),
          this.prisma.storeOrder.findFirst({
            select: {
              userId: true, status: true, providerPaymentId: true, recipientName: true, postalCode: true,
              inventoryReservedAt: true, inventoryReleasedAt: true,
            },
          }),
          this.prisma.storeCartItem.findFirst({ select: { userId: true, productId: true, quantity: true } }),
          this.prisma.accountMailJob.findFirst({ select: { tokenId: true, kind: true, status: true, nextAttemptAt: true } }),
          this.prisma.organizationMembership.findFirst({
            select: { organizationId: true, userId: true, role: true, status: true, startsAt: true, endsAt: true },
          }),
          this.prisma.organizationClassTeacherAssignment.findFirst({
            select: { organizationClassId: true, teacherMembershipId: true, startsAt: true, endsAt: true },
          }),
        ]);
        return `connection=ok; migration=${REQUIRED_PRODUCTION_MIGRATION}; featureSchema=ok`;
      }),
      this.check("rateLimitStore", async () => {
        const provider = await this.rateLimitStore.verifyConnection();
        if (provider !== "redis") throw new ConfigurationError("RATE_LIMIT_REDIS_REQUIRED");
        return "provider=redis; atomicIncrement=ok; expiry=ok; probeDeleted=true";
      }),
      this.check("objectStorage", async () => {
        await this.storage.verifyVideoStorageAccess();
        return "put=get=delete=ok; anonymousRead=denied";
      }),
      this.check("cdn", async () => {
        const provider = await this.delivery.verifyCdnConnection();
        if (config.preflightRequireCdn && provider === "disabled") {
          throw new ConfigurationError("CDN_NOT_CONFIGURED");
        }
        return provider === "disabled"
          ? "disabled"
          : `provider=${provider}; signedFetch=ok; probeDeleted=true`;
      }),
      this.check("hlsTranscoder", async () => {
        await this.transcoder.verifyBinaries();
        return "ffmpeg=ok; ffprobe=ok; mutation=false";
      }),
      this.check("malwareScanner", async () => {
        const result = await this.scanner.scan(new TextEncoder().encode("baduk-history-preflight"));
        if (!result.clean) throw new ConfigurationError("MALWARE_SCANNER_UNEXPECTED_DETECTION");
        return `provider=${result.provider}; result=${result.result}`;
      }),
      this.check("smtp", async () => {
        await this.mail.verifyConnection();
        const dns = await this.mail.verifyDomainAuthentication();
        return [
          "dns=spf+dkim+dmarc",
          `dmarcPolicy=${dns.dmarcPolicy}`,
          `domainSha256=${dns.domainSha256}`,
          `dkimSelectorSha256=${dns.dkimSelectorSha256}`,
          `dnsRecordsSha256=${dns.dnsRecordsSha256}`,
          "tcp=tls=auth=ok",
          "bounceWebhook=configured",
          "messageSent=false",
        ].join("; ");
      }),
    ]);
    return {
      ok: checks.every((check) => check.status === "pass"),
      checkedAt: new Date().toISOString(),
      checks,
    };
  }

  private async check(
    name: PreflightCheckName,
    operation: () => Promise<string>,
  ): Promise<PreflightCheck> {
    const startedAt = Date.now();
    try {
      const detail = await operation();
      return {
        name,
        status: "pass",
        durationMs: Date.now() - startedAt,
        detail,
      };
    } catch (error) {
      return {
        name,
        status: "fail",
        durationMs: Date.now() - startedAt,
        detail: errorCode(error),
      };
    }
  }
}
