import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  RELEASE_SECRET_SETUP_CONFIRMATION,
  ReleaseSecretSetupService,
  type ReleaseSecretSetupInput,
  type ReleaseSecretName,
} from "./release-secret-setup.service.js";

const productionDatabaseUrl = "postgresql://user:password@database.example.com:5432/app?sslmode=verify-full";
const metricsToken = "metrics_token_1234567890_abcdefghij";

function preflightEnvironment(): string {
  return [
    "NODE_ENV=production",
    `DATABASE_URL=${productionDatabaseUrl}`,
    "CORS_ORIGINS=https://www.example.com",
    "PUBLIC_APP_URL=https://www.example.com",
    "SMTP_HOST=smtp.example.com",
    "SMTP_REQUIRE_TLS=true",
    "MAIL_FROM=no-reply@example.com",
    "LEGAL_POLICY_VERSION=guardian-link-v1",
    "LEGAL_POLICY_APPROVED_AT=2026-08-01T00:00:00.000Z",
    `LEGAL_POLICY_APPROVAL_SHA256=${"b".repeat(64)}`,
    `OPERATIONS_METRICS_TOKEN=${metricsToken}`,
  ].join("\n");
}

function validInput(): ReleaseSecretSetupInput {
  const providerEventId = "provider-event_2026.08.31:001";
  const bounceResponse = Buffer.from(JSON.stringify({ data: {
    accepted: true,
    action: "bounced",
    auditLogId: "audit_01ABCDEF",
    eventIdSha256: createHash("sha256").update(providerEventId).digest("hex"),
  } })).toString("base64");
  const legalApproval = Buffer.from(JSON.stringify({
    ok: true,
    schemaVersion: 1,
    environment: {
      LEGAL_POLICY_VERSION: "guardian-link-v1",
      LEGAL_POLICY_APPROVED_AT: "2026-08-01T00:00:00.000Z",
      LEGAL_POLICY_APPROVAL_SHA256: "b".repeat(64),
    },
    checks: [
      "signedFinalConfirmation", "documentSize", "documentFormat", "approvalTimestamp", "candidateCommit", "documentSha256",
    ].map((name) => ({ name, status: "pass", code: "OK" })),
  })).toString("base64");
  return {
    repository: "example/baduk-history",
    actorLogin: "gogumaz",
    values: {
      RELEASE_READINESS_TOKEN: "github_pat_release_readiness_1234567890",
      STAGING_API_BASE_URL: "https://api.staging.example.com",
      STAGING_OPERATIONS_METRICS_TOKEN: "staging_metrics_token_1234567890_abcd",
      ROLLBACK_DRILL_API_BASE_URL: "https://api.rollback-drill.example.com",
      ROLLBACK_DRILL_WEB_BASE_URL: "https://web.rollback-drill.example.com",
      ROLLBACK_DRILL_OPERATIONS_METRICS_TOKEN: "rollback_metrics_token_1234567890_abcd",
      PRODUCTION_PREFLIGHT_ENV_FILE_BASE64: Buffer.from(preflightEnvironment()).toString("base64"),
      PRODUCTION_DATABASE_URL: productionDatabaseUrl,
      RECOVERY_DATABASE_URL: "postgresql://user:password@database-recovery.example.com:5432/app_drill?sslmode=verify-full",
      PRODUCTION_API_BASE_URL: "https://api.example.com",
      PRODUCTION_WEB_BASE_URL: "https://www.example.com",
      PRODUCTION_OPERATIONS_METRICS_TOKEN: metricsToken,
      PRODUCTION_MAIL_BOUNCE_RESPONSE_BASE64: bounceResponse,
      PRODUCTION_MAIL_PROVIDER_EVENT_ID: providerEventId,
      PRODUCTION_LEGAL_APPROVAL_EVIDENCE_BASE64: legalApproval,
    },
    applyRequested: false,
    confirmation: null,
  };
}

describe("ReleaseSecretSetupService", () => {
  it("creates a value-free dry-run plan for valid release secrets", () => {
    const input = validInput();
    const report = new ReleaseSecretSetupService().plan(input);
    const serialized = JSON.stringify(report);
    expect(report.ok).toBe(true);
    expect(report.mode).toBe("dry-run");
    expect(report.applyAuthorized).toBe(false);
    expect(report.checks.every(({ status }) => status === "pass")).toBe(true);
    for (const value of Object.values(input.values)) {
      expect(serialized).not.toContain(value);
    }
  });

  it("reports every missing value without exposing placeholders", () => {
    const report = new ReleaseSecretSetupService().plan({
      ...validInput(),
      values: {},
    });

    expect(report.ok).toBe(false);
    expect(report.checks.filter(({ code }) => code === "RELEASE_SECRET_VALUE_MISSING")).toHaveLength(15);
    expect(report.checks).toContainEqual({
      name: "preflight:databaseConsistency",
      status: "fail",
      code: "RELEASE_SECRET_PREFLIGHT_DATABASE_MISMATCH",
    });
  });

  it("requires the exact confirmation before apply", () => {
    const service = new ReleaseSecretSetupService();
    const missing = service.plan({ ...validInput(), applyRequested: true });
    const confirmed = service.plan({
      ...validInput(),
      applyRequested: true,
      confirmation: RELEASE_SECRET_SETUP_CONFIRMATION,
    });

    expect(missing.applyAuthorized).toBe(false);
    expect(missing.checks).toContainEqual({
      name: "applyConfirmation",
      status: "fail",
      code: "RELEASE_SECRET_CONFIRMATION_REQUIRED",
    });
    expect(confirmed.ok).toBe(true);
    expect(confirmed.applyAuthorized).toBe(true);
  });

  it.each([
    ["STAGING_API_BASE_URL", "http://api.staging.example.com"],
    ["ROLLBACK_DRILL_API_BASE_URL", "https://api.example.com"],
    ["ROLLBACK_DRILL_WEB_BASE_URL", "http://web.rollback-drill.example.com"],
    ["ROLLBACK_DRILL_OPERATIONS_METRICS_TOKEN", "short"],
    ["PRODUCTION_API_BASE_URL", "http://api.example.com"],
    ["PRODUCTION_DATABASE_URL", "postgresql://user:password@database.example.com/app"],
    ["RECOVERY_DATABASE_URL", productionDatabaseUrl],
    ["PRODUCTION_OPERATIONS_METRICS_TOKEN", "short"],
  ] satisfies Array<[ReleaseSecretName, string]>)("rejects an unsafe %s", (name, value) => {
    const input = validInput();
    input.values[name] = value;

    const report = new ReleaseSecretSetupService().plan(input);

    expect(report.ok).toBe(false);
    expect(report.checks).toContainEqual({
      name: `secret:${name}`,
      status: "fail",
      code: "RELEASE_SECRET_VALUE_INVALID",
    });
  });

  it("rejects a malformed preflight file and cross-secret inconsistencies", () => {
    const input = validInput();
    input.values.PRODUCTION_PREFLIGHT_ENV_FILE_BASE64 = Buffer.from("not-an-environment-file").toString("base64");

    const report = new ReleaseSecretSetupService().plan(input);

    expect(report.ok).toBe(false);
    expect(report.checks).toContainEqual({
      name: "secret:PRODUCTION_PREFLIGHT_ENV_FILE_BASE64",
      status: "fail",
      code: "RELEASE_SECRET_VALUE_INVALID",
    });
    expect(report.checks.filter(({ name, status }) => name.startsWith("preflight:") && status === "fail"))
      .toHaveLength(3);
  });

  it("rejects an unexpected operator and malformed repository metadata", () => {
    const service = new ReleaseSecretSetupService();
    const wrongOperator = service.plan({ ...validInput(), actorLogin: "another-user" });

    expect(wrongOperator.checks).toContainEqual({
      name: "soloOperator",
      status: "fail",
      code: "RELEASE_SECRET_SOLO_OPERATOR_MISMATCH",
    });
    expect(() => service.plan({ ...validInput(), repository: "../unsafe" }))
      .toThrowError(expect.objectContaining({ name: "RELEASE_SECRET_REPOSITORY_INVALID" }));
  });
});
