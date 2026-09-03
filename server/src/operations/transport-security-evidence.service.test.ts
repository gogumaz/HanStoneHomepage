import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  TransportSecurityEvidenceService,
  type TransportSecurityEvidenceInput,
} from "./transport-security-evidence.service.js";

const now = new Date("2026-08-31T09:00:00.000Z");
const commitSha = "a".repeat(40);

function environment(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "production",
    PUBLIC_APP_URL: "https://www.example.com",
    CORS_ORIGINS: "https://www.example.com",
    DATABASE_URL: "postgresql://private:password@db.example.com/app?sslmode=verify-full",
    RATE_LIMIT_REDIS_URL: "rediss://private:password@redis.example.com:6380/0",
    NAVER_REDIRECT_URI: "https://api.example.com/api/v1/auth/oauth/naver/callback",
    KAKAO_REDIRECT_URI: "https://api.example.com/api/v1/auth/oauth/kakao/callback",
    GOOGLE_REDIRECT_URI: "https://api.example.com/api/v1/auth/oauth/google/callback",
    OBJECT_STORAGE_BUCKET: "private-bucket",
    OBJECT_STORAGE_REGION: "ap-northeast-2",
    OBJECT_STORAGE_ENDPOINT: "https://objects.example.com",
    PLAYBACK_CDN_BASE_URL: "https://media.example.com",
    PREFLIGHT_REQUIRE_CDN: "true",
    SMTP_PORT: "587",
    SMTP_SECURE: "false",
    SMTP_REQUIRE_TLS: "true",
  };
}

function validInput(): TransportSecurityEvidenceInput {
  return {
    releaseId: "release-2026.08.31",
    environment: environment(),
    environmentSha256: "1".repeat(64),
    preflightSha256: "2".repeat(64),
    deploymentVerificationSha256: "3".repeat(64),
    apiBaseUrl: "https://api.example.com",
    webBaseUrl: "https://www.example.com",
    maximumAgeHours: 24,
    minimumCertificateValidityDays: 14,
    tlsEndpoints: {
      api: {
        originSha256: createHash("sha256").update("https://api.example.com").digest("hex"),
        protocol: "TLSv1.3",
        certificateSha256: "4".repeat(64),
        validFrom: "2026-08-01T00:00:00.000Z",
        validTo: "2026-12-01T00:00:00.000Z",
      },
      web: {
        originSha256: createHash("sha256").update("https://www.example.com").digest("hex"),
        protocol: "TLSv1.2",
        certificateSha256: "5".repeat(64),
        validFrom: "2026-08-01T00:00:00.000Z",
        validTo: "2026-12-01T00:00:00.000Z",
      },
    },
    preflight: {
      ok: true,
      checkedAt: "2026-08-31T08:00:00.000Z",
      evidenceCommitSha: commitSha,
      checks: ["configuration", "database", "rateLimitStore", "objectStorage", "cdn", "smtp"]
        .map((name) => ({ name, status: "pass", detail: "ok" })),
      privateDetail: "postgresql://private:password@db.example.com/app",
    },
    deploymentVerification: {
      releaseId: "release-2026.08.31",
      ok: true,
      rollbackRecommended: false,
      completedAt: "2026-08-31T08:30:00.000Z",
      expected: { commitSha, imageDigest: `sha256:${"b".repeat(64)}` },
      web: { ok: true, checks: [{ name: "manifestSha256", status: "pass", code: "OK" }] },
      privateTarget: "https://user:password@api.example.com",
    },
  };
}

describe("TransportSecurityEvidenceService", () => {
  it("combines configuration and live candidate reports without copying transport secrets", () => {
    const report = new TransportSecurityEvidenceService(() => now).run(validInput());

    expect(report).toMatchObject({
      ok: true,
      schemaVersion: 3,
      releaseId: "release-2026.08.31",
      commitSha,
      checkedAt: now.toISOString(),
      preflightCheckedAt: "2026-08-31T08:00:00.000Z",
      deploymentVerifiedAt: "2026-08-31T08:30:00.000Z",
      activeTransports: {
        oauthProviders: ["naver", "kakao", "google"],
        objectStorage: "custom-https",
        cdn: "https",
        smtp: "starttls",
      },
    });
    expect(report.checks).toHaveLength(18);
    expect(report.checks.every(({ status }) => status === "pass")).toBe(true);
    expect(report.evidenceSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify(report)).not.toContain("password");
    expect(JSON.stringify(report)).not.toContain("private-bucket");
    expect(JSON.stringify(report)).not.toContain("example.com");
  });

  it("accepts provider-default object storage HTTPS and a disabled CDN", () => {
    const input = validInput();
    delete input.environment.OBJECT_STORAGE_ENDPOINT;
    delete input.environment.PLAYBACK_CDN_BASE_URL;
    input.environment.PREFLIGHT_REQUIRE_CDN = "false";
    const checks = (input.preflight as { checks: Array<{ name: string }> }).checks;
    (input.preflight as { checks: Array<{ name: string }> }).checks = checks.filter(({ name }) => name !== "cdn");
    const report = new TransportSecurityEvidenceService(() => now).run(input);

    expect(report.ok).toBe(true);
    expect(report.activeTransports).toMatchObject({ objectStorage: "provider-default-https", cdn: "disabled" });
  });

  it("normalizes an HTTPS CORS trailing slash and honors an intentional OAuth provider subset", () => {
    const input = validInput();
    input.environment.CORS_ORIGINS = "https://www.example.com/";
    input.environment.PREFLIGHT_REQUIRED_OAUTH_PROVIDERS = "naver,google";
    delete input.environment.KAKAO_REDIRECT_URI;
    const report = new TransportSecurityEvidenceService(() => now).run(input);

    expect(report.ok).toBe(true);
    expect(report.activeTransports.oauthProviders).toEqual(["naver", "google"]);
  });

  it("fails closed for plaintext database, Redis, object storage, and SMTP transports", () => {
    const input = validInput();
    input.environment.DATABASE_URL = "postgresql://private:password@db.example.com/app";
    input.environment.RATE_LIMIT_REDIS_URL = "redis://redis.example.com:6379/0";
    input.environment.OBJECT_STORAGE_ENDPOINT = "http://objects.example.com";
    input.environment.SMTP_REQUIRE_TLS = "false";
    const report = new TransportSecurityEvidenceService(() => now).run(input);

    expect(report.ok).toBe(false);
    expect(report.checks).toEqual(expect.arrayContaining([
      { name: "databaseTls", status: "fail", code: "TRANSPORT_DATABASE_TLS_REQUIRED" },
      { name: "redisTls", status: "fail", code: "TRANSPORT_REDIS_TLS_REQUIRED" },
      { name: "objectStorageHttps", status: "fail", code: "TRANSPORT_OBJECT_STORAGE_HTTPS_REQUIRED" },
      { name: "smtpTls", status: "fail", code: "TRANSPORT_SMTP_TLS_REQUIRED" },
    ]));
  });

  it("rejects HTTP public targets, CORS, and OAuth redirects", () => {
    const input = validInput();
    input.apiBaseUrl = "http://api.example.com";
    input.webBaseUrl = "http://www.example.com";
    input.environment.PUBLIC_APP_URL = "http://www.example.com";
    input.environment.CORS_ORIGINS = "http://www.example.com";
    input.environment.NAVER_REDIRECT_URI = "http://api.example.com/callback";
    const report = new TransportSecurityEvidenceService(() => now).run(input);

    expect(report.ok).toBe(false);
    expect(report.checks).toEqual(expect.arrayContaining([
      { name: "apiHttps", status: "fail", code: "TRANSPORT_API_HTTPS_REQUIRED" },
      { name: "webHttps", status: "fail", code: "TRANSPORT_WEB_HTTPS_REQUIRED" },
      { name: "corsHttps", status: "fail", code: "TRANSPORT_CORS_HTTPS_INVALID" },
      { name: "oauthHttps", status: "fail", code: "TRANSPORT_OAUTH_HTTPS_INVALID" },
    ]));
  });

  it("rejects a mismatched, obsolete, or expiring public TLS certificate observation", () => {
    const input = validInput();
    input.tlsEndpoints.api.originSha256 = "6".repeat(64);
    input.tlsEndpoints.web.protocol = "TLSv1.1";
    input.tlsEndpoints.web.validTo = "2026-09-01T00:00:00.000Z";
    const report = new TransportSecurityEvidenceService(() => now).run(input);

    expect(report.ok).toBe(false);
    expect(report.checks).toEqual(expect.arrayContaining([
      { name: "apiTlsCertificate", status: "fail", code: "TRANSPORT_API_TLS_CERTIFICATE_INVALID_OR_EXPIRING" },
      { name: "webTlsCertificate", status: "fail", code: "TRANSPORT_WEB_TLS_CERTIFICATE_INVALID_OR_EXPIRING" },
    ]));
  });

  it("rejects failed runtime reports, candidate mismatch, and expired evidence", () => {
    const input = validInput();
    (input.preflight as { ok: boolean; checkedAt: string }).ok = false;
    (input.preflight as { ok: boolean; checkedAt: string }).checkedAt = "2026-08-29T00:00:00.000Z";
    (input.deploymentVerification as { expected: { commitSha: string }; ok: boolean }).ok = false;
    (input.deploymentVerification as { expected: { commitSha: string }; ok: boolean }).expected.commitSha = "c".repeat(40);
    const report = new TransportSecurityEvidenceService(() => now).run(input);

    expect(report.ok).toBe(false);
    expect(report.checks).toEqual(expect.arrayContaining([
      { name: "preflight", status: "fail", code: "TRANSPORT_PREFLIGHT_NOT_SUCCESSFUL" },
      { name: "deploymentVerification", status: "fail", code: "TRANSPORT_DEPLOYMENT_NOT_VERIFIED" },
      { name: "candidateIdentity", status: "fail", code: "TRANSPORT_CANDIDATE_IDENTITY_MISMATCH" },
      { name: "evidenceTimestamps", status: "fail", code: "TRANSPORT_EVIDENCE_TIMESTAMP_INVALID_OR_EXPIRED" },
    ]));
  });

  it("rejects deployment evidence from another release ID", () => {
    const input = validInput();
    (input.deploymentVerification as { releaseId: string }).releaseId = "release-other";
    const report = new TransportSecurityEvidenceService(() => now).run(input);

    expect(report.checks).toContainEqual({
      name: "candidateIdentity", status: "fail", code: "TRANSPORT_CANDIDATE_IDENTITY_MISMATCH",
    });
  });

  it.each([
    ["release ID", { releaseId: "../unsafe" }, "TRANSPORT_EVIDENCE_RELEASE_ID_INVALID"],
    ["artifact hash", { preflightSha256: "bad" }, "TRANSPORT_EVIDENCE_ARTIFACT_SHA256_INVALID"],
    ["maximum age", { maximumAgeHours: 0 }, "TRANSPORT_EVIDENCE_MAXIMUM_AGE_INVALID"],
    ["certificate validity days", { minimumCertificateValidityDays: 0 }, "TRANSPORT_EVIDENCE_CERTIFICATE_VALIDITY_DAYS_INVALID"],
  ])("rejects invalid %s input", (_label, override, code) => {
    expect(() => new TransportSecurityEvidenceService(() => now).run({
      ...validInput(), ...override,
    })).toThrowError(expect.objectContaining({ name: code }));
  });
});
