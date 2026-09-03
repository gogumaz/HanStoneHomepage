import { createHash } from "node:crypto";

type JsonObject = Record<string, unknown>;
type Check = { name: string; status: "pass" | "fail"; code: string };

export type StagingEvidenceBundleInput = {
  releaseId: string;
  candidateCommitSha: string;
  loadTestRunId: number;
  workerSoakRunId: number;
  maximumAgeHours: number;
  reports: {
    readOnlyLoad: unknown;
    workerSoak: unknown;
    controlledLoad: unknown;
    execution: unknown;
  };
  sourceSha256: {
    readOnlyLoad: string;
    workerSoak: string;
    controlledLoad: string;
    execution: string;
  };
};

export type StagingEvidenceBundleReport = {
  schemaVersion: 1;
  ok: boolean;
  releaseId: string;
  candidateCommitSha: string;
  loadTestRunId: number;
  workerSoakRunId: number;
  checkedAt: string;
  maximumAgeHours: number;
  checks: Check[];
  sources: Array<{
    name: keyof StagingEvidenceBundleInput["reports"];
    sha256: string;
    observedAt: string | null;
  }>;
  evidenceSha256: string;
};

const SOURCE_NAMES = ["readOnlyLoad", "workerSoak", "controlledLoad", "execution"] as const;
const WORKER_QUEUES = [
  "account_mail",
  "inquiry_notification",
  "video_scan",
  "hls_transcode",
  "object_deletion",
] as const;
const SHA256 = /^[a-fA-F0-9]{64}$/u;
const COMMIT_SHA = /^[a-fA-F0-9]{40}$/u;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1_000;

function bundleError(code: string): Error {
  const error = new Error(code);
  error.name = code;
  return error;
}

function object(value: unknown): JsonObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonObject : null;
}

function check(name: string, passed: boolean, code: string): Check {
  return { name, status: passed ? "pass" : "fail", code: passed ? "OK" : code };
}

function date(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function reportTimestamp(name: typeof SOURCE_NAMES[number], report: JsonObject | null): string | null {
  const value = name === "execution" ? report?.generatedAt : report?.completedAt;
  return typeof value === "string" && date(value) !== null ? value : null;
}

function loadReportPassed(report: JsonObject | null): boolean {
  const requests = object(report?.requests);
  const thresholds = object(report?.thresholds);
  const planned = requests?.planned;
  return report?.ok === true
    && thresholds?.latencyMet === true
    && thresholds?.errorRateMet === true
    && Number.isSafeInteger(planned)
    && Number(planned) > 0
    && requests?.completed === planned;
}

function workerReportPassed(report: JsonObject | null): boolean {
  const samples = object(report?.samples);
  const thresholds = object(report?.thresholds);
  const planned = samples?.planned;
  const queues = Array.isArray(report?.queues) ? report.queues.map(object) : [];
  const queueNames = new Set(queues.flatMap((queue) => typeof queue?.name === "string" ? [queue.name] : []));
  return report?.ok === true
    && thresholds?.latencyMet === true
    && thresholds?.criticalSamplesMet === true
    && thresholds?.queueHealthMet === true
    && thresholds?.metricsFreshnessMet === true
    && Number.isSafeInteger(planned)
    && Number(planned) >= 2
    && samples?.completed === planned
    && samples?.failed === 0
    && queues.length === WORKER_QUEUES.length
    && WORKER_QUEUES.every((name) => queueNames.has(name))
    && queues.every((queue) => queue?.healthy === true);
}

export class StagingEvidenceBundleService {
  constructor(private readonly now: () => Date = () => new Date()) {}

  create(input: StagingEvidenceBundleInput): StagingEvidenceBundleReport {
    if (!/^[A-Za-z0-9._-]{1,80}$/u.test(input.releaseId)) throw bundleError("STAGING_BUNDLE_RELEASE_ID_INVALID");
    if (!COMMIT_SHA.test(input.candidateCommitSha)) throw bundleError("STAGING_BUNDLE_COMMIT_SHA_INVALID");
    if (!Number.isSafeInteger(input.loadTestRunId) || input.loadTestRunId < 1
        || !Number.isSafeInteger(input.workerSoakRunId) || input.workerSoakRunId < 1) {
      throw bundleError("STAGING_BUNDLE_RUN_ID_INVALID");
    }
    if (!Number.isInteger(input.maximumAgeHours) || input.maximumAgeHours < 1 || input.maximumAgeHours > 24 * 30) {
      throw bundleError("STAGING_BUNDLE_MAXIMUM_AGE_INVALID");
    }
    if (SOURCE_NAMES.some((name) => !SHA256.test(input.sourceSha256[name]))) {
      throw bundleError("STAGING_BUNDLE_SOURCE_SHA256_INVALID");
    }

    const candidateCommitSha = input.candidateCommitSha.toLowerCase();
    const reports = Object.fromEntries(SOURCE_NAMES.map((name) => [name, object(input.reports[name])])) as
      Record<typeof SOURCE_NAMES[number], JsonObject | null>;
    const now = this.now();
    const nowMs = now.getTime();
    const maximumAgeMs = input.maximumAgeHours * 60 * 60 * 1_000;
    const timestamps = Object.fromEntries(SOURCE_NAMES.map((name) => [
      name,
      reportTimestamp(name, reports[name]),
    ])) as Record<typeof SOURCE_NAMES[number], string | null>;
    const timestampValues = SOURCE_NAMES.map((name) => date(timestamps[name]));
    const timestampsValid = timestampValues.every((value) => value !== null
      && value <= nowMs + MAX_CLOCK_SKEW_MS
      && nowMs - value <= maximumAgeMs);
    const candidatesMatch = SOURCE_NAMES.every((name) => (
      typeof reports[name]?.candidateCommit === "string"
      && reports[name]?.candidateCommit.toLowerCase() === candidateCommitSha
    ));
    const execution = reports.execution;
    const workerStart = date(reports.workerSoak?.startedAt);
    const workerEnd = date(reports.workerSoak?.completedAt);
    const controlledStart = date(reports.controlledLoad?.startedAt);
    const controlledEnd = date(reports.controlledLoad?.completedAt);
    const intervalsOverlap = workerStart !== null && workerEnd !== null
      && controlledStart !== null && controlledEnd !== null
      && workerStart <= workerEnd && controlledStart <= controlledEnd
      && controlledStart <= workerEnd && controlledEnd >= workerStart;
    const executionTime = date(execution?.generatedAt);
    const executionAfterReports = executionTime !== null && workerEnd !== null && controlledEnd !== null
      && executionTime >= Math.max(workerEnd, controlledEnd)
      && executionTime <= Math.max(workerEnd, controlledEnd) + MAX_CLOCK_SKEW_MS;

    const checks: Check[] = [
      check("sourceInventory", SOURCE_NAMES.every((name) => reports[name] !== null), "STAGING_BUNDLE_SOURCE_MISSING"),
      check("candidateIdentity", candidatesMatch, "STAGING_BUNDLE_CANDIDATE_MISMATCH"),
      check("readOnlyLoad", loadReportPassed(reports.readOnlyLoad), "STAGING_BUNDLE_LOAD_INVALID"),
      check("workerSoak", workerReportPassed(reports.workerSoak), "STAGING_BUNDLE_WORKER_SOAK_INVALID"),
      check("controlledLoad", loadReportPassed(reports.controlledLoad), "STAGING_BUNDLE_CONTROLLED_LOAD_INVALID"),
      check(
        "execution",
        execution?.ok === true && execution?.workerSoakExitCode === 0 && execution?.controlledLoadExitCode === 0,
        "STAGING_BUNDLE_EXECUTION_INVALID",
      ),
      check("concurrentObservation", intervalsOverlap, "STAGING_BUNDLE_WORKLOAD_DID_NOT_OVERLAP_SOAK"),
      check("executionTimeline", executionAfterReports, "STAGING_BUNDLE_EXECUTION_TIMELINE_INVALID"),
      check("freshness", timestampsValid, "STAGING_BUNDLE_EVIDENCE_EXPIRED_OR_FUTURE"),
    ];
    const sources = SOURCE_NAMES.map((name) => ({
      name,
      sha256: input.sourceSha256[name].toLowerCase(),
      observedAt: timestamps[name],
    }));
    const baseReport = {
      schemaVersion: 1 as const,
      ok: checks.every(({ status }) => status === "pass"),
      releaseId: input.releaseId,
      candidateCommitSha,
      loadTestRunId: input.loadTestRunId,
      workerSoakRunId: input.workerSoakRunId,
      checkedAt: now.toISOString(),
      maximumAgeHours: input.maximumAgeHours,
      checks,
      sources,
    };
    return {
      ...baseReport,
      evidenceSha256: createHash("sha256").update(JSON.stringify(baseReport)).digest("hex"),
    };
  }
}
