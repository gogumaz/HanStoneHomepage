import { createHash } from "node:crypto";

export const RELEASE_EVIDENCE_NAMES = [
  "preflight",
  "recovery",
  "readOnlyLoad",
  "workerSoak",
  "webDeployment",
  "fieldValidation",
  "supplyChain",
] as const;

export type ReleaseEvidenceName = (typeof RELEASE_EVIDENCE_NAMES)[number];

export type ReleaseAcceptanceInput = {
  releaseId: string;
  commitSha: string;
  imageReference: string;
  reports: Record<ReleaseEvidenceName, unknown>;
  evidenceSha256: Record<ReleaseEvidenceName, string>;
  maximumAgeHours: Record<ReleaseEvidenceName, number>;
  stagingEvidenceBundle: unknown;
  stagingEvidenceBundleSha256: string;
  stagingEvidenceBundleMaximumAgeHours: number;
};

export type ReleaseAcceptanceReport = {
  ok: boolean;
  releaseId: string;
  commitSha: string;
  imageReference: string;
  imageDigest: string;
  manifestSha256: string;
  checkedAt: string;
  stagingEvidenceBundle: {
    status: "pass" | "fail";
    observedAt: string | null;
    ageHours: number | null;
    maximumAgeHours: number;
    sha256: string;
    checks: Array<{ name: string; status: "pass" | "fail"; code: string }>;
  };
  evidence: Array<{
    name: ReleaseEvidenceName;
    status: "pass" | "fail";
    observedAt: string | null;
    ageHours: number | null;
    maximumAgeHours: number;
    sha256: string;
    checks: Array<{ name: string; status: "pass" | "fail"; code: string }>;
  }>;
};

type JsonObject = Record<string, unknown>;
type EvidenceCheck = { name: string; status: "pass" | "fail"; code: string };

const PREFLIGHT_CHECKS = [
  "configuration",
  "recoveryPolicy",
  "database",
  "rateLimitStore",
  "objectStorage",
  "cdn",
  "hlsTranscoder",
  "malwareScanner",
  "smtp",
] as const;
const RECOVERY_CHECKS = ["migration", "criticalTables", "relationships", "rpo", "rto"] as const;
const WORKER_QUEUES = [
  "account_mail",
  "inquiry_notification",
  "video_scan",
  "hls_transcode",
  "object_deletion",
] as const;
const SUPPLY_CHAIN_ARTIFACTS = ["web", "api"] as const;
const WEB_REQUIRED_ENTRYPOINTS = ["index.html", "app.html", "payment/success.html", "payment/fail.html"] as const;
const WEB_IMMUTABLE_CACHE_CONTROL = "public,max-age=31536000,immutable";
const WEB_REVALIDATE_CACHE_CONTROL = "public,max-age=0,must-revalidate";
const FIELD_VALIDATION_PROJECTS = [
  "chromium",
  "field-firefox",
  "field-mobile-chrome",
  "field-mobile-safari",
] as const;
const SUPPLY_CHAIN_VULNERABILITY_POLICY = "npm-audit-production-high-critical-zero";
const STAGING_BUNDLE_CHECKS = [
  "sourceInventory",
  "candidateIdentity",
  "readOnlyLoad",
  "workerSoak",
  "controlledLoad",
  "execution",
  "concurrentObservation",
  "executionTimeline",
  "freshness",
] as const;
const STAGING_BUNDLE_SOURCES = ["readOnlyLoad", "workerSoak", "controlledLoad", "execution"] as const;

function acceptanceError(code: string): Error {
  const error = new Error(code);
  error.name = code;
  return error;
}

function object(value: unknown): JsonObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonObject : null;
}

function rounded(value: number): number {
  return Math.round(value * 100) / 100;
}

function booleanCheck(name: string, value: unknown, code: string): EvidenceCheck {
  return { name, status: value === true ? "pass" : "fail", code: value === true ? "OK" : code };
}

function namedStatuses(value: unknown): Map<string, unknown> {
  if (!Array.isArray(value)) return new Map();
  const result = new Map<string, unknown>();
  for (const item of value) {
    const entry = object(item);
    if (typeof entry?.name === "string" && !result.has(entry.name)) result.set(entry.name, entry.status);
  }
  return result;
}

function validatePreflight(report: JsonObject | null): EvidenceCheck[] {
  const checks = [booleanCheck("report", report?.ok, "PREFLIGHT_NOT_SUCCESSFUL")];
  const statuses = namedStatuses(report?.checks);
  for (const name of PREFLIGHT_CHECKS) {
    checks.push(booleanCheck(name, statuses.get(name) === "pass", "PREFLIGHT_CHECK_NOT_PASSED"));
  }
  return checks;
}

function validateRecovery(report: JsonObject | null): EvidenceCheck[] {
  const checks = [booleanCheck("report", report?.ok, "RECOVERY_NOT_SUCCESSFUL")];
  const statuses = namedStatuses(report?.checks);
  for (const name of RECOVERY_CHECKS) {
    checks.push(booleanCheck(name, statuses.get(name) === "pass", "RECOVERY_CHECK_NOT_PASSED"));
  }
  const objectives = object(report?.objectives);
  checks.push(booleanCheck("rpoObjective", objectives?.rpoMet, "RECOVERY_RPO_NOT_MET"));
  checks.push(booleanCheck("rtoObjective", objectives?.rtoMet, "RECOVERY_RTO_NOT_MET"));
  return checks;
}

function validateReadOnlyLoad(report: JsonObject | null): EvidenceCheck[] {
  const thresholds = object(report?.thresholds);
  const requests = object(report?.requests);
  const completed = requests?.completed;
  const planned = requests?.planned;
  return [
    booleanCheck("report", report?.ok, "LOAD_TEST_NOT_SUCCESSFUL"),
    booleanCheck("latency", thresholds?.latencyMet, "LOAD_TEST_LATENCY_NOT_MET"),
    booleanCheck("errorRate", thresholds?.errorRateMet, "LOAD_TEST_ERROR_RATE_NOT_MET"),
    booleanCheck(
      "completion",
      Number.isSafeInteger(planned) && Number(planned) > 0 && completed === planned,
      "LOAD_TEST_INCOMPLETE",
    ),
  ];
}

function validateWorkerSoak(report: JsonObject | null): EvidenceCheck[] {
  const thresholds = object(report?.thresholds);
  const samples = object(report?.samples);
  const plannedSamples = samples?.planned;
  const completedSamples = samples?.completed;
  const queues = Array.isArray(report?.queues) ? report.queues : [];
  const queueHealth = new Map<string, unknown>();
  for (const item of queues) {
    const queue = object(item);
    if (typeof queue?.name === "string" && !queueHealth.has(queue.name)) queueHealth.set(queue.name, queue.healthy);
  }
  const checks = [
    booleanCheck("report", report?.ok, "WORKER_SOAK_NOT_SUCCESSFUL"),
    booleanCheck("latency", thresholds?.latencyMet, "WORKER_SOAK_LATENCY_NOT_MET"),
    booleanCheck("criticalSamples", thresholds?.criticalSamplesMet, "WORKER_SOAK_CRITICAL_NOT_MET"),
    booleanCheck("queueHealth", thresholds?.queueHealthMet, "WORKER_SOAK_QUEUE_HEALTH_NOT_MET"),
    booleanCheck("metricsFreshness", thresholds?.metricsFreshnessMet, "WORKER_SOAK_METRICS_STALE"),
    booleanCheck(
      "completion",
      Number.isSafeInteger(plannedSamples) && Number(plannedSamples) >= 2 &&
        completedSamples === plannedSamples && samples?.failed === 0,
      "WORKER_SOAK_INCOMPLETE",
    ),
  ];
  for (const name of WORKER_QUEUES) {
    checks.push(booleanCheck(name, queueHealth.get(name), "WORKER_SOAK_QUEUE_NOT_HEALTHY"));
  }
  return checks;
}

function validateFieldValidation(report: JsonObject | null): EvidenceCheck[] {
  const checks = [
    booleanCheck("report", report?.ok, "FIELD_VALIDATION_NOT_SUCCESSFUL"),
    booleanCheck("schemaVersion", report?.schemaVersion === 1, "FIELD_VALIDATION_SCHEMA_VERSION_INVALID"),
  ];
  const projects = Array.isArray(report?.projects) ? report.projects : [];
  const byName = new Map<string, JsonObject>();
  let duplicateName = false;
  for (const item of projects) {
    const project = object(item);
    if (typeof project?.name !== "string") continue;
    if (byName.has(project.name)) duplicateName = true;
    else byName.set(project.name, project);
  }
  checks.push(booleanCheck(
    "projectInventory",
    projects.length === FIELD_VALIDATION_PROJECTS.length && !duplicateName &&
      FIELD_VALIDATION_PROJECTS.every((name) => byName.has(name)),
    "FIELD_VALIDATION_PROJECT_INVENTORY_INVALID",
  ));
  for (const name of FIELD_VALIDATION_PROJECTS) {
    const project = byName.get(name);
    checks.push(booleanCheck(
      name,
      project?.status === "pass" && Number.isSafeInteger(project.passed) && Number(project.passed) > 0 &&
        project.failed === 0 && project.flaky === 0,
      "FIELD_VALIDATION_PROJECT_NOT_PASSED",
    ));
  }
  const totals = object(report?.totals);
  checks.push(booleanCheck(
    "totals",
    Number.isSafeInteger(totals?.passed) && Number(totals?.passed) > 0 &&
      totals?.failed === 0 && totals?.flaky === 0,
    "FIELD_VALIDATION_TOTALS_INVALID",
  ));
  return checks;
}

function validateWebDeployment(report: JsonObject | null): EvidenceCheck[] {
  const checks = [
    booleanCheck("report", report?.ok, "WEB_DEPLOYMENT_NOT_SUCCESSFUL"),
    booleanCheck("schemaVersion", report?.schemaVersion === 1, "WEB_DEPLOYMENT_SCHEMA_VERSION_INVALID"),
  ];
  const files = Array.isArray(report?.files) ? report.files.map(object) : [];
  const byPath = new Map<string, JsonObject>();
  let duplicatePath = false;
  let unsafePath = false;
  for (const file of files) {
    if (typeof file?.path !== "string") {
      unsafePath = true;
      continue;
    }
    const segments = file.path.split("/");
    if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,1023}$/.test(file.path) ||
        segments.some((segment) => !segment || segment === "." || segment === "..")) {
      unsafePath = true;
    }
    if (byPath.has(file.path)) duplicatePath = true;
    else byPath.set(file.path, file);
  }
  checks.push(booleanCheck(
    "fileInventory",
    files.length > 0 && !duplicatePath && !unsafePath && byPath.size === files.length,
    "WEB_DEPLOYMENT_FILE_INVENTORY_INVALID",
  ));
  checks.push(booleanCheck(
    "entrypoints",
    WEB_REQUIRED_ENTRYPOINTS.every((path) => byPath.get(path)?.cacheControl === WEB_REVALIDATE_CACHE_CONTROL),
    "WEB_DEPLOYMENT_ENTRYPOINT_INVALID",
  ));
  checks.push(booleanCheck(
    "fileHashes",
    files.every((file) => typeof file?.sha256 === "string" && /^[a-fA-F0-9]{64}$/.test(file.sha256)),
    "WEB_DEPLOYMENT_FILE_SHA256_INVALID",
  ));
  checks.push(booleanCheck(
    "contentTypes",
    files.every((file) => typeof file?.contentType === "string" && file.contentType.length > 0),
    "WEB_DEPLOYMENT_CONTENT_TYPE_INVALID",
  ));
  checks.push(booleanCheck(
    "cachePolicy",
    files.every((file) => {
      if (typeof file?.path !== "string") return false;
      if (file.path.startsWith("assets/")) {
        return /-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/.test(file.path) &&
          file.cacheControl === WEB_IMMUTABLE_CACHE_CONTROL;
      }
      return file.cacheControl === WEB_REVALIDATE_CACHE_CONTROL;
    }),
    "WEB_DEPLOYMENT_CACHE_POLICY_INVALID",
  ));
  const totals = object(report?.totals);
  const totalBytes = files.reduce((sum, file) => (
    Number.isSafeInteger(file?.bytes) && Number(file?.bytes) >= 0 ? sum + Number(file?.bytes) : Number.NaN
  ), 0);
  checks.push(booleanCheck(
    "totals",
    Number.isSafeInteger(totals?.files) && totals?.files === files.length &&
      Number.isSafeInteger(totals?.bytes) && totals?.bytes === totalBytes,
    "WEB_DEPLOYMENT_TOTALS_INVALID",
  ));
  return checks;
}

function validateSupplyChain(report: JsonObject | null): EvidenceCheck[] {
  const checks = [
    booleanCheck("report", report?.ok, "SUPPLY_CHAIN_NOT_SUCCESSFUL"),
    booleanCheck(
      "schemaVersion",
      report?.schemaVersion === 1,
      "SUPPLY_CHAIN_SCHEMA_VERSION_INVALID",
    ),
    booleanCheck(
      "vulnerabilityPolicy",
      report?.vulnerabilityPolicy === SUPPLY_CHAIN_VULNERABILITY_POLICY,
      "SUPPLY_CHAIN_VULNERABILITY_POLICY_NOT_MET",
    ),
  ];
  const artifacts = Array.isArray(report?.artifacts) ? report.artifacts : [];
  const byName = new Map<string, JsonObject>();
  let duplicateName = false;
  for (const item of artifacts) {
    const artifact = object(item);
    if (typeof artifact?.name !== "string") continue;
    if (byName.has(artifact.name)) duplicateName = true;
    else byName.set(artifact.name, artifact);
  }
  checks.push(booleanCheck(
    "artifactInventory",
    artifacts.length === SUPPLY_CHAIN_ARTIFACTS.length && !duplicateName &&
      SUPPLY_CHAIN_ARTIFACTS.every((name) => byName.has(name)),
    "SUPPLY_CHAIN_ARTIFACT_INVENTORY_INVALID",
  ));
  for (const name of SUPPLY_CHAIN_ARTIFACTS) {
    const artifact = byName.get(name);
    checks.push(booleanCheck(
      `${name}SbomHash`,
      typeof artifact?.sha256 === "string" && /^[a-fA-F0-9]{64}$/.test(artifact.sha256),
      "SUPPLY_CHAIN_SBOM_SHA256_INVALID",
    ));
    checks.push(booleanCheck(
      `${name}ComponentInventory`,
      Number.isSafeInteger(artifact?.componentCount) && Number(artifact?.componentCount) > 0,
      "SUPPLY_CHAIN_COMPONENT_INVENTORY_EMPTY",
    ));
    checks.push(booleanCheck(
      `${name}CycloneDxVersion`,
      typeof artifact?.specVersion === "string" && /^\d+\.\d+$/.test(artifact.specVersion),
      "SUPPLY_CHAIN_CYCLONEDX_VERSION_INVALID",
    ));
  }
  return checks;
}

function evidenceTimestamp(name: ReleaseEvidenceName, report: JsonObject | null): unknown {
  if (name === "preflight") return report?.checkedAt;
  if (name === "webDeployment" || name === "supplyChain") return report?.generatedAt;
  return report?.completedAt;
}

function validateReport(name: ReleaseEvidenceName, report: JsonObject | null): EvidenceCheck[] {
  if (name === "preflight") return validatePreflight(report);
  if (name === "recovery") return validateRecovery(report);
  if (name === "readOnlyLoad") return validateReadOnlyLoad(report);
  if (name === "workerSoak") return validateWorkerSoak(report);
  if (name === "webDeployment") return validateWebDeployment(report);
  if (name === "fieldValidation") return validateFieldValidation(report);
  return validateSupplyChain(report);
}

export class ReleaseAcceptanceService {
  constructor(private readonly now: () => Date = () => new Date()) {}

  run(input: ReleaseAcceptanceInput): ReleaseAcceptanceReport {
    if (!/^[A-Za-z0-9._-]{1,80}$/.test(input.releaseId)) throw acceptanceError("RELEASE_ID_INVALID");
    if (!/^[a-fA-F0-9]{40}$/.test(input.commitSha)) throw acceptanceError("RELEASE_COMMIT_SHA_INVALID");
    const imageMatch = /^([A-Za-z0-9][A-Za-z0-9._:/-]{1,300})@(sha256:[a-fA-F0-9]{64})$/.exec(input.imageReference);
    if (!imageMatch || input.imageReference.includes("://")) throw acceptanceError("RELEASE_IMAGE_REFERENCE_INVALID");
    const stagingBundleSha256 = input.stagingEvidenceBundleSha256?.toLowerCase();
    if (!/^[a-f0-9]{64}$/u.test(stagingBundleSha256)) {
      throw acceptanceError("RELEASE_STAGING_BUNDLE_SHA256_INVALID");
    }
    if (!Number.isInteger(input.stagingEvidenceBundleMaximumAgeHours)
        || input.stagingEvidenceBundleMaximumAgeHours < 1
        || input.stagingEvidenceBundleMaximumAgeHours > 24 * 30) {
      throw acceptanceError("RELEASE_STAGING_BUNDLE_MAXIMUM_AGE_INVALID");
    }
    const checkedAt = this.now();
    const evidence = RELEASE_EVIDENCE_NAMES.map((name) => {
      const sha256 = input.evidenceSha256[name]?.toLowerCase();
      if (!/^[a-f0-9]{64}$/.test(sha256)) throw acceptanceError("RELEASE_EVIDENCE_SHA256_INVALID");
      const maximumAgeHours = input.maximumAgeHours[name];
      if (!Number.isInteger(maximumAgeHours) || maximumAgeHours < 1 || maximumAgeHours > 24 * 366) {
        throw acceptanceError("RELEASE_EVIDENCE_MAXIMUM_AGE_INVALID");
      }
      const report = object(input.reports[name]);
      const checks = [
        booleanCheck("commitSha", report?.commitSha === input.commitSha.toLowerCase(), "EVIDENCE_COMMIT_SHA_MISMATCH"),
        ...validateReport(name, report),
      ];
      const timestamp = evidenceTimestamp(name, report);
      let observedAt: string | null = null;
      let ageHours: number | null = null;
      if (typeof timestamp !== "string" || !Number.isFinite(Date.parse(timestamp))) {
        checks.push({ name: "freshness", status: "fail", code: "EVIDENCE_TIMESTAMP_INVALID" });
      } else {
        const observed = new Date(timestamp);
        observedAt = observed.toISOString();
        ageHours = rounded((checkedAt.getTime() - observed.getTime()) / 3_600_000);
        const isFuture = ageHours < -(5 / 60);
        const isExpired = ageHours > maximumAgeHours;
        checks.push({
          name: "freshness",
          status: !isFuture && !isExpired ? "pass" : "fail",
          code: isFuture ? "EVIDENCE_TIMESTAMP_IN_FUTURE" : isExpired ? "EVIDENCE_EXPIRED" : "OK",
        });
      }
      return {
        name,
        status: checks.every(({ status }) => status === "pass") ? "pass" as const : "fail" as const,
        observedAt,
        ageHours,
        maximumAgeHours,
        sha256,
        checks,
      };
    });
    const commitSha = input.commitSha.toLowerCase();
    const imageReference = `${imageMatch[1]}@${imageMatch[2]!.toLowerCase()}`;
    const imageDigest = imageMatch[2]!.toLowerCase();
    const stagingBundle = object(input.stagingEvidenceBundle);
    const bundleChecks = Array.isArray(stagingBundle?.checks) ? stagingBundle.checks.map(object) : [];
    const bundleCheckNames = new Set(bundleChecks.flatMap((entry) => typeof entry?.name === "string" ? [entry.name] : []));
    const bundleSources = Array.isArray(stagingBundle?.sources) ? stagingBundle.sources.map(object) : [];
    const sourceByName = new Map(bundleSources.flatMap((entry) => (
      typeof entry?.name === "string" ? [[entry.name, entry] as const] : []
    )));
    const embeddedDigest = typeof stagingBundle?.evidenceSha256 === "string"
      ? stagingBundle.evidenceSha256.toLowerCase() : null;
    const { evidenceSha256: _embeddedEvidenceSha256, ...bundleBase } = stagingBundle ?? {};
    const recalculatedDigest = createHash("sha256").update(JSON.stringify(bundleBase)).digest("hex");
    const bundleObservedMs = typeof stagingBundle?.checkedAt === "string" ? Date.parse(stagingBundle.checkedAt) : Number.NaN;
    const bundleAgeHours = Number.isFinite(bundleObservedMs)
      ? rounded((checkedAt.getTime() - bundleObservedMs) / 3_600_000) : null;
    const bundleFresh = bundleAgeHours !== null && bundleAgeHours >= -(5 / 60)
      && bundleAgeHours <= input.stagingEvidenceBundleMaximumAgeHours;
    const stagingChecks: EvidenceCheck[] = [
      booleanCheck(
        "identity",
        stagingBundle?.schemaVersion === 1 && stagingBundle?.ok === true
          && stagingBundle?.releaseId === input.releaseId && stagingBundle?.candidateCommitSha === commitSha,
        "STAGING_BUNDLE_IDENTITY_INVALID",
      ),
      booleanCheck(
        "checks",
        bundleChecks.length === STAGING_BUNDLE_CHECKS.length
          && STAGING_BUNDLE_CHECKS.every((name) => bundleCheckNames.has(name))
          && bundleChecks.every((entry) => entry?.status === "pass" && entry?.code === "OK"),
        "STAGING_BUNDLE_CHECKS_INVALID",
      ),
      booleanCheck(
        "sources",
        bundleSources.length === STAGING_BUNDLE_SOURCES.length
          && STAGING_BUNDLE_SOURCES.every((name) => {
            const source = sourceByName.get(name);
            return typeof source?.sha256 === "string" && /^[a-fA-F0-9]{64}$/u.test(source.sha256);
          }),
        "STAGING_BUNDLE_SOURCES_INVALID",
      ),
      booleanCheck(
        "loadSource",
        sourceByName.get("readOnlyLoad")?.sha256 === input.evidenceSha256.readOnlyLoad.toLowerCase(),
        "STAGING_BUNDLE_LOAD_SOURCE_MISMATCH",
      ),
      booleanCheck(
        "workerSource",
        sourceByName.get("workerSoak")?.sha256 === input.evidenceSha256.workerSoak.toLowerCase(),
        "STAGING_BUNDLE_WORKER_SOURCE_MISMATCH",
      ),
      booleanCheck(
        "selfDigest",
        embeddedDigest !== null && /^[a-f0-9]{64}$/u.test(embeddedDigest) && embeddedDigest === recalculatedDigest,
        "STAGING_BUNDLE_SELF_DIGEST_INVALID",
      ),
      booleanCheck("freshness", bundleFresh, "STAGING_BUNDLE_EXPIRED_OR_FUTURE"),
    ];
    const stagingEvidenceBundle = {
      status: stagingChecks.every(({ status }) => status === "pass") ? "pass" as const : "fail" as const,
      observedAt: Number.isFinite(bundleObservedMs) ? new Date(bundleObservedMs).toISOString() : null,
      ageHours: bundleAgeHours,
      maximumAgeHours: input.stagingEvidenceBundleMaximumAgeHours,
      sha256: stagingBundleSha256,
      checks: stagingChecks,
    };
    const manifestSource = JSON.stringify({
      releaseId: input.releaseId,
      commitSha,
      imageReference,
      imageDigest,
      checkedAt: checkedAt.toISOString(),
      stagingEvidenceBundle: {
        status: stagingEvidenceBundle.status,
        sha256: stagingEvidenceBundle.sha256,
        maximumAgeHours: stagingEvidenceBundle.maximumAgeHours,
      },
      evidence: evidence.map(({ name, sha256, maximumAgeHours, status }) => ({
        name,
        sha256,
        maximumAgeHours,
        status,
      })),
    });
    const manifestSha256 = createHash("sha256").update(manifestSource, "utf8").digest("hex");
    return {
      ok: evidence.every(({ status }) => status === "pass") && stagingEvidenceBundle.status === "pass",
      releaseId: input.releaseId,
      commitSha,
      imageReference,
      imageDigest,
      manifestSha256,
      checkedAt: checkedAt.toISOString(),
      stagingEvidenceBundle,
      evidence,
    };
  }
}
