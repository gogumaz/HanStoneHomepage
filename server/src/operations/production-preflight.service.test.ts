import { afterEach, describe, expect, it, vi } from "vitest";
import { readdirSync } from "node:fs";
import { PrismaService } from "../database/prisma.service.js";
import { AccountMailService } from "../mail/account-mail.service.js";
import { MalwareScannerService } from "../storage/malware-scanner.service.js";
import { MediaDeliveryService } from "../storage/media-delivery.service.js";
import { ObjectStorageService } from "../storage/object-storage.service.js";
import {
  ProductionPreflightService,
  REQUIRED_PRODUCTION_MIGRATION,
} from "./production-preflight.service.js";
import { HlsTranscoderService } from "../content/hls-transcoder.service.js";

function productionEnv(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://user:password@database.example.com:5432/app?sslmode=require",
    CORS_ORIGINS: "https://www.example.com",
    PUBLIC_APP_URL: "https://www.example.com",
    SMTP_HOST: "smtp.example.com",
    SMTP_PORT: "587",
    SMTP_REQUIRE_TLS: "true",
    MAIL_FROM: "바둑타고 <no-reply@example.com>",
    MAIL_DKIM_SELECTOR: "mail2026",
    MAIL_BOUNCE_WEBHOOK_SECRET: "bounce_webhook_secret_1234567890_abcd",
    OBJECT_STORAGE_BUCKET: "private-media",
    MALWARE_SCANNER_HOST: "clamav.internal",
    TOSS_PAYMENTS_SECRET_KEY: "toss-secret",
    NAVER_CLIENT_ID: "naver-id",
    NAVER_CLIENT_SECRET: "naver-secret",
    NAVER_REDIRECT_URI: "https://api.example.com/api/v1/auth/oauth/naver/callback",
    KAKAO_REST_API_KEY: "kakao-key",
    KAKAO_CLIENT_SECRET: "kakao-secret",
    KAKAO_REDIRECT_URI: "https://api.example.com/api/v1/auth/oauth/kakao/callback",
    GOOGLE_CLIENT_ID: "google-id",
    GOOGLE_CLIENT_SECRET: "google-secret",
    GOOGLE_REDIRECT_URI: "https://api.example.com/api/v1/auth/oauth/google/callback",
    RATE_LIMIT_REDIS_URL: "rediss://redis.example.com:6380/0",
    DATABASE_PITR_ENABLED: "true",
    BACKUP_RETENTION_DAYS: "30",
    OBJECT_STORAGE_VERSIONING_ENABLED: "true",
    RECOVERY_RPO_MINUTES: "15",
    RECOVERY_RTO_MINUTES: "240",
    RECOVERY_DRILL_LAST_COMPLETED_AT: new Date(Date.now() - 7 * 24 * 60 * 60 * 1_000).toISOString(),
    RECOVERY_DRILL_MAX_AGE_DAYS: "100",
    ACCOUNT_MAIL_ENCRYPTION_KEY_BASE64: Buffer.alloc(32, 7).toString("base64"),
    OPERATIONS_METRICS_TOKEN: "metrics_token_1234567890_abcdefghij",
    DEPLOYMENT_COMMIT_SHA: "a".repeat(40),
    DEPLOYMENT_IMAGE_DIGEST: `sha256:${"a".repeat(64)}`,
    LEGAL_POLICY_VERSION: "guardian-link-v1",
    LEGAL_POLICY_APPROVED_AT: "2026-08-01T00:00:00.000Z",
    LEGAL_POLICY_APPROVAL_SHA256: "b".repeat(64),
  };
}

function harness(
  storageError?: Error,
  cdnProvider: "disabled" | "cloudfront" = "disabled",
  migrationApplied = true,
) {
  const prisma = {
    $queryRaw: vi.fn(async (query: TemplateStringsArray) => query.join("?").includes("_prisma_migrations")
      ? (migrationApplied ? [{ migration_name: REQUIRED_PRODUCTION_MIGRATION }] : [])
      : [{ value: 1 }]),
    objectDeletionJob: { count: vi.fn(async () => 0) },
    oAuthLoginAttempt: { findFirst: vi.fn(async () => null) },
    badukMission: { findFirst: vi.fn(async () => null) },
    rewardGrant: { findFirst: vi.fn(async () => null) },
    missionFavorite: { findFirst: vi.fn(async () => null) },
    consultation: { findFirst: vi.fn(async () => null) },
    inquiry: { findFirst: vi.fn(async () => null) },
    inquiryNotificationJob: { findFirst: vi.fn(async () => null) },
    userNotification: { findFirst: vi.fn(async () => null) },
    inquiryAttachment: { findFirst: vi.fn(async () => null) },
    editorialContent: { findFirst: vi.fn(async () => null) },
    communityPost: { findFirst: vi.fn(async () => null) },
    communityPostReport: { findFirst: vi.fn(async () => null) },
    communityAttachment: { findFirst: vi.fn(async () => null) },
    teachingMaterial: { findFirst: vi.fn(async () => null) },
    teachingMaterialAsset: { findFirst: vi.fn(async () => null) },
    teachingMaterialRevision: { findFirst: vi.fn(async () => null) },
    classHelper: { findFirst: vi.fn(async () => null) },
    classHelperAsset: { findFirst: vi.fn(async () => null) },
    classHelperRevision: { findFirst: vi.fn(async () => null) },
    storeProduct: { findFirst: vi.fn(async () => null) },
    storeOrder: { findFirst: vi.fn(async () => null) },
    storeCartItem: { findFirst: vi.fn(async () => null) },
    accountMailJob: { findFirst: vi.fn(async () => null) },
    organizationMembership: { findFirst: vi.fn(async () => null) },
    organizationClassTeacherAssignment: { findFirst: vi.fn(async () => null) },
  };
  const storage = {
    verifyVideoStorageAccess: storageError
      ? vi.fn(async () => { throw storageError; })
      : vi.fn(async () => undefined),
  };
  const scanner = {
    scan: vi.fn(async () => ({ clean: true, provider: "clamav", result: "OK" })),
  };
  const mail = {
    verifyConnection: vi.fn(async () => undefined),
    verifyDomainAuthentication: vi.fn(async () => ({
      domain: "example.com",
      dkimSelector: "mail2026",
      dmarcPolicy: "reject" as const,
      domainSha256: "1".repeat(64),
      dkimSelectorSha256: "2".repeat(64),
      dnsRecordsSha256: "3".repeat(64),
    })),
  };
  const delivery = { verifyCdnConnection: vi.fn(async () => cdnProvider) };
  const transcoder = { verifyBinaries: vi.fn(async () => undefined) };
  const rateLimitStore = {
    consume: vi.fn(),
    verifyConnection: vi.fn(async () => "redis" as const),
    close: vi.fn(async () => undefined),
  };
  return {
    service: new ProductionPreflightService(
      prisma as unknown as PrismaService,
      storage as unknown as ObjectStorageService,
      delivery as unknown as MediaDeliveryService,
      transcoder as unknown as HlsTranscoderService,
      scanner as unknown as MalwareScannerService,
      mail as unknown as AccountMailService,
      rateLimitStore,
    ),
    prisma,
    storage,
    delivery,
    transcoder,
    scanner,
    mail,
    rateLimitStore,
  };
}

describe("ProductionPreflightService", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps the production schema gate aligned with the newest migration", () => {
    const migrations = readdirSync(new URL("../../prisma/migrations/", import.meta.url), {
      withFileTypes: true,
    })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    expect(REQUIRED_PRODUCTION_MIGRATION).toBe(migrations.at(-1));
  });

  it("checks configuration and every external dependency without business mutations", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      code: 0,
      response: { access_token: "preflight-access-token" },
    }), { status: 200 })));
    const test = harness();

    const report = await test.service.run(productionEnv());

    expect(report.ok).toBe(true);
    expect(report.checks).toHaveLength(9);
    expect(report.checks.every((check) => check.status === "pass")).toBe(true);
    expect(report.checks.find((check) => check.name === "smtp")?.detail).toContain("messageSent=false");
    expect(test.storage.verifyVideoStorageAccess).toHaveBeenCalledOnce();
    expect(report.checks.find((check) => check.name === "objectStorage")?.detail)
      .toBe("put=get=delete=ok; anonymousRead=denied");
    expect(test.delivery.verifyCdnConnection).toHaveBeenCalledOnce();
    expect(test.transcoder.verifyBinaries).toHaveBeenCalledOnce();
    expect(report.checks.find((check) => check.name === "cdn")?.detail).toBe("disabled");
    expect(report.checks.find((check) => check.name === "recoveryPolicy")?.detail)
      .toContain("databasePitr=declared");
    expect(test.scanner.scan).toHaveBeenCalledOnce();
    expect(test.mail.verifyConnection).toHaveBeenCalledOnce();
    expect(test.mail.verifyDomainAuthentication).toHaveBeenCalledOnce();
    expect(test.rateLimitStore.verifyConnection).toHaveBeenCalledOnce();
    expect(test.prisma.$queryRaw).toHaveBeenCalledWith(
      expect.arrayContaining([expect.stringContaining("_prisma_migrations")]),
      REQUIRED_PRODUCTION_MIGRATION,
    );
    expect(test.prisma.oAuthLoginAttempt.findFirst).toHaveBeenCalledOnce();
    expect(test.prisma.badukMission.findFirst).toHaveBeenCalledOnce();
    expect(test.prisma.rewardGrant.findFirst).toHaveBeenCalledOnce();
    expect(test.prisma.missionFavorite.findFirst).toHaveBeenCalledOnce();
    expect(test.prisma.consultation.findFirst).toHaveBeenCalledOnce();
    expect(test.prisma.inquiry.findFirst).toHaveBeenCalledOnce();
    expect(test.prisma.inquiryNotificationJob.findFirst).toHaveBeenCalledOnce();
    expect(test.prisma.userNotification.findFirst).toHaveBeenCalledOnce();
    expect(test.prisma.inquiryAttachment.findFirst).toHaveBeenCalledOnce();
    expect(test.prisma.editorialContent.findFirst).toHaveBeenCalledOnce();
    expect(test.prisma.communityPost.findFirst).toHaveBeenCalledOnce();
    expect(test.prisma.communityPostReport.findFirst).toHaveBeenCalledOnce();
    expect(test.prisma.communityAttachment.findFirst).toHaveBeenCalledOnce();
    expect(test.prisma.teachingMaterial.findFirst).toHaveBeenCalledOnce();
    expect(test.prisma.teachingMaterialAsset.findFirst).toHaveBeenCalledOnce();
    expect(test.prisma.classHelper.findFirst).toHaveBeenCalledOnce();
    expect(test.prisma.classHelperAsset.findFirst).toHaveBeenCalledOnce();
    expect(test.prisma.accountMailJob.findFirst).toHaveBeenCalledOnce();
    expect(report.checks.find((check) => check.name === "database")?.detail)
      .toContain(`migration=${REQUIRED_PRODUCTION_MIGRATION}`);
    expect(JSON.stringify(report)).not.toContain("preflight-access-token");
  });

  it("reports individual failures while completing the remaining checks", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      code: 0,
      response: { access_token: "token" },
    }), { status: 200 })));
    const test = harness(new Error("storage unavailable with secret detail"));

    const report = await test.service.run(productionEnv());

    expect(report.ok).toBe(false);
    expect(report.checks.find((check) => check.name === "objectStorage")).toMatchObject({
      status: "fail",
      detail: "Error",
    });
    expect(report.checks.filter((check) => check.status === "pass")).toHaveLength(8);
    expect(JSON.stringify(report)).not.toContain("secret detail");
  });

  it("requires and verifies CDN delivery when production policy enables it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      code: 0,
      response: { access_token: "token" },
    }), { status: 200 })));
    const env = {
      ...productionEnv(),
      PLAYBACK_CDN_PROVIDER: "cloudfront",
      PLAYBACK_CDN_BASE_URL: "https://media.example.com",
      PLAYBACK_CDN_KEY_PAIR_ID: "KTEST123",
      PLAYBACK_CDN_PRIVATE_KEY_BASE64: Buffer.from("test-key").toString("base64"),
      PREFLIGHT_REQUIRE_CDN: "true",
    };

    const report = await harness(undefined, "cloudfront").service.run(env);

    expect(report.ok).toBe(true);
    expect(report.checks.find((check) => check.name === "cdn")?.detail)
      .toBe("provider=cloudfront; signedFetch=ok; probeDeleted=true");
    expect(JSON.stringify(report)).not.toContain(env.PLAYBACK_CDN_PRIVATE_KEY_BASE64);
  });

  it("fails configuration when a required OAuth provider is absent", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      code: 0,
      response: { access_token: "token" },
    }), { status: 200 })));
    const env = productionEnv();
    delete env.GOOGLE_CLIENT_ID;
    delete env.GOOGLE_CLIENT_SECRET;
    delete env.GOOGLE_REDIRECT_URI;

    const report = await harness().service.run(env);

    expect(report.ok).toBe(false);
    expect(report.checks.find((check) => check.name === "configuration")).toMatchObject({
      status: "fail",
      detail: "OAUTH_PROVIDERS_MISSING",
    });
  });

  it.each([
    ["MAIL_DKIM_SELECTOR", "MAIL_DKIM_SELECTOR_REQUIRED"],
    ["MAIL_BOUNCE_WEBHOOK_SECRET", "MAIL_BOUNCE_WEBHOOK_SECRET_REQUIRED"],
  ])("requires the production mail control %s", async (key, code) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      code: 0,
      response: { access_token: "token" },
    }), { status: 200 })));
    const env = productionEnv();
    delete env[key];

    const report = await harness().service.run(env);

    expect(report.checks.find((check) => check.name === "configuration")).toMatchObject({
      status: "fail",
      detail: code,
    });
  });

  it("reports a mail authentication DNS failure without leaking DNS details", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      code: 0,
      response: { access_token: "token" },
    }), { status: 200 })));
    const test = harness();
    const failure = new Error("private resolver response");
    failure.name = "MAIL_SPF_MISSING";
    test.mail.verifyDomainAuthentication.mockRejectedValueOnce(failure);

    const report = await test.service.run(productionEnv());

    expect(report.checks.find((check) => check.name === "smtp")).toMatchObject({
      status: "fail",
      detail: "MAIL_SPF_MISSING",
    });
    expect(JSON.stringify(report)).not.toContain("private resolver response");
  });

  it("requires Redis and reports connection failures without leaking details", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      code: 0,
      response: { access_token: "token" },
    }), { status: 200 })));
    const missingEnv = productionEnv();
    delete missingEnv.RATE_LIMIT_REDIS_URL;
    const missingReport = await harness().service.run(missingEnv);
    expect(missingReport.checks.find((check) => check.name === "configuration")).toMatchObject({
      status: "fail",
      detail: "RATE_LIMIT_REDIS_REQUIRED",
    });

    const unavailable = harness();
    unavailable.rateLimitStore.verifyConnection.mockRejectedValueOnce(
      new Error("redis unavailable at secret.internal"),
    );
    const unavailableReport = await unavailable.service.run(productionEnv());
    expect(unavailableReport.checks.find((check) => check.name === "rateLimitStore")).toMatchObject({
      status: "fail",
      detail: "Error",
    });
    expect(JSON.stringify(unavailableReport)).not.toContain("secret.internal");
  });

  it("rejects an expired recovery drill and missing storage versioning", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      code: 0,
      response: { access_token: "token" },
    }), { status: 200 })));
    const expired = {
      ...productionEnv(),
      RECOVERY_DRILL_LAST_COMPLETED_AT: new Date(Date.now() - 101 * 24 * 60 * 60 * 1_000).toISOString(),
    };
    const expiredReport = await harness().service.run(expired);
    expect(expiredReport.checks.find((check) => check.name === "recoveryPolicy")).toMatchObject({
      status: "fail",
      detail: "RECOVERY_DRILL_EXPIRED",
    });

    const versioningMissing = productionEnv();
    versioningMissing.OBJECT_STORAGE_VERSIONING_ENABLED = "false";
    const versioningReport = await harness().service.run(versioningMissing);
    expect(versioningReport.checks.find((check) => check.name === "recoveryPolicy")).toMatchObject({
      status: "fail",
      detail: "OBJECT_STORAGE_VERSIONING_REQUIRED",
    });
  });

  it("fails the database check when the latest required migration is not applied", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      code: 0,
      response: { access_token: "token" },
    }), { status: 200 })));
    const test = harness(undefined, "disabled", false);

    const report = await test.service.run(productionEnv());

    expect(report.ok).toBe(false);
    expect(report.checks.find((check) => check.name === "database")).toMatchObject({
      status: "fail",
      detail: "DATABASE_MIGRATION_REQUIRED",
    });
    expect(test.prisma.oAuthLoginAttempt.findFirst).not.toHaveBeenCalled();
    expect(test.prisma.badukMission.findFirst).not.toHaveBeenCalled();
    expect(test.prisma.rewardGrant.findFirst).not.toHaveBeenCalled();
    expect(test.prisma.missionFavorite.findFirst).not.toHaveBeenCalled();
  });
});
