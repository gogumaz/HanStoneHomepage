import { createHash } from "node:crypto";
import { parse } from "dotenv";
import { SOLO_RELEASE_OPERATOR_LOGIN } from "../common/release-approval-policy.js";
import { loadAppConfig } from "../config/app-config.js";
import {
  validateDeploymentTarget,
  validateNonProductionDeploymentTarget,
} from "./deployment-verification.service.js";
import { validateLoadTestTarget } from "./read-only-load-test.service.js";
import { validateRecoveryTarget } from "./recovery-drill.service.js";
import {
  REQUIRED_PRODUCTION_SECRETS,
  REQUIRED_REPOSITORY_SECRETS,
} from "./release-readiness.service.js";

export const RELEASE_SECRET_SETUP_CONFIRMATION = "CONFIGURE_RELEASE_SECRETS";

export const RELEASE_SECRET_NAMES = [
  ...REQUIRED_REPOSITORY_SECRETS,
  ...REQUIRED_PRODUCTION_SECRETS,
] as const;

export type ReleaseSecretName = typeof RELEASE_SECRET_NAMES[number];

export type ReleaseSecretSetupInput = {
  repository: string;
  actorLogin: string;
  values: Partial<Record<ReleaseSecretName, string>>;
  applyRequested: boolean;
  confirmation: string | null;
};

export type ReleaseSecretSetupReport = {
  ok: boolean;
  mode: "dry-run" | "apply";
  repository: string;
  environment: "production";
  secretValueSource: "process-environment-and-local-file";
  checks: Array<{ name: string; status: "pass" | "fail"; code: string }>;
  repositorySecretNames: readonly string[];
  productionSecretNames: readonly string[];
  applyAuthorized: boolean;
};

type SecretCheck = ReleaseSecretSetupReport["checks"][number];

function setupError(code: string): Error {
  const error = new Error(code);
  error.name = code;
  return error;
}

function check(name: string, passed: boolean, code: string): SecretCheck {
  return { name, status: passed ? "pass" : "fail", code: passed ? "OK" : code };
}

function validRepository(value: string): boolean {
  const parts = value.split("/");
  return parts.length === 2 && parts.every((part) => (
    /^[A-Za-z0-9_.-]{1,100}$/u.test(part) && part !== "." && part !== ".."
  ));
}

function validLogin(value: string): boolean {
  return /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,98}[A-Za-z0-9])?$/u.test(value);
}

function validToken(value: string | undefined, maximumLength = 200): boolean {
  return typeof value === "string"
    && new RegExp(`^[A-Za-z0-9_-]{32,${maximumLength}}$`, "u").test(value);
}

function validStagingTarget(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const target = new URL(validateLoadTestTarget(value));
    return target.protocol === "https:"
      && !["localhost", "127.0.0.1", "::1", "[::1]"].includes(target.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function validProductionTarget(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const target = new URL(validateDeploymentTarget(value));
    return target.protocol === "https:"
      && !["localhost", "127.0.0.1", "::1", "[::1]"].includes(target.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function validRollbackDrillTarget(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const target = new URL(validateNonProductionDeploymentTarget(value));
    return target.protocol === "https:"
      && !["localhost", "127.0.0.1", "::1", "[::1]"].includes(target.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function validTlsPostgresUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    const sslMode = url.searchParams.get("sslmode")?.toLowerCase();
    return ["postgres:", "postgresql:"].includes(url.protocol)
      && Boolean(url.hostname)
      && url.pathname !== "/"
      && ["require", "verify-ca", "verify-full"].includes(sslMode ?? "");
  } catch {
    return false;
  }
}

function decodedPreflightEnvironment(value: string | undefined): NodeJS.ProcessEnv | null {
  if (!value || value.length > 350_000 || value.length % 4 !== 0
      || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) {
    return null;
  }
  try {
    const decoded = Buffer.from(value, "base64");
    if (decoded.length === 0 || decoded.length > 256 * 1024) return null;
    const text = decoded.toString("utf8");
    if (text.includes("\u0000") || text.includes("\uFFFD")) return null;
    const env = parse(text);
    if (Object.keys(env).length === 0) return null;
    const productionEnv: NodeJS.ProcessEnv = { ...env, NODE_ENV: "production" };
    loadAppConfig(productionEnv);
    return productionEnv;
  } catch {
    return null;
  }
}

function validMailBounceEvidence(responseBase64: string | undefined, providerEventId: string | undefined): boolean {
  if (!responseBase64 || !providerEventId || responseBase64.length > 100_000 || responseBase64.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(responseBase64) ||
    !/^[A-Za-z0-9._:-]{1,200}$/u.test(providerEventId)) return false;
  try {
    const decoded = Buffer.from(responseBase64, "base64");
    if (decoded.length === 0 || decoded.length > 64 * 1024) return false;
    const root = JSON.parse(decoded.toString("utf8")) as unknown;
    if (typeof root !== "object" || root === null || Array.isArray(root)) return false;
    const rootObject = root as Record<string, unknown>;
    const data = typeof rootObject.data === "object" && rootObject.data !== null && !Array.isArray(rootObject.data)
      ? rootObject.data as Record<string, unknown> : rootObject;
    const expectedHash = createHash("sha256").update(providerEventId, "utf8").digest("hex");
    return data.accepted === true && data.action === "bounced" && data.eventIdSha256 === expectedHash &&
      typeof data.auditLogId === "string" && /^[A-Za-z0-9_-]{1,100}$/u.test(data.auditLogId);
  } catch {
    return false;
  }
}

function validLegalApprovalEvidence(value: string | undefined, preflightEnv: NodeJS.ProcessEnv | null): boolean {
  if (!value || !preflightEnv || value.length > 350_000 || value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) return false;
  try {
    const decoded = Buffer.from(value, "base64");
    if (decoded.length === 0 || decoded.length > 256 * 1024) return false;
    const report = JSON.parse(decoded.toString("utf8")) as unknown;
    if (typeof report !== "object" || report === null || Array.isArray(report)) return false;
    const root = report as Record<string, unknown>;
    const environment = typeof root.environment === "object" && root.environment !== null && !Array.isArray(root.environment)
      ? root.environment as Record<string, unknown> : null;
    const checks = Array.isArray(root.checks) ? root.checks : [];
    return root.ok === true && root.schemaVersion === 1 && checks.length === 6 && checks.every((item) => {
      if (typeof item !== "object" || item === null || Array.isArray(item)) return false;
      const entry = item as Record<string, unknown>;
      return entry.status === "pass" && entry.code === "OK";
    }) && environment?.LEGAL_POLICY_VERSION === preflightEnv.LEGAL_POLICY_VERSION &&
      environment?.LEGAL_POLICY_APPROVED_AT === preflightEnv.LEGAL_POLICY_APPROVED_AT &&
      environment?.LEGAL_POLICY_APPROVAL_SHA256 === preflightEnv.LEGAL_POLICY_APPROVAL_SHA256;
  } catch {
    return false;
  }
}

export class ReleaseSecretSetupService {
  plan(input: ReleaseSecretSetupInput): ReleaseSecretSetupReport {
    if (!validRepository(input.repository)) {
      throw setupError("RELEASE_SECRET_REPOSITORY_INVALID");
    }
    if (!validLogin(input.actorLogin)) {
      throw setupError("RELEASE_SECRET_ACTOR_INVALID");
    }

    const preflightEnv = decodedPreflightEnvironment(input.values.PRODUCTION_PREFLIGHT_ENV_FILE_BASE64);
    const productionDatabaseUrl = input.values.PRODUCTION_DATABASE_URL;
    const recoveryDatabaseUrl = input.values.RECOVERY_DATABASE_URL;
    let recoveryTargetValid = validTlsPostgresUrl(recoveryDatabaseUrl)
      && validTlsPostgresUrl(productionDatabaseUrl);
    if (recoveryTargetValid) {
      try {
        validateRecoveryTarget(recoveryDatabaseUrl ?? "", productionDatabaseUrl ?? "");
      } catch {
        recoveryTargetValid = false;
      }
    }
    const mailBounceEvidenceValid = validMailBounceEvidence(
      input.values.PRODUCTION_MAIL_BOUNCE_RESPONSE_BASE64,
      input.values.PRODUCTION_MAIL_PROVIDER_EVENT_ID,
    );
    const legalApprovalEvidenceValid = validLegalApprovalEvidence(
      input.values.PRODUCTION_LEGAL_APPROVAL_EVIDENCE_BASE64,
      preflightEnv,
    );

    const validators: Record<ReleaseSecretName, boolean> = {
      RELEASE_READINESS_TOKEN: validToken(input.values.RELEASE_READINESS_TOKEN, 512),
      STAGING_API_BASE_URL: validStagingTarget(input.values.STAGING_API_BASE_URL),
      STAGING_OPERATIONS_METRICS_TOKEN: validToken(input.values.STAGING_OPERATIONS_METRICS_TOKEN),
      ROLLBACK_DRILL_API_BASE_URL: validRollbackDrillTarget(input.values.ROLLBACK_DRILL_API_BASE_URL),
      ROLLBACK_DRILL_WEB_BASE_URL: validRollbackDrillTarget(input.values.ROLLBACK_DRILL_WEB_BASE_URL),
      ROLLBACK_DRILL_OPERATIONS_METRICS_TOKEN: validToken(input.values.ROLLBACK_DRILL_OPERATIONS_METRICS_TOKEN),
      PRODUCTION_PREFLIGHT_ENV_FILE_BASE64: preflightEnv !== null,
      PRODUCTION_DATABASE_URL: validTlsPostgresUrl(productionDatabaseUrl),
      RECOVERY_DATABASE_URL: recoveryTargetValid,
      PRODUCTION_API_BASE_URL: validProductionTarget(input.values.PRODUCTION_API_BASE_URL),
      PRODUCTION_WEB_BASE_URL: validProductionTarget(input.values.PRODUCTION_WEB_BASE_URL),
      PRODUCTION_OPERATIONS_METRICS_TOKEN: validToken(input.values.PRODUCTION_OPERATIONS_METRICS_TOKEN),
      PRODUCTION_MAIL_BOUNCE_RESPONSE_BASE64: mailBounceEvidenceValid,
      PRODUCTION_MAIL_PROVIDER_EVENT_ID: mailBounceEvidenceValid,
      PRODUCTION_LEGAL_APPROVAL_EVIDENCE_BASE64: legalApprovalEvidenceValid,
    };
    const checks: SecretCheck[] = [
      check(
        "soloOperator",
        input.actorLogin.toLowerCase() === SOLO_RELEASE_OPERATOR_LOGIN.toLowerCase(),
        "RELEASE_SECRET_SOLO_OPERATOR_MISMATCH",
      ),
      ...RELEASE_SECRET_NAMES.map((name) => check(
        `secret:${name}`,
        validators[name],
        input.values[name] ? "RELEASE_SECRET_VALUE_INVALID" : "RELEASE_SECRET_VALUE_MISSING",
      )),
      check(
        "preflight:databaseConsistency",
        preflightEnv !== null
          && typeof productionDatabaseUrl === "string"
          && preflightEnv.DATABASE_URL === productionDatabaseUrl,
        "RELEASE_SECRET_PREFLIGHT_DATABASE_MISMATCH",
      ),
      check(
        "preflight:webTargetConsistency",
        preflightEnv !== null
          && typeof input.values.PRODUCTION_WEB_BASE_URL === "string"
          && (() => {
            try {
              return new URL(preflightEnv.PUBLIC_APP_URL ?? "").origin
                === new URL(input.values.PRODUCTION_WEB_BASE_URL).origin;
            } catch {
              return false;
            }
          })(),
        "RELEASE_SECRET_PREFLIGHT_WEB_TARGET_MISMATCH",
      ),
      check(
        "preflight:metricsTokenConsistency",
        preflightEnv !== null
          && typeof input.values.PRODUCTION_OPERATIONS_METRICS_TOKEN === "string"
          && preflightEnv.OPERATIONS_METRICS_TOKEN === input.values.PRODUCTION_OPERATIONS_METRICS_TOKEN,
        "RELEASE_SECRET_PREFLIGHT_METRICS_TOKEN_MISMATCH",
      ),
      check(
        "applyConfirmation",
        !input.applyRequested || input.confirmation === RELEASE_SECRET_SETUP_CONFIRMATION,
        "RELEASE_SECRET_CONFIRMATION_REQUIRED",
      ),
    ];
    const ok = checks.every(({ status }) => status === "pass");

    return {
      ok,
      mode: input.applyRequested ? "apply" : "dry-run",
      repository: input.repository,
      environment: "production",
      secretValueSource: "process-environment-and-local-file",
      checks,
      repositorySecretNames: REQUIRED_REPOSITORY_SECRETS,
      productionSecretNames: REQUIRED_PRODUCTION_SECRETS,
      applyAuthorized: input.applyRequested && ok,
    };
  }
}
