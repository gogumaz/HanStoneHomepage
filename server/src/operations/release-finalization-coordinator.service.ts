import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  SOLO_RELEASE_CONFIRMATION,
  SOLO_RELEASE_OPERATOR_LOGIN,
} from "../common/release-approval-policy.js";
import {
  RELEASE_EVIDENCE_NAMES,
  ReleaseAcceptanceService,
  type ReleaseEvidenceName,
} from "./release-acceptance.service.js";
import {
  successfulDeploymentVerificationEvidenceValid,
} from "./deployment-verification.service.js";
import { REQUIRED_PRODUCTION_SECRETS } from "./release-readiness.service.js";

export const PRODUCTION_DEPLOYMENT_CONFIRMATION = "DEPLOYED_ACCEPTED_CANDIDATE";

export type FinalizationEvidenceRun = {
  runId: number;
  artifactPresent: boolean;
  artifactExpired: boolean | null;
  artifactCreatedAt: string | null;
  artifactExpiresAt: string | null;
  report: unknown;
  reportSha256?: string | null;
  relatedReports?: Record<string, unknown>;
  relatedSha256?: Record<string, string | null>;
};

export type ReleaseFinalizationCoordinatorInput = {
  repository: string;
  actorLogin: string;
  defaultBranch: string;
  localCommitSha: string;
  remoteDefaultCommitSha: string;
  dirtyFileCount: number;
  releaseId: string | null;
  imageReference: string | null;
  registryHost: string;
  productionSecretNames: string[];
  deploymentConfirmation: string | null;
  maximumVerificationDelayHours: number;
  acceptance: FinalizationEvidenceRun | null;
  acceptanceActiveRunId: number | null;
  verification: FinalizationEvidenceRun | null;
  verificationActiveRunId: number | null;
  closeout: FinalizationEvidenceRun | null;
  closeoutActiveRunId: number | null;
  applyRequested: boolean;
  confirmation: string | null;
};

export type ReleaseFinalizationCoordinatorReport = {
  ok: boolean;
  mode: "dry-run" | "apply";
  repository: string;
  releaseId: string | null;
  candidateCommitSha: string;
  stage: "blocked" | "acceptance-in-progress" | "verification-ready" | "verification-in-progress" | "closeout-ready" | "closeout-in-progress" | "complete";
  checks: Array<{ name: string; status: "pass" | "fail"; code: string }>;
  acceptanceRunId: number | null;
  verificationRunId: number | null;
  closeoutRunId: number | null;
  action:
    | { kind: "verifyDeployment"; workflow: "production-deployment-verification.yml"; webManifestSha256: string }
    | { kind: "closeout"; workflow: "release-closeout.yml" }
    | null;
  applyAuthorized: boolean;
};

type FinalizationCheck = ReleaseFinalizationCoordinatorReport["checks"][number];
type JsonObject = Record<string, unknown>;

function coordinatorError(code: string): Error {
  const error = new Error(code);
  error.name = code;
  return error;
}

function check(name: string, passed: boolean, code: string): FinalizationCheck {
  return { name, status: passed ? "pass" : "fail", code: passed ? "OK" : code };
}

function object(value: unknown): JsonObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonObject : null;
}

function allNamedChecksPassed(value: unknown, expectedNames: readonly string[]): boolean {
  if (!Array.isArray(value) || value.length !== expectedNames.length) return false;
  const expected = new Set(expectedNames);
  return value.every((item) => {
    const entry = object(item);
    return typeof entry?.name === "string" && expected.delete(entry.name) &&
      entry.status === "pass" && entry.code === "OK";
  }) && expected.size === 0;
}

function orderedNamedChecksPassed(value: unknown, expectedNames: readonly string[]): boolean {
  return Array.isArray(value) && value.length === expectedNames.length && value.every((item, index) => {
    const entry = object(item);
    return entry?.name === expectedNames[index] && entry?.status === "pass" && entry?.code === "OK";
  });
}

const TRANSPORT_CHECKS = [
  "productionEnvironment", "apiHttps", "webHttps", "apiTlsCertificate", "webTlsCertificate",
  "publicAppHttps", "corsHttps", "oauthHttps", "databaseTls", "redisTls", "objectStorageHttps",
  "cdnHttps", "smtpTls", "preflight", "runtimeConnections", "deploymentVerification",
  "candidateIdentity", "evidenceTimestamps",
] as const;
const MAIL_CHECKS = [
  "preflight", "candidateCommit", "smtpCheck", "smtpDetail", "preflightTimestamp",
  "preflightFreshness", "bounceWebhook", "providerEventCorrelation", "bounceAuditLog",
] as const;
const LEGAL_CHECKS = [
  "approvalEvidence", "policyVersion", "candidateCommit", "approvalTimestamp",
  "documentSha256", "generatedTimestamp", "preflight",
] as const;
const WEB_VERIFICATION_CHECKS = [
  "manifestSha256", "manifestSchema", "manifestCommit", "manifestCacheControl", "manifestContentType",
  "indexInventory", "assetInventory", "indexSha256", "indexCacheControl", "indexContentType",
  "assetSha256", "assetCacheControl", "assetContentType",
] as const;
const ACCEPTANCE_STAGING_CHECKS = [
  "identity", "checks", "sources", "loadSource", "workerSource", "selfDigest", "freshness",
] as const;
const STAGING_BUNDLE_CHECKS = [
  "sourceInventory", "candidateIdentity", "readOnlyLoad", "workerSoak", "controlledLoad",
  "execution", "concurrentObservation", "executionTimeline", "freshness",
] as const;
const STAGING_BUNDLE_SOURCES = ["readOnlyLoad", "workerSoak", "controlledLoad", "execution"] as const;
const ACCEPTANCE_EVIDENCE_FILES = {
  preflight: "production-preflight.json",
  recovery: "recovery-drill.json",
  readOnlyLoad: "staging-read-only-load-report.json",
  workerSoak: "staging-worker-soak-report.json",
  webDeployment: "web-deployment-manifest.json",
  fieldValidation: "field-validation-report.json",
  supplyChain: "manifest.json",
} as const;
const ACCEPTANCE_EVIDENCE_CHECKS: Record<(typeof RELEASE_EVIDENCE_NAMES)[number], readonly string[]> = {
  preflight: [
    "commitSha", "report", "configuration", "recoveryPolicy", "database", "rateLimitStore",
    "objectStorage", "cdn", "hlsTranscoder", "malwareScanner", "smtp", "freshness",
  ],
  recovery: [
    "commitSha", "report", "migration", "criticalTables", "relationships", "rpo", "rto",
    "rpoObjective", "rtoObjective", "freshness",
  ],
  readOnlyLoad: ["commitSha", "report", "latency", "errorRate", "completion", "freshness"],
  workerSoak: [
    "commitSha", "report", "latency", "criticalSamples", "queueHealth", "metricsFreshness", "completion",
    "account_mail", "inquiry_notification", "video_scan", "hls_transcode", "object_deletion", "freshness",
  ],
  webDeployment: [
    "commitSha", "report", "schemaVersion", "fileInventory", "entrypoints", "fileHashes", "contentTypes",
    "cachePolicy", "totals", "freshness",
  ],
  fieldValidation: [
    "commitSha", "report", "schemaVersion", "projectInventory", "chromium", "field-firefox",
    "field-mobile-chrome", "field-mobile-safari", "totals", "freshness",
  ],
  supplyChain: [
    "commitSha", "report", "schemaVersion", "vulnerabilityPolicy", "artifactInventory", "webSbomHash",
    "webComponentInventory", "webCycloneDxVersion", "apiSbomHash", "apiComponentInventory",
    "apiCycloneDxVersion", "freshness",
  ],
};
const STAGING_SOURCE_FILES = {
  readOnlyLoad: "staging-read-only-load-report.json",
  workerSoak: "staging-worker-soak-report.json",
  controlledLoad: "staging-worker-controlled-load-report.json",
  execution: "staging-worker-soak-execution.json",
} as const;
const CLOSEOUT_CHECKS = [
  "acceptance", "acceptanceEvidence", "stagingEvidenceBundle", "acceptanceManifest",
  "acceptanceImageReference", "deploymentVerification", "rollbackDecision", "deploymentSamples",
  "deploymentLatency", "deploymentHealth", "candidateIdentity", "webDeployment", "webCandidateIdentity",
  "transportSecurity", "mailOperations", "legalApprovalBinding", "timelineOrder", "timelineDelay", "timelineFuture",
] as const;

function closeoutDigestValid(report: JsonObject | null, artifacts: JsonObject | null): boolean {
  const timeline = object(report?.timeline);
  const checks = Array.isArray(report?.checks) ? report.checks : [];
  const orderedChecksValid = checks.length === CLOSEOUT_CHECKS.length && checks.every((item, index) => {
    const entry = object(item);
    return entry?.name === CLOSEOUT_CHECKS[index] && entry?.status === "pass" && entry?.code === "OK";
  });
  const acceptedAt = timeline?.acceptedAt;
  const verifiedAt = timeline?.verifiedAt;
  const verificationDelayMinutes = timeline?.verificationDelayMinutes;
  const maximumVerificationDelayHours = timeline?.maximumVerificationDelayHours;
  if (!orderedChecksValid || !Number.isInteger(maximumVerificationDelayHours)
      || (maximumVerificationDelayHours as number) < 1 || (maximumVerificationDelayHours as number) > 168
      || typeof acceptedAt !== "string" || !Number.isFinite(Date.parse(acceptedAt))
      || typeof verifiedAt !== "string" || !Number.isFinite(Date.parse(verifiedAt))
      || typeof verificationDelayMinutes !== "number" || !Number.isFinite(verificationDelayMinutes)
      || typeof report?.acceptanceManifestSha256 !== "string"
      || !/^[a-f0-9]{64}$/u.test(report.acceptanceManifestSha256)
      || typeof report.closedAt !== "string" || !Number.isFinite(Date.parse(report.closedAt))
      || typeof report.closeoutSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(report.closeoutSha256)
      || typeof artifacts?.acceptanceSha256 !== "string"
      || typeof artifacts.deploymentVerificationSha256 !== "string"
      || typeof artifacts.transportSecuritySha256 !== "string"
      || typeof artifacts.mailOperationsSha256 !== "string"
      || typeof artifacts.legalApprovalBindingSha256 !== "string") return false;

  const canonicalArtifacts = {
    acceptanceSha256: artifacts.acceptanceSha256,
    deploymentVerificationSha256: artifacts.deploymentVerificationSha256,
    transportSecuritySha256: artifacts.transportSecuritySha256,
    mailOperationsSha256: artifacts.mailOperationsSha256,
    legalApprovalBindingSha256: artifacts.legalApprovalBindingSha256,
  };
  const canonicalTimeline = {
    acceptedAt,
    verifiedAt,
    verificationDelayMinutes,
    maximumVerificationDelayHours,
  };
  const closeoutSource = JSON.stringify({
    releaseId: report.releaseId,
    commitSha: report.commitSha,
    imageDigest: report.imageDigest,
    imageReference: report.imageReference,
    webDeploymentManifestSha256: report.webDeploymentManifestSha256,
    stagingEvidenceBundleSha256: report.stagingEvidenceBundleSha256,
    acceptanceManifestSha256: report.acceptanceManifestSha256,
    closedAt: report.closedAt,
    artifacts: canonicalArtifacts,
    maximumVerificationDelayHours,
    timeline: canonicalTimeline,
    checks: checks.map((item) => {
      const entry = object(item)!;
      return { name: entry.name, status: entry.status };
    }),
  });
  return report.closeoutSha256 === createHash("sha256").update(closeoutSource, "utf8").digest("hex");
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

function validBranch(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._/-]{0,254}$/u.test(value)
    && !value.includes("..") && !value.includes("//") && !value.endsWith("/") && !value.endsWith(".");
}

function validRegistryHost(value: string): boolean {
  return /^[A-Za-z0-9.-]+(?::[0-9]{1,5})?$/u.test(value) && !value.includes("..");
}

function validImageReference(value: string | null, registryHost: string): boolean {
  return value !== null
    && value.startsWith(`${registryHost}/`)
    && /^[A-Za-z0-9.-]+(?::[0-9]{1,5})?\/[A-Za-z0-9._/-]+@sha256:[a-f0-9]{64}$/u.test(value)
    && !value.includes("..");
}

function validRun(run: FinalizationEvidenceRun | null): boolean {
  return run === null || (Number.isSafeInteger(run.runId) && run.runId > 0);
}

function validOptionalRunId(value: number | null): boolean {
  return value === null || (Number.isSafeInteger(value) && value > 0);
}

const MINIMUM_ARTIFACT_RETENTION_MS = 90 * 24 * 60 * 60 * 1_000 - 5 * 60 * 1_000;
const MAXIMUM_EVIDENCE_FUTURE_SKEW_MS = 5 * 60 * 1_000;
const MAXIMUM_REPORT_TO_ARTIFACT_DELAY_MS = 60 * 60 * 1_000;

function artifactRetentionValid(run: FinalizationEvidenceRun | null): boolean {
  if (run === null || !run.artifactPresent || run.artifactExpired !== false
      || typeof run.artifactCreatedAt !== "string" || typeof run.artifactExpiresAt !== "string") return false;
  const createdAt = Date.parse(run.artifactCreatedAt);
  const expiresAt = Date.parse(run.artifactExpiresAt);
  return Number.isFinite(createdAt) && Number.isFinite(expiresAt)
    && expiresAt > createdAt && expiresAt - createdAt >= MINIMUM_ARTIFACT_RETENTION_MS;
}

function artifactTimestampValid(run: FinalizationEvidenceRun | null, reportTimestamp: unknown): boolean {
  if (run === null || typeof run.artifactCreatedAt !== "string" || typeof reportTimestamp !== "string") return false;
  const artifactCreatedAt = Date.parse(run.artifactCreatedAt);
  const reportedAt = Date.parse(reportTimestamp);
  return Number.isFinite(artifactCreatedAt) && Number.isFinite(reportedAt)
    && reportedAt <= artifactCreatedAt + MAXIMUM_EVIDENCE_FUTURE_SKEW_MS
    && artifactCreatedAt <= reportedAt + MAXIMUM_REPORT_TO_ARTIFACT_DELAY_MS;
}

function acceptedWebManifestSha256(
  evidence: unknown,
): string | null {
  if (!Array.isArray(evidence)) return null;
  const matches = evidence.filter((item) => object(item)?.name === "webDeployment");
  const match = object(matches[0]);
  return matches.length === 1 && match?.status === "pass"
    && typeof match.sha256 === "string" && /^[a-fA-F0-9]{64}$/u.test(match.sha256)
    ? match.sha256.toLowerCase()
    : null;
}

function acceptanceManifestSha256(report: JsonObject | null): string | null {
  const stagingBundle = object(report?.stagingEvidenceBundle);
  const evidence = Array.isArray(report?.evidence) ? report.evidence : [];
  const checkedAt = typeof report?.checkedAt === "string" ? report.checkedAt : "";
  const checkedAtMs = Date.parse(checkedAt);
  const stagingMaximumAgeHours = stagingBundle?.maximumAgeHours;
  const canonicalEvidence: Array<{
    name: string;
    sha256: string;
    maximumAgeHours: number;
    status: "pass";
  }> = [];
  const evidenceValid = evidence.length === RELEASE_EVIDENCE_NAMES.length && evidence.every((item, index) => {
    const entry = object(item);
    const expectedName = RELEASE_EVIDENCE_NAMES[index];
    const name = entry?.name;
    const sha256 = entry?.sha256;
    const maximumAgeHours = entry?.maximumAgeHours;
    if (typeof expectedName !== "string" || typeof name !== "string" || name !== expectedName
        || entry?.status !== "pass" || typeof sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(sha256)
        || typeof maximumAgeHours !== "number" || !Number.isInteger(maximumAgeHours)
        || maximumAgeHours < 1 || maximumAgeHours > 24 * 366) return false;
    canonicalEvidence.push({
      name,
      sha256,
      maximumAgeHours,
      status: "pass",
    });
    return true;
  });
  if (!evidenceValid || report?.ok !== true
      || typeof report.releaseId !== "string" || !/^[A-Za-z0-9._-]{1,80}$/u.test(report.releaseId)
      || typeof report.commitSha !== "string" || !/^[a-f0-9]{40}$/u.test(report.commitSha)
      || typeof report.imageDigest !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(report.imageDigest)
      || typeof report.imageReference !== "string" || report.imageReference.includes("://")
      || !report.imageReference.endsWith(`@${report.imageDigest}`)
      || !Number.isFinite(checkedAtMs) || new Date(checkedAtMs).toISOString() !== checkedAt
      || stagingBundle?.status !== "pass"
      || typeof stagingBundle.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(stagingBundle.sha256)
      || !Number.isInteger(stagingMaximumAgeHours)
      || Number(stagingMaximumAgeHours) < 1 || Number(stagingMaximumAgeHours) > 24 * 30
      || typeof report.manifestSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(report.manifestSha256)) return null;
  const manifestSource = JSON.stringify({
    releaseId: report.releaseId,
    commitSha: report.commitSha,
    imageReference: report.imageReference,
    imageDigest: report.imageDigest,
    checkedAt,
    stagingEvidenceBundle: {
      status: stagingBundle.status,
      sha256: stagingBundle.sha256,
      maximumAgeHours: stagingMaximumAgeHours,
    },
    evidence: canonicalEvidence,
  });
  const recalculated = createHash("sha256").update(manifestSource, "utf8").digest("hex");
  return report.manifestSha256 === recalculated ? recalculated : null;
}

function acceptanceEvidenceDetailsValid(
  run: FinalizationEvidenceRun | null,
  report: JsonObject | null,
  commitSha: string,
): boolean {
  const checkedAtMs = Date.parse(typeof report?.checkedAt === "string" ? report.checkedAt : "");
  const evidence = Array.isArray(report?.evidence) ? report.evidence : [];
  if (!Number.isFinite(checkedAtMs) || evidence.length !== RELEASE_EVIDENCE_NAMES.length) return false;
  return evidence.every((item, index) => {
    const entry = object(item);
    const name = RELEASE_EVIDENCE_NAMES[index];
    if (typeof name !== "string" || entry?.name !== name || typeof entry.maximumAgeHours !== "number"
        || !Number.isInteger(entry.maximumAgeHours) || entry.maximumAgeHours < 1
        || entry.maximumAgeHours > 24 * 366
        || !orderedNamedChecksPassed(entry.checks, ACCEPTANCE_EVIDENCE_CHECKS[name])) return false;
    const original = object(run?.relatedReports?.[ACCEPTANCE_EVIDENCE_FILES[name]]);
    const originalTimestamp = name === "preflight" ? original?.checkedAt
      : name === "webDeployment" || name === "supplyChain" ? original?.generatedAt : original?.completedAt;
    const observedAtMs = Date.parse(typeof originalTimestamp === "string" ? originalTimestamp : "");
    if (original?.commitSha !== commitSha || !Number.isFinite(observedAtMs)) return false;
    const observedAt = new Date(observedAtMs).toISOString();
    const ageHours = Math.round(((checkedAtMs - observedAtMs) / 3_600_000) * 100) / 100;
    return entry.observedAt === observedAt && entry.ageHours === ageHours
      && ageHours >= -(5 / 60) && ageHours <= entry.maximumAgeHours;
  });
}

function acceptanceEvidenceReproducible(
  run: FinalizationEvidenceRun | null,
  report: JsonObject | null,
): boolean {
  const checkedAt = typeof report?.checkedAt === "string" ? report.checkedAt : "";
  const checkedAtMs = Date.parse(checkedAt);
  const evidence = Array.isArray(report?.evidence) ? report.evidence : [];
  const stagingBundle = run?.relatedReports?.["staging-evidence-bundle.json"];
  const stagingBundleSha256 = run?.relatedSha256?.["staging-evidence-bundle.json"];
  const stagingSummary = object(report?.stagingEvidenceBundle);
  if (!Number.isFinite(checkedAtMs) || new Date(checkedAtMs).toISOString() !== checkedAt
      || typeof report?.releaseId !== "string" || typeof report.commitSha !== "string"
      || typeof report.imageReference !== "string" || evidence.length !== RELEASE_EVIDENCE_NAMES.length
      || typeof stagingBundleSha256 !== "string"
      || typeof stagingSummary?.maximumAgeHours !== "number") return false;

  const reports = {} as Record<ReleaseEvidenceName, unknown>;
  const evidenceSha256 = {} as Record<ReleaseEvidenceName, string>;
  const maximumAgeHours = {} as Record<ReleaseEvidenceName, number>;
  for (let index = 0; index < RELEASE_EVIDENCE_NAMES.length; index += 1) {
    const name = RELEASE_EVIDENCE_NAMES[index]!;
    const entry = object(evidence[index]);
    const sha256 = run?.relatedSha256?.[ACCEPTANCE_EVIDENCE_FILES[name]];
    if (entry?.name !== name || typeof sha256 !== "string" || entry.sha256 !== sha256
        || typeof entry.maximumAgeHours !== "number") return false;
    reports[name] = run?.relatedReports?.[ACCEPTANCE_EVIDENCE_FILES[name]];
    evidenceSha256[name] = sha256;
    maximumAgeHours[name] = entry.maximumAgeHours;
  }

  try {
    const reproduced = new ReleaseAcceptanceService(() => new Date(checkedAtMs)).run({
      releaseId: report.releaseId,
      commitSha: report.commitSha,
      imageReference: report.imageReference,
      reports,
      evidenceSha256,
      maximumAgeHours,
      stagingEvidenceBundle: stagingBundle,
      stagingEvidenceBundleSha256: stagingBundleSha256,
      stagingEvidenceBundleMaximumAgeHours: stagingSummary.maximumAgeHours,
    });
    return reproduced.ok === true && isDeepStrictEqual(reproduced, report);
  } catch {
    return false;
  }
}

function stagingBundleOriginalValid(
  run: FinalizationEvidenceRun | null,
  releaseId: string | null,
  commitSha: string,
  expectedFileSha256: string,
): boolean {
  const report = object(run?.relatedReports?.["staging-evidence-bundle.json"]);
  const checks = Array.isArray(report?.checks) ? report.checks : [];
  const sources = Array.isArray(report?.sources) ? report.sources : [];
  const canonicalChecks: Array<{ name: string; status: "pass"; code: "OK" }> = [];
  const checksValid = checks.length === STAGING_BUNDLE_CHECKS.length && checks.every((item, index) => {
    const entry = object(item);
    const expectedName = STAGING_BUNDLE_CHECKS[index];
    if (typeof expectedName !== "string" || entry?.name !== expectedName
        || entry.status !== "pass" || entry.code !== "OK") return false;
    canonicalChecks.push({ name: expectedName, status: "pass", code: "OK" });
    return true;
  });
  const canonicalSources: Array<{ name: string; sha256: string; observedAt: string }> = [];
  const sourcesValid = sources.length === STAGING_BUNDLE_SOURCES.length && sources.every((item, index) => {
    const entry = object(item);
    const expectedName = STAGING_BUNDLE_SOURCES[index];
    const sha256 = entry?.sha256;
    const observedAt = entry?.observedAt;
    if (typeof expectedName !== "string" || entry?.name !== expectedName
        || typeof sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(sha256)
        || typeof observedAt !== "string" || !Number.isFinite(Date.parse(observedAt))
        || run?.relatedSha256?.[STAGING_SOURCE_FILES[expectedName]] !== sha256) return false;
    canonicalSources.push({ name: expectedName, sha256, observedAt });
    return true;
  });
  const checkedAt = report?.checkedAt;
  const maximumAgeHours = report?.maximumAgeHours;
  if (!checksValid || !sourcesValid || report?.schemaVersion !== 1 || report.ok !== true
      || releaseId === null || report.releaseId !== releaseId || report.candidateCommitSha !== commitSha
      || !Number.isSafeInteger(report.loadTestRunId) || Number(report.loadTestRunId) < 1
      || !Number.isSafeInteger(report.workerSoakRunId) || Number(report.workerSoakRunId) < 1
      || typeof checkedAt !== "string" || !Number.isFinite(Date.parse(checkedAt))
      || new Date(Date.parse(checkedAt)).toISOString() !== checkedAt
      || typeof maximumAgeHours !== "number" || !Number.isInteger(maximumAgeHours)
      || maximumAgeHours < 1 || maximumAgeHours > 24 * 30
      || typeof report.evidenceSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(report.evidenceSha256)
      || run?.relatedSha256?.["staging-evidence-bundle.json"] !== expectedFileSha256) return false;
  const baseReport = {
    schemaVersion: 1,
    ok: true,
    releaseId,
    candidateCommitSha: commitSha,
    loadTestRunId: report.loadTestRunId,
    workerSoakRunId: report.workerSoakRunId,
    checkedAt,
    maximumAgeHours,
    checks: canonicalChecks,
    sources: canonicalSources,
  };
  return report.evidenceSha256 === createHash("sha256").update(JSON.stringify(baseReport)).digest("hex");
}

function acceptanceValid(
  run: FinalizationEvidenceRun | null,
  releaseId: string | null,
  commitSha: string,
  imageReference: string | null,
): {
  valid: boolean;
  manifestSha256: string | null;
  webManifestSha256: string | null;
  stagingBundleSha256: string | null;
} {
  const report = object(run?.report);
  const manifestSha256 = acceptanceManifestSha256(report);
  const webManifestSha256 = acceptedWebManifestSha256(report?.evidence);
  const stagingBundle = object(report?.stagingEvidenceBundle);
  const stagingBundleSha256 = stagingBundle?.status === "pass" && typeof stagingBundle.sha256 === "string"
    && /^[a-f0-9]{64}$/u.test(stagingBundle.sha256)
    && allNamedChecksPassed(stagingBundle.checks, ACCEPTANCE_STAGING_CHECKS)
    && stagingBundleOriginalValid(run, releaseId, commitSha, stagingBundle.sha256)
    ? stagingBundle.sha256.toLowerCase() : null;
  const expectedEvidence = new Set([
    "preflight", "recovery", "readOnlyLoad", "workerSoak", "webDeployment", "fieldValidation", "supplyChain",
  ]);
  const evidence = Array.isArray(report?.evidence) ? report.evidence : [];
  const evidenceFilesValid = evidence.length === RELEASE_EVIDENCE_NAMES.length && evidence.every((item) => {
    const entry = object(item);
    if (typeof entry?.name !== "string" || !(entry.name in ACCEPTANCE_EVIDENCE_FILES)
        || typeof entry.sha256 !== "string") return false;
    const name = entry.name as keyof typeof ACCEPTANCE_EVIDENCE_FILES;
    return run?.relatedSha256?.[ACCEPTANCE_EVIDENCE_FILES[name]] === entry.sha256;
  });
  const allEvidencePassed = evidence.length === expectedEvidence.size && evidence.every((item) => {
    const entry = object(item);
    return typeof entry?.name === "string" && expectedEvidence.delete(entry.name)
      && entry.status === "pass";
  }) && expectedEvidence.size === 0;
  const evidenceDetailsValid = acceptanceEvidenceDetailsValid(run, report, commitSha);
  const evidenceReproducible = acceptanceEvidenceReproducible(run, report);
  return {
    valid: run !== null && artifactRetentionValid(run) && report?.ok === true
      && releaseId !== null && report.releaseId === releaseId
      && report.commitSha === commitSha
      && imageReference !== null && report.imageReference === imageReference
      && typeof report.imageDigest === "string" && report.imageDigest === imageReference.split("@")[1]
      && manifestSha256 !== null
      && artifactTimestampValid(run, report.checkedAt)
      && allEvidencePassed && evidenceFilesValid && evidenceDetailsValid && evidenceReproducible
      && webManifestSha256 !== null && stagingBundleSha256 !== null,
    manifestSha256,
    webManifestSha256,
    stagingBundleSha256,
  };
}

function deploymentVerificationDetailsValid(report: JsonObject | null): boolean {
  const samples = object(report?.samples);
  const latency = object(report?.latencyMs);
  const threshold = object(report?.threshold);
  const web = object(report?.web);
  const planned = samples?.planned;
  const p50 = latency?.p50;
  const p95 = latency?.p95;
  const p99 = latency?.p99;
  const maximum = latency?.max;
  const maximumP95Ms = threshold?.maximumP95Ms;
  const startedAt = typeof report?.startedAt === "string" ? report.startedAt : "";
  const completedAt = typeof report?.completedAt === "string" ? report.completedAt : "";
  const startedAtMs = Date.parse(startedAt);
  const completedAtMs = Date.parse(completedAt);
  return Number.isSafeInteger(planned) && Number(planned) >= 1 && Number(planned) <= 100
    && samples?.completed === planned && samples?.failed === 0
    && samples?.livenessFailures === 0 && samples?.readinessFailures === 0 && samples?.identityMismatches === 0
    && Array.isArray(report?.failures) && report.failures.length === 0
    && typeof p50 === "number" && Number.isFinite(p50) && p50 >= 0
    && typeof p95 === "number" && Number.isFinite(p95) && p95 >= p50
    && typeof p99 === "number" && Number.isFinite(p99) && p99 >= p95
    && typeof maximum === "number" && Number.isFinite(maximum) && maximum >= p99
    && typeof maximumP95Ms === "number" && Number.isInteger(maximumP95Ms)
    && maximumP95Ms >= 1 && maximumP95Ms <= 60_000 && threshold?.latencyMet === true && p95 <= maximumP95Ms
    && Number.isFinite(startedAtMs) && new Date(startedAtMs).toISOString() === startedAt
    && Number.isFinite(completedAtMs) && new Date(completedAtMs).toISOString() === completedAt
    && startedAtMs <= completedAtMs && web?.checkedAt === completedAt
    && orderedNamedChecksPassed(web?.checks, WEB_VERIFICATION_CHECKS);
}

function evidenceDigestMatches(report: JsonObject | null, source: JsonObject): boolean {
  return typeof report?.evidenceSha256 === "string" && /^[a-f0-9]{64}$/u.test(report.evidenceSha256)
    && report.evidenceSha256 === createHash("sha256").update(JSON.stringify(source), "utf8").digest("hex");
}

function auxiliaryEvidenceDigestsValid(
  transport: JsonObject | null,
  mail: JsonObject | null,
  legal: JsonObject | null,
): boolean {
  const transportArtifacts = object(transport?.artifacts);
  const transportActive = object(transport?.activeTransports);
  const transportTlsEndpoints = object(transport?.tlsEndpoints);
  const mailArtifacts = object(mail?.artifacts);
  const mailDnsEvidence = object(mail?.dnsEvidence);
  const legalArtifacts = object(legal?.artifacts);
  if (!orderedNamedChecksPassed(transport?.checks, TRANSPORT_CHECKS)
      || !orderedNamedChecksPassed(mail?.checks, MAIL_CHECKS)
      || !orderedNamedChecksPassed(legal?.checks, LEGAL_CHECKS)
      || transportArtifacts === null || transportActive === null || transportTlsEndpoints === null
      || mailArtifacts === null || mailDnsEvidence === null || legalArtifacts === null) return false;
  const passedChecks = (value: unknown) => (value as Array<{ name: string; status: "pass" }>).map(
    ({ name, status }) => ({ name, status }),
  );
  const transportSource = {
    schemaVersion: 3,
    releaseId: transport?.releaseId,
    commitSha: transport?.commitSha,
    checkedAt: transport?.checkedAt,
    preflightCheckedAt: transport?.preflightCheckedAt,
    deploymentVerifiedAt: transport?.deploymentVerifiedAt,
    activeTransports: transportActive,
    minimumCertificateValidityDays: transport?.minimumCertificateValidityDays,
    tlsEndpoints: transportTlsEndpoints,
    artifacts: transportArtifacts,
    checks: passedChecks(transport?.checks),
  };
  const mailSource = {
    schemaVersion: 2,
    releaseId: mail?.releaseId,
    commitSha: mail?.commitSha,
    checkedAt: mail?.checkedAt,
    preflightCheckedAt: mail?.preflightCheckedAt,
    providerEventIdSha256: mail?.providerEventIdSha256,
    auditLogId: mail?.auditLogId,
    dnsEvidence: mailDnsEvidence,
    artifacts: mailArtifacts,
    checks: passedChecks(mail?.checks),
  };
  const legalSource = {
    schemaVersion: 2,
    releaseId: legal?.releaseId,
    commitSha: legal?.commitSha,
    checkedAt: legal?.checkedAt,
    policyVersion: legal?.policyVersion,
    approvedAt: legal?.approvedAt,
    documentSha256: legal?.documentSha256,
    artifacts: legalArtifacts,
    checks: passedChecks(legal?.checks),
  };
  return evidenceDigestMatches(transport, transportSource)
    && evidenceDigestMatches(mail, mailSource)
    && evidenceDigestMatches(legal, legalSource);
}

function verificationValid(
  run: FinalizationEvidenceRun | null,
  releaseId: string | null,
  commitSha: string,
  imageDigest: string | null,
  webManifestSha256: string | null,
): boolean {
  const report = object(run?.report);
  const expected = object(report?.expected);
  const web = object(report?.web);
  const webExpected = object(web?.expected);
  const transport = object(run?.relatedReports?.["transport-security-evidence.json"]);
  const mail = object(run?.relatedReports?.["mail-operations-evidence.json"]);
  const legal = object(run?.relatedReports?.["legal-approval-binding.json"]);
  const transportArtifacts = object(transport?.artifacts);
  const mailArtifacts = object(mail?.artifacts);
  const legalArtifacts = object(legal?.artifacts);
  const deploymentAt = Date.parse(typeof report?.completedAt === "string" ? report.completedAt : "");
  const transportAt = Date.parse(typeof transport?.checkedAt === "string" ? transport.checkedAt : "");
  const mailAt = Date.parse(typeof mail?.checkedAt === "string" ? mail.checkedAt : "");
  const legalAt = Date.parse(typeof legal?.checkedAt === "string" ? legal.checkedAt : "");
  const auxiliaryLineageValid = typeof run?.reportSha256 === "string"
    && transportArtifacts?.deploymentVerificationSha256 === run.reportSha256
    && typeof transportArtifacts?.preflightSha256 === "string"
    && transportArtifacts.preflightSha256 === mailArtifacts?.preflightSha256
    && transportArtifacts.preflightSha256 === legalArtifacts?.preflightSha256
    && typeof transportArtifacts.environmentSha256 === "string"
    && transportArtifacts.environmentSha256 === legalArtifacts?.environmentSha256
    && [deploymentAt, transportAt, mailAt, legalAt].every(Number.isFinite)
    && deploymentAt <= transportAt && transportAt <= mailAt && mailAt <= legalAt
    && artifactTimestampValid(run, transport?.checkedAt)
    && artifactTimestampValid(run, mail?.checkedAt)
    && artifactTimestampValid(run, legal?.checkedAt);
  const auxiliaryEvidenceValid = releaseId !== null &&
    transport?.schemaVersion === 3 && transport?.releaseId === releaseId && transport?.ok === true &&
    transport.commitSha === commitSha && transport.deploymentVerifiedAt === report?.completedAt &&
    allNamedChecksPassed(transport.checks, TRANSPORT_CHECKS) &&
    mail?.schemaVersion === 2 && mail?.releaseId === releaseId && mail?.ok === true && mail.commitSha === commitSha &&
    mail.preflightCheckedAt === transport.preflightCheckedAt && allNamedChecksPassed(mail.checks, MAIL_CHECKS) &&
    !("providerEventId" in (mail ?? {})) &&
    legal?.schemaVersion === 2 && legal?.releaseId === releaseId && legal?.ok === true && legal.commitSha === commitSha &&
    allNamedChecksPassed(legal.checks, LEGAL_CHECKS) &&
    typeof legalArtifacts?.preflightSha256 === "string" &&
    legalArtifacts.preflightSha256 === mailArtifacts?.preflightSha256 &&
    auxiliaryEvidenceDigestsValid(transport, mail, legal) && auxiliaryLineageValid;
  return run !== null && artifactRetentionValid(run) && report?.ok === true && report.rollbackRecommended === false
    && releaseId !== null && successfulDeploymentVerificationEvidenceValid(report, releaseId)
    && expected?.commitSha === commitSha && imageDigest !== null && expected.imageDigest === imageDigest
    && web?.ok === true && webExpected?.commitSha === commitSha
    && webManifestSha256 !== null && webExpected.manifestSha256 === webManifestSha256
    && artifactTimestampValid(run, report.completedAt)
    && deploymentVerificationDetailsValid(report) && auxiliaryEvidenceValid;
}

function closeoutValid(
  run: FinalizationEvidenceRun | null,
  releaseId: string | null,
  commitSha: string,
  imageReference: string | null,
  imageDigest: string | null,
  webManifestSha256: string | null,
  stagingBundleSha256: string | null,
  acceptanceManifestSha256: string | null,
  acceptanceReportSha256: string | null,
  verificationReportSha256: string | null,
  verificationRelatedSha256: Record<string, string | null> | undefined,
  acceptanceCheckedAt: string | null,
  verificationCompletedAt: string | null,
  maximumVerificationDelayHours: number,
): boolean {
  const report = object(run?.report);
  const artifacts = object(report?.artifacts);
  const timeline = object(report?.timeline);
  const hashes = run?.relatedSha256;
  const artifactHashesValid = typeof artifacts?.acceptanceSha256 === "string" &&
    artifacts.acceptanceSha256 === hashes?.["release-acceptance.json"] &&
    artifacts.acceptanceSha256 === acceptanceReportSha256 &&
    typeof artifacts.deploymentVerificationSha256 === "string" &&
    artifacts.deploymentVerificationSha256 === hashes?.["production-deployment-verification.json"] &&
    artifacts.deploymentVerificationSha256 === verificationReportSha256 &&
    typeof artifacts.transportSecuritySha256 === "string" &&
    artifacts.transportSecuritySha256 === hashes?.["transport-security-evidence.json"] &&
    artifacts.transportSecuritySha256 === verificationRelatedSha256?.["transport-security-evidence.json"] &&
    typeof artifacts.mailOperationsSha256 === "string" &&
    artifacts.mailOperationsSha256 === hashes?.["mail-operations-evidence.json"] &&
    artifacts.mailOperationsSha256 === verificationRelatedSha256?.["mail-operations-evidence.json"] &&
    typeof artifacts.legalApprovalBindingSha256 === "string" &&
    artifacts.legalApprovalBindingSha256 === hashes?.["legal-approval-binding.json"] &&
    artifacts.legalApprovalBindingSha256 === verificationRelatedSha256?.["legal-approval-binding.json"];
  const acceptedAtMs = Date.parse(acceptanceCheckedAt ?? "");
  const verifiedAtMs = Date.parse(verificationCompletedAt ?? "");
  const closedAtMs = Date.parse(typeof report?.closedAt === "string" ? report.closedAt : "");
  const verificationDelayMinutes = Number.isFinite(acceptedAtMs) && Number.isFinite(verifiedAtMs)
    ? Math.round(((verifiedAtMs - acceptedAtMs) / 60_000) * 100) / 100 : null;
  const timelineValid = verificationDelayMinutes !== null && verificationDelayMinutes >= 0
    && verificationDelayMinutes <= maximumVerificationDelayHours * 60
    && Number.isFinite(closedAtMs) && verifiedAtMs <= closedAtMs + 5 * 60_000
    && acceptedAtMs <= closedAtMs + 5 * 60_000
    && timeline?.acceptedAt === new Date(acceptedAtMs).toISOString()
    && timeline?.verifiedAt === new Date(verifiedAtMs).toISOString()
    && timeline?.verificationDelayMinutes === verificationDelayMinutes
    && timeline?.maximumVerificationDelayHours === maximumVerificationDelayHours;
  return run !== null && artifactRetentionValid(run) && report?.ok === true
    && artifactTimestampValid(run, report.closedAt)
    && releaseId !== null && report.releaseId === releaseId
    && report.commitSha === commitSha && imageReference !== null && report.imageReference === imageReference
    && imageDigest !== null && report.imageDigest === imageDigest
    && webManifestSha256 !== null && report.webDeploymentManifestSha256 === webManifestSha256
    && stagingBundleSha256 !== null && report.stagingEvidenceBundleSha256 === stagingBundleSha256
    && acceptanceManifestSha256 !== null && report.acceptanceManifestSha256 === acceptanceManifestSha256
    && allNamedChecksPassed(report.checks, CLOSEOUT_CHECKS) && artifactHashesValid && timelineValid
    && closeoutDigestValid(report, artifacts);
}

export class ReleaseFinalizationCoordinatorService {
  plan(input: ReleaseFinalizationCoordinatorInput): ReleaseFinalizationCoordinatorReport {
    if (!validRepository(input.repository)) throw coordinatorError("RELEASE_FINALIZATION_REPOSITORY_INVALID");
    if (!validLogin(input.actorLogin)) throw coordinatorError("RELEASE_FINALIZATION_ACTOR_INVALID");
    if (!validBranch(input.defaultBranch)) throw coordinatorError("RELEASE_FINALIZATION_BRANCH_INVALID");
    if (!/^[a-fA-F0-9]{40}$/u.test(input.localCommitSha)
        || !/^[a-fA-F0-9]{40}$/u.test(input.remoteDefaultCommitSha)) {
      throw coordinatorError("RELEASE_FINALIZATION_COMMIT_INVALID");
    }
    if (!Number.isSafeInteger(input.dirtyFileCount) || input.dirtyFileCount < 0) {
      throw coordinatorError("RELEASE_FINALIZATION_DIRTY_COUNT_INVALID");
    }
    if (!validRegistryHost(input.registryHost)) throw coordinatorError("RELEASE_FINALIZATION_REGISTRY_INVALID");
    if (!Number.isInteger(input.maximumVerificationDelayHours)
        || input.maximumVerificationDelayHours < 1 || input.maximumVerificationDelayHours > 168) {
      throw coordinatorError("RELEASE_FINALIZATION_MAXIMUM_DELAY_INVALID");
    }
    if (![input.acceptance, input.verification, input.closeout].every(validRun)
        || ![input.acceptanceActiveRunId, input.verificationActiveRunId, input.closeoutActiveRunId]
          .every(validOptionalRunId)) {
      throw coordinatorError("RELEASE_FINALIZATION_RUN_INVALID");
    }

    const candidateCommitSha = input.localCommitSha.toLowerCase();
    const releaseIdValid = input.releaseId !== null && /^[A-Za-z0-9._-]{1,80}$/u.test(input.releaseId);
    const imageReferenceValid = validImageReference(input.imageReference, input.registryHost);
    const imageDigest = imageReferenceValid ? input.imageReference?.split("@")[1] ?? null : null;
    const acceptance = acceptanceValid(
      input.acceptance,
      releaseIdValid ? input.releaseId : null,
      candidateCommitSha,
      imageReferenceValid ? input.imageReference : null,
    );
    const verificationIsValid = verificationValid(
      input.verification,
      releaseIdValid ? input.releaseId : null,
      candidateCommitSha,
      imageDigest,
      acceptance.webManifestSha256,
    );
    const acceptanceReport = object(input.acceptance?.report);
    const verificationReport = object(input.verification?.report);
    const closeoutIsValid = closeoutValid(
      input.closeout,
      releaseIdValid ? input.releaseId : null,
      candidateCommitSha,
      imageReferenceValid ? input.imageReference : null,
      imageDigest,
      acceptance.webManifestSha256,
      acceptance.stagingBundleSha256,
      acceptance.manifestSha256,
      input.acceptance?.reportSha256 ?? null,
      input.verification?.reportSha256 ?? null,
      input.verification?.relatedSha256,
      typeof acceptanceReport?.checkedAt === "string" ? acceptanceReport.checkedAt : null,
      typeof verificationReport?.completedAt === "string" ? verificationReport.completedAt : null,
      input.maximumVerificationDelayHours,
    );
    const verificationSecrets = new Set(input.productionSecretNames);
    const verificationSecretNames = REQUIRED_PRODUCTION_SECRETS;
    const hasInvalidAcceptance = input.acceptance !== null && !acceptance.valid;
    const hasInvalidVerification = input.verification !== null && !verificationIsValid;
    const hasInvalidCloseout = input.closeout !== null && !closeoutIsValid;
    let action: ReleaseFinalizationCoordinatorReport["action"] = null;
    if (acceptance.valid && !input.verification && input.verificationActiveRunId === null) {
      action = { kind: "verifyDeployment", workflow: "production-deployment-verification.yml", webManifestSha256: acceptance.webManifestSha256! };
    } else if (acceptance.valid && verificationIsValid && !input.closeout && input.closeoutActiveRunId === null) {
      action = { kind: "closeout", workflow: "release-closeout.yml" };
    }
    const checks: FinalizationCheck[] = [
      check(
        "soloOperator",
        input.actorLogin.toLowerCase() === SOLO_RELEASE_OPERATOR_LOGIN.toLowerCase(),
        "RELEASE_FINALIZATION_SOLO_OPERATOR_MISMATCH",
      ),
      check(
        "candidatePublished",
        input.remoteDefaultCommitSha.toLowerCase() === candidateCommitSha,
        "RELEASE_FINALIZATION_CANDIDATE_NOT_PUBLISHED",
      ),
      check("workingTree", input.dirtyFileCount === 0, "RELEASE_FINALIZATION_WORKING_TREE_NOT_CLEAN"),
      check(
        "input:releaseId",
        releaseIdValid,
        input.releaseId === null ? "RELEASE_FINALIZATION_RELEASE_ID_MISSING" : "RELEASE_FINALIZATION_RELEASE_ID_INVALID",
      ),
      check(
        "input:imageReference",
        imageReferenceValid,
        input.imageReference === null ? "RELEASE_FINALIZATION_IMAGE_REFERENCE_MISSING" : "RELEASE_FINALIZATION_IMAGE_REFERENCE_INVALID",
      ),
      check(
        "evidence:acceptance",
        acceptance.valid || input.acceptanceActiveRunId !== null,
        hasInvalidAcceptance ? "RELEASE_FINALIZATION_ACCEPTANCE_INVALID" : "RELEASE_FINALIZATION_ACCEPTANCE_MISSING",
      ),
      ...(action?.kind === "verifyDeployment" ? [
        ...verificationSecretNames.map((name) => check(
          `secret:${name}`,
          verificationSecrets.has(name),
          "RELEASE_FINALIZATION_PRODUCTION_SECRET_MISSING",
        )),
        check(
          "deploymentConfirmation",
          input.deploymentConfirmation === PRODUCTION_DEPLOYMENT_CONFIRMATION,
          "RELEASE_FINALIZATION_DEPLOYMENT_CONFIRMATION_REQUIRED",
        ),
      ] : []),
      check("evidence:verificationIntegrity", !hasInvalidVerification, "RELEASE_FINALIZATION_VERIFICATION_INVALID"),
      check("evidence:closeoutIntegrity", !hasInvalidCloseout, "RELEASE_FINALIZATION_CLOSEOUT_INVALID"),
      check(
        "retention:acceptance",
        input.acceptance === null || artifactRetentionValid(input.acceptance),
        "RELEASE_FINALIZATION_ACCEPTANCE_RETENTION_INVALID",
      ),
      check(
        "retention:verification",
        input.verification === null || artifactRetentionValid(input.verification),
        "RELEASE_FINALIZATION_VERIFICATION_RETENTION_INVALID",
      ),
      check(
        "retention:closeout",
        input.closeout === null || artifactRetentionValid(input.closeout),
        "RELEASE_FINALIZATION_CLOSEOUT_RETENTION_INVALID",
      ),
      check(
        "applyConfirmation",
        !input.applyRequested || input.confirmation === SOLO_RELEASE_CONFIRMATION,
        "RELEASE_FINALIZATION_CONFIRMATION_REQUIRED",
      ),
    ];
    const ok = checks.every(({ status }) => status === "pass");
    let stage: ReleaseFinalizationCoordinatorReport["stage"] = "blocked";
    if (input.acceptanceActiveRunId !== null && input.acceptance === null) stage = "acceptance-in-progress";
    else if (acceptance.valid && verificationIsValid && closeoutIsValid) stage = "complete";
    else if (acceptance.valid && verificationIsValid && input.closeoutActiveRunId !== null) {
      stage = "closeout-in-progress";
    } else if (action?.kind === "closeout" && ok) stage = "closeout-ready";
    else if (acceptance.valid && input.verificationActiveRunId !== null) stage = "verification-in-progress";
    else if (action?.kind === "verifyDeployment" && ok) stage = "verification-ready";

    return {
      ok,
      mode: input.applyRequested ? "apply" : "dry-run",
      repository: input.repository,
      releaseId: releaseIdValid ? input.releaseId : null,
      candidateCommitSha,
      stage,
      checks,
      acceptanceRunId: input.acceptance?.runId ?? input.acceptanceActiveRunId,
      verificationRunId: input.verification?.runId ?? input.verificationActiveRunId,
      closeoutRunId: input.closeout?.runId ?? input.closeoutActiveRunId,
      action,
      applyAuthorized: input.applyRequested && ok && action !== null,
    };
  }
}
