import { afterEach, describe, expect, it, vi } from "vitest";
import { PrismaService } from "../database/prisma.service.js";
import { AccountMailService } from "../mail/account-mail.service.js";
import { MalwareScannerService } from "../storage/malware-scanner.service.js";
import { MediaDeliveryService } from "../storage/media-delivery.service.js";
import { ObjectStorageService } from "../storage/object-storage.service.js";
import { ProductionPreflightService } from "./production-preflight.service.js";
import { HlsTranscoderService } from "../content/hls-transcoder.service.js";

function productionEnv(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://user:password@database.example.com:5432/app",
    CORS_ORIGINS: "https://www.example.com",
    PUBLIC_APP_URL: "https://www.example.com",
    SMTP_HOST: "smtp.example.com",
    SMTP_PORT: "587",
    SMTP_REQUIRE_TLS: "true",
    MAIL_FROM: "바둑타고 <no-reply@example.com>",
    OBJECT_STORAGE_BUCKET: "private-media",
    MALWARE_SCANNER_HOST: "clamav.internal",
    PORTONE_V1_REST_API_KEY: "portone-key",
    PORTONE_V1_REST_API_SECRET: "portone-secret",
    NAVER_CLIENT_ID: "naver-id",
    NAVER_CLIENT_SECRET: "naver-secret",
    NAVER_REDIRECT_URI: "https://api.example.com/api/v1/auth/oauth/naver/callback",
    KAKAO_REST_API_KEY: "kakao-key",
    KAKAO_CLIENT_SECRET: "kakao-secret",
    KAKAO_REDIRECT_URI: "https://api.example.com/api/v1/auth/oauth/kakao/callback",
    GOOGLE_CLIENT_ID: "google-id",
    GOOGLE_CLIENT_SECRET: "google-secret",
    GOOGLE_REDIRECT_URI: "https://api.example.com/api/v1/auth/oauth/google/callback",
  };
}

function harness(storageError?: Error, cdnProvider: "disabled" | "cloudfront" = "disabled") {
  const prisma = {
    $queryRawUnsafe: vi.fn(async () => [{ value: 1 }]),
    objectDeletionJob: { count: vi.fn(async () => 0) },
  };
  const storage = {
    verifyVideoStorageAccess: storageError
      ? vi.fn(async () => { throw storageError; })
      : vi.fn(async () => undefined),
  };
  const scanner = {
    scan: vi.fn(async () => ({ clean: true, provider: "clamav", result: "OK" })),
  };
  const mail = { verifyConnection: vi.fn(async () => undefined) };
  const delivery = { verifyCdnConnection: vi.fn(async () => cdnProvider) };
  const transcoder = { verifyBinaries: vi.fn(async () => undefined) };
  return {
    service: new ProductionPreflightService(
      prisma as unknown as PrismaService,
      storage as unknown as ObjectStorageService,
      delivery as unknown as MediaDeliveryService,
      transcoder as unknown as HlsTranscoderService,
      scanner as unknown as MalwareScannerService,
      mail as unknown as AccountMailService,
    ),
    prisma,
    storage,
    delivery,
    transcoder,
    scanner,
    mail,
  };
}

describe("ProductionPreflightService", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("checks configuration and every external dependency without business mutations", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      code: 0,
      response: { access_token: "preflight-access-token" },
    }), { status: 200 })));
    const test = harness();

    const report = await test.service.run(productionEnv());

    expect(report.ok).toBe(true);
    expect(report.checks).toHaveLength(8);
    expect(report.checks.every((check) => check.status === "pass")).toBe(true);
    expect(report.checks.find((check) => check.name === "smtp")?.detail).toContain("messageSent=false");
    expect(report.checks.find((check) => check.name === "portone")?.detail).toContain("paymentMutation=false");
    expect(test.storage.verifyVideoStorageAccess).toHaveBeenCalledOnce();
    expect(test.delivery.verifyCdnConnection).toHaveBeenCalledOnce();
    expect(test.transcoder.verifyBinaries).toHaveBeenCalledOnce();
    expect(report.checks.find((check) => check.name === "cdn")?.detail).toBe("disabled");
    expect(test.scanner.scan).toHaveBeenCalledOnce();
    expect(test.mail.verifyConnection).toHaveBeenCalledOnce();
    expect(JSON.stringify(report)).not.toContain("portone-secret");
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
    expect(report.checks.filter((check) => check.status === "pass")).toHaveLength(7);
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
});
