import { createHash } from "node:crypto";
import { validateDeploymentTarget } from "./deployment-verification.service.js";

type JsonObject = Record<string, unknown>;
type TransportCheck = { name: string; status: "pass" | "fail"; code: string };

export type TransportTlsEndpointEvidence = {
  originSha256: string;
  protocol: string;
  certificateSha256: string;
  validFrom: string;
  validTo: string;
};

export type TransportSecurityEvidenceInput = {
  releaseId: string;
  environment: NodeJS.ProcessEnv;
  preflight: unknown;
  deploymentVerification: unknown;
  environmentSha256: string;
  preflightSha256: string;
  deploymentVerificationSha256: string;
  apiBaseUrl: string;
  webBaseUrl: string;
  maximumAgeHours: number;
  minimumCertificateValidityDays: number;
  tlsEndpoints: {
    api: TransportTlsEndpointEvidence;
    web: TransportTlsEndpointEvidence;
  };
};

export type TransportSecurityEvidenceReport = {
  ok: boolean;
  schemaVersion: 3;
  releaseId: string;
  commitSha: string | null;
  checkedAt: string;
  preflightCheckedAt: string | null;
  deploymentVerifiedAt: string | null;
  activeTransports: {
    oauthProviders: string[];
    objectStorage: "provider-default-https" | "custom-https" | "invalid";
    cdn: "https" | "disabled" | "invalid";
    smtp: "implicit-tls" | "starttls" | "invalid";
  };
  minimumCertificateValidityDays: number;
  tlsEndpoints: {
    api: TransportTlsEndpointEvidence;
    web: TransportTlsEndpointEvidence;
  };
  artifacts: {
    environmentSha256: string;
    preflightSha256: string;
    deploymentVerificationSha256: string;
  };
  checks: TransportCheck[];
  evidenceSha256: string;
};

const REQUIRED_RUNTIME_CHECKS = [
  "configuration",
  "database",
  "rateLimitStore",
  "objectStorage",
  "smtp",
] as const;

function transportError(code: string): Error {
  const error = new Error(code);
  error.name = code;
  return error;
}

function object(value: unknown): JsonObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonObject : null;
}

function check(name: string, passed: boolean, code: string): TransportCheck {
  return { name, status: passed ? "pass" : "fail", code: passed ? "OK" : code };
}

function timestamp(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? new Date(milliseconds) : null;
}

function productionHttpsOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(validateDeploymentTarget(value));
    const local = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname.toLowerCase());
    return url.protocol === "https:" && !local ? url.origin : null;
  } catch {
    return null;
  }
}

function tlsPostgres(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    const sslMode = url.searchParams.get("sslmode")?.toLowerCase();
    return ["postgres:", "postgresql:"].includes(url.protocol) && Boolean(url.hostname) && url.pathname !== "/" &&
      ["require", "verify-ca", "verify-full"].includes(sslMode ?? "");
  } catch {
    return false;
  }
}

function tlsRedis(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "rediss:" && Boolean(url.hostname);
  } catch {
    return false;
  }
}

function httpsUrl(value: string | undefined): URL | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}

function boolean(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function tlsEndpointPassed(
  endpoint: TransportTlsEndpointEvidence,
  expectedOrigin: string | null,
  now: Date,
  minimumValidityDays: number,
): boolean {
  const hash = /^[a-f0-9]{64}$/u;
  const validFrom = timestamp(endpoint.validFrom);
  const validTo = timestamp(endpoint.validTo);
  return expectedOrigin !== null &&
    endpoint.originSha256 === sha256(expectedOrigin) &&
    ["TLSv1.2", "TLSv1.3"].includes(endpoint.protocol) &&
    hash.test(endpoint.certificateSha256) &&
    validFrom !== null && validTo !== null &&
    validFrom.getTime() <= now.getTime() + 5 * 60_000 &&
    validTo.getTime() >= now.getTime() + minimumValidityDays * 24 * 60 * 60_000;
}

function runtimeChecksPassed(preflight: JsonObject | null, requireCdn: boolean): boolean {
  if (!Array.isArray(preflight?.checks)) return false;
  const checks = preflight.checks.map(object).filter((entry): entry is JsonObject => entry !== null);
  const required = [...REQUIRED_RUNTIME_CHECKS, ...(requireCdn ? ["cdn"] : [])];
  return required.every((name) => {
    const matches = checks.filter((entry) => entry.name === name);
    return matches.length === 1 && matches[0]?.status === "pass";
  });
}

export class TransportSecurityEvidenceService {
  constructor(private readonly now: () => Date = () => new Date()) {}

  run(input: TransportSecurityEvidenceInput): TransportSecurityEvidenceReport {
    if (!/^[A-Za-z0-9._-]{1,80}$/u.test(input.releaseId)) {
      throw transportError("TRANSPORT_EVIDENCE_RELEASE_ID_INVALID");
    }
    const artifactHashPattern = /^[a-fA-F0-9]{64}$/u;
    if (!artifactHashPattern.test(input.environmentSha256) || !artifactHashPattern.test(input.preflightSha256) ||
      !artifactHashPattern.test(input.deploymentVerificationSha256)) {
      throw transportError("TRANSPORT_EVIDENCE_ARTIFACT_SHA256_INVALID");
    }
    if (!Number.isInteger(input.maximumAgeHours) || input.maximumAgeHours < 1 || input.maximumAgeHours > 168) {
      throw transportError("TRANSPORT_EVIDENCE_MAXIMUM_AGE_INVALID");
    }
    if (!Number.isInteger(input.minimumCertificateValidityDays) || input.minimumCertificateValidityDays < 1 ||
      input.minimumCertificateValidityDays > 90) {
      throw transportError("TRANSPORT_EVIDENCE_CERTIFICATE_VALIDITY_DAYS_INVALID");
    }

    const env = input.environment;
    const apiOrigin = productionHttpsOrigin(input.apiBaseUrl);
    const webOrigin = productionHttpsOrigin(input.webBaseUrl);
    const publicAppOrigin = productionHttpsOrigin(env.PUBLIC_APP_URL);
    const corsOrigins = (env.CORS_ORIGINS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
    const normalizedCorsOrigins = corsOrigins.map((origin) => productionHttpsOrigin(origin));
    const corsValid = normalizedCorsOrigins.length > 0 && normalizedCorsOrigins.every((origin) => origin !== null);
    const requestedOauthProviders = (env.PREFLIGHT_REQUIRED_OAUTH_PROVIDERS ?? "naver,kakao,google")
      .split(",").map((provider) => provider.trim().toUpperCase()).filter(Boolean);
    const oauthProviderNamesValid = new Set(requestedOauthProviders).size === requestedOauthProviders.length &&
      requestedOauthProviders.every((provider) => ["NAVER", "KAKAO", "GOOGLE"].includes(provider));
    const oauthEntries = requestedOauthProviders.map((provider) => ({
      provider: provider.toLowerCase(),
      url: httpsUrl(env[`${provider}_REDIRECT_URI`]),
    }));
    const oauthValid = oauthProviderNamesValid && apiOrigin !== null &&
      oauthEntries.every(({ url }) => url?.origin === apiOrigin);

    const objectEndpoint = env.OBJECT_STORAGE_ENDPOINT?.trim();
    const objectStorage = objectEndpoint
      ? (httpsUrl(objectEndpoint) ? "custom-https" as const : "invalid" as const)
      : (env.OBJECT_STORAGE_BUCKET?.trim() && env.OBJECT_STORAGE_REGION?.trim()
        ? "provider-default-https" as const : "invalid" as const);
    const cdnValue = env.PLAYBACK_CDN_BASE_URL?.trim();
    const cdn = cdnValue ? (httpsUrl(cdnValue) ? "https" as const : "invalid" as const) : "disabled" as const;
    const smtpPort = Number(env.SMTP_PORT ?? "587");
    const smtpSecure = boolean(env.SMTP_SECURE);
    const smtpRequireTls = boolean(env.SMTP_REQUIRE_TLS);
    const smtp = smtpPort === 465 && smtpSecure
      ? "implicit-tls" as const
      : smtpPort === 587 && !smtpSecure && smtpRequireTls
        ? "starttls" as const
        : "invalid" as const;

    const preflight = object(input.preflight);
    const deployment = object(input.deploymentVerification);
    const deploymentExpected = object(deployment?.expected);
    const web = object(deployment?.web);
    const webChecksPassed = Array.isArray(web?.checks) && web.checks.length > 0 &&
      web.checks.map(object).every((entry) => entry?.status === "pass");
    const preflightCommit = typeof preflight?.evidenceCommitSha === "string" &&
      /^[a-fA-F0-9]{40}$/u.test(preflight.evidenceCommitSha)
      ? preflight.evidenceCommitSha.toLowerCase() : null;
    const deploymentCommit = typeof deploymentExpected?.commitSha === "string" &&
      /^[a-fA-F0-9]{40}$/u.test(deploymentExpected.commitSha)
      ? deploymentExpected.commitSha.toLowerCase() : null;
    const commitSha = preflightCommit !== null && preflightCommit === deploymentCommit ? preflightCommit : null;
    const releaseIdMatches = deployment?.releaseId === input.releaseId;
    const preflightAt = timestamp(preflight?.checkedAt);
    const deploymentAt = timestamp(deployment?.completedAt);
    const now = this.now();
    const fresh = (date: Date | null) => date !== null && now.getTime() - date.getTime() >= 0 &&
      now.getTime() - date.getTime() <= input.maximumAgeHours * 60 * 60_000;
    const notFuture = (date: Date | null) => date !== null && date.getTime() <= now.getTime() + 5 * 60_000;
    const requireCdn = boolean(env.PREFLIGHT_REQUIRE_CDN) || cdn === "https";

    const checks = [
      check("productionEnvironment", env.NODE_ENV === "production", "TRANSPORT_NODE_ENV_NOT_PRODUCTION"),
      check("apiHttps", apiOrigin !== null, "TRANSPORT_API_HTTPS_REQUIRED"),
      check("webHttps", webOrigin !== null, "TRANSPORT_WEB_HTTPS_REQUIRED"),
      check(
        "apiTlsCertificate",
        tlsEndpointPassed(input.tlsEndpoints.api, apiOrigin, now, input.minimumCertificateValidityDays),
        "TRANSPORT_API_TLS_CERTIFICATE_INVALID_OR_EXPIRING",
      ),
      check(
        "webTlsCertificate",
        tlsEndpointPassed(input.tlsEndpoints.web, webOrigin, now, input.minimumCertificateValidityDays),
        "TRANSPORT_WEB_TLS_CERTIFICATE_INVALID_OR_EXPIRING",
      ),
      check(
        "publicAppHttps",
        publicAppOrigin !== null && publicAppOrigin === webOrigin,
        "TRANSPORT_PUBLIC_APP_HTTPS_MISMATCH",
      ),
      check(
        "corsHttps",
        corsValid && webOrigin !== null && normalizedCorsOrigins.includes(webOrigin),
        "TRANSPORT_CORS_HTTPS_INVALID",
      ),
      check("oauthHttps", oauthValid, "TRANSPORT_OAUTH_HTTPS_INVALID"),
      check("databaseTls", tlsPostgres(env.DATABASE_URL), "TRANSPORT_DATABASE_TLS_REQUIRED"),
      check("redisTls", tlsRedis(env.RATE_LIMIT_REDIS_URL), "TRANSPORT_REDIS_TLS_REQUIRED"),
      check("objectStorageHttps", objectStorage !== "invalid", "TRANSPORT_OBJECT_STORAGE_HTTPS_REQUIRED"),
      check("cdnHttps", cdn !== "invalid", "TRANSPORT_CDN_HTTPS_INVALID"),
      check("smtpTls", smtp !== "invalid", "TRANSPORT_SMTP_TLS_REQUIRED"),
      check("preflight", preflight?.ok === true, "TRANSPORT_PREFLIGHT_NOT_SUCCESSFUL"),
      check(
        "runtimeConnections",
        runtimeChecksPassed(preflight, requireCdn),
        "TRANSPORT_RUNTIME_CONNECTION_CHECKS_INCOMPLETE",
      ),
      check(
        "deploymentVerification",
        deployment?.ok === true && deployment?.rollbackRecommended === false && web?.ok === true && webChecksPassed,
        "TRANSPORT_DEPLOYMENT_NOT_VERIFIED",
      ),
      check(
        "candidateIdentity",
        commitSha !== null && releaseIdMatches,
        "TRANSPORT_CANDIDATE_IDENTITY_MISMATCH",
      ),
      check(
        "evidenceTimestamps",
        notFuture(preflightAt) && notFuture(deploymentAt) && fresh(preflightAt) && fresh(deploymentAt),
        "TRANSPORT_EVIDENCE_TIMESTAMP_INVALID_OR_EXPIRED",
      ),
    ];
    const checkedAt = now.toISOString();
    const activeTransports = {
      oauthProviders: oauthEntries.map(({ provider }) => provider),
      objectStorage,
      cdn,
      smtp,
    };
    const artifacts = {
      environmentSha256: input.environmentSha256.toLowerCase(),
      preflightSha256: input.preflightSha256.toLowerCase(),
      deploymentVerificationSha256: input.deploymentVerificationSha256.toLowerCase(),
    };
    const tlsEndpoints = input.tlsEndpoints;
    const source = JSON.stringify({
      schemaVersion: 3,
      releaseId: input.releaseId,
      commitSha,
      checkedAt,
      preflightCheckedAt: preflightAt?.toISOString() ?? null,
      deploymentVerifiedAt: deploymentAt?.toISOString() ?? null,
      activeTransports,
      minimumCertificateValidityDays: input.minimumCertificateValidityDays,
      tlsEndpoints,
      artifacts,
      checks: checks.map(({ name, status }) => ({ name, status })),
    });
    return {
      ok: checks.every(({ status }) => status === "pass"),
      schemaVersion: 3,
      releaseId: input.releaseId,
      commitSha,
      checkedAt,
      preflightCheckedAt: preflightAt?.toISOString() ?? null,
      deploymentVerifiedAt: deploymentAt?.toISOString() ?? null,
      activeTransports,
      minimumCertificateValidityDays: input.minimumCertificateValidityDays,
      tlsEndpoints,
      artifacts,
      checks,
      evidenceSha256: createHash("sha256").update(source, "utf8").digest("hex"),
    };
  }
}
