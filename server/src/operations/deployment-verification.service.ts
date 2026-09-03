import { createHash } from "node:crypto";
import type { ReleaseIdentity } from "./release-identity.js";

export type DeploymentProbeResult = {
  durationMs: number;
  liveness: boolean;
  readiness: boolean;
  identity: ReleaseIdentity;
};

export type DeploymentProbe = (timeoutMs: number) => Promise<DeploymentProbeResult>;

export type DeploymentVerificationConfig = {
  samples: number;
  intervalMs: number;
  requestTimeoutMs: number;
  maximumP95Ms: number;
  expectedCommitSha: string;
  expectedImageDigest: string;
};

export type DeploymentVerificationReport = {
  ok: boolean;
  rollbackRecommended: boolean;
  startedAt: string;
  completedAt: string;
  expected: ReleaseIdentity;
  samples: {
    planned: number;
    completed: number;
    failed: number;
    livenessFailures: number;
    readinessFailures: number;
    identityMismatches: number;
  };
  probes: Array<{
    sample: number;
    durationMs: number;
    liveness: boolean;
    readiness: boolean;
    identityMatched: boolean;
  }>;
  latencyMs: { p50: number; p95: number; p99: number; max: number };
  threshold: { maximumP95Ms: number; latencyMet: boolean };
  failures: Array<{ sample: number; errorType: string }>;
};

function verificationError(code: string): Error {
  const error = new Error(code);
  error.name = code;
  return error;
}

function integer(value: number, minimum: number, maximum: number, code: string): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw verificationError(code);
  return value;
}

function percentile(values: readonly number[], ratio: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return Math.round((sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)] ?? 0) * 100) / 100;
}

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

export function calculateDeploymentVerificationEvidenceSha256(value: unknown): string | null {
  const report = object(value);
  if (report?.schemaVersion !== 2 || typeof report.releaseId !== "string"
      || !/^[A-Za-z0-9._-]{1,80}$/u.test(report.releaseId)) return null;
  const source = {
    schemaVersion: 2,
    releaseId: report.releaseId,
    ok: report.ok,
    rollbackRecommended: report.rollbackRecommended,
    startedAt: report.startedAt,
    completedAt: report.completedAt,
    expected: report.expected,
    samples: report.samples,
    probes: report.probes,
    latencyMs: report.latencyMs,
    threshold: report.threshold,
    failures: report.failures,
    web: report.web,
  };
  return createHash("sha256").update(JSON.stringify(source), "utf8").digest("hex");
}

export function deploymentVerificationEvidenceDigestValid(value: unknown, expectedReleaseId: string): boolean {
  const report = object(value);
  const recalculated = calculateDeploymentVerificationEvidenceSha256(report);
  return report?.releaseId === expectedReleaseId && recalculated !== null
    && typeof report.evidenceSha256 === "string" && /^[a-f0-9]{64}$/u.test(report.evidenceSha256)
    && report.evidenceSha256 === recalculated;
}

export function successfulDeploymentProbeEvidenceValid(value: unknown): boolean {
  const report = object(value);
  const samples = object(report?.samples);
  const latency = object(report?.latencyMs);
  const threshold = object(report?.threshold);
  const probes = Array.isArray(report?.probes) ? report.probes.map(object) : [];
  const planned = samples?.planned;
  if (report?.ok !== true || report.rollbackRecommended !== false
      || !Number.isSafeInteger(planned) || Number(planned) < 1 || Number(planned) > 100
      || probes.length !== planned || samples?.completed !== planned || samples.failed !== 0
      || samples.livenessFailures !== 0 || samples.readinessFailures !== 0 || samples.identityMismatches !== 0
      || !Array.isArray(report.failures) || report.failures.length !== 0) return false;
  const durations: number[] = [];
  for (let index = 0; index < probes.length; index += 1) {
    const probe = probes[index];
    if (probe?.sample !== index + 1 || typeof probe.durationMs !== "number"
        || !Number.isFinite(probe.durationMs) || probe.durationMs < 0
        || probe.liveness !== true || probe.readiness !== true || probe.identityMatched !== true) return false;
    durations.push(probe.durationMs);
  }
  const expectedLatency = {
    p50: percentile(durations, 0.5),
    p95: percentile(durations, 0.95),
    p99: percentile(durations, 0.99),
    max: Math.round(Math.max(...durations) * 100) / 100,
  };
  const maximumP95Ms = threshold?.maximumP95Ms;
  return latency?.p50 === expectedLatency.p50 && latency.p95 === expectedLatency.p95
    && latency.p99 === expectedLatency.p99 && latency.max === expectedLatency.max
    && Number.isInteger(maximumP95Ms) && Number(maximumP95Ms) >= 1 && Number(maximumP95Ms) <= 60_000
    && threshold?.latencyMet === (expectedLatency.p95 <= Number(maximumP95Ms));
}

export function successfulDeploymentVerificationEvidenceValid(
  value: unknown,
  expectedReleaseId: string,
): boolean {
  const report = object(value);
  const web = object(report?.web);
  const startedAt = typeof report?.startedAt === "string" ? report.startedAt : "";
  const completedAt = typeof report?.completedAt === "string" ? report.completedAt : "";
  const startedAtMs = Date.parse(startedAt);
  const completedAtMs = Date.parse(completedAt);
  return deploymentVerificationEvidenceDigestValid(report, expectedReleaseId)
    && successfulDeploymentProbeEvidenceValid(report)
    && Number.isFinite(startedAtMs) && new Date(startedAtMs).toISOString() === startedAt
    && Number.isFinite(completedAtMs) && new Date(completedAtMs).toISOString() === completedAt
    && startedAtMs <= completedAtMs && web?.ok === true && web.checkedAt === completedAt;
}

function errorType(error: unknown): string {
  return error instanceof Error && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(error.name) ? error.name : "UNKNOWN";
}

export function validateDeploymentTarget(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw verificationError("DEPLOY_VERIFY_BASE_URL_INVALID");
  }
  const local = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname.toLowerCase());
  if ((!local && url.protocol !== "https:") || (local && !["http:", "https:"].includes(url.protocol)) ||
    url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) {
    throw verificationError("DEPLOY_VERIFY_BASE_URL_INVALID");
  }
  return url.origin;
}

export function validateNonProductionDeploymentTarget(value: string): string {
  const origin = validateDeploymentTarget(value);
  const hostname = new URL(origin).hostname.toLowerCase();
  const local = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname);
  const marked = /(^|[.-])(staging|stage|test|testing|sandbox|drill|rehearsal)([.-]|$)/iu.test(hostname);
  if (!local && !marked) throw verificationError("DEPLOY_VERIFY_TARGET_NOT_NON_PRODUCTION");
  return origin;
}

export class DeploymentVerificationService {
  constructor(
    private readonly probe: DeploymentProbe,
    private readonly now: () => Date = () => new Date(),
    private readonly sleep: (milliseconds: number) => Promise<void> = (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
  ) {}

  async run(config: DeploymentVerificationConfig): Promise<DeploymentVerificationReport> {
    const samples = integer(config.samples, 1, 100, "DEPLOY_VERIFY_SAMPLES_INVALID");
    const intervalMs = integer(config.intervalMs, 100, 60_000, "DEPLOY_VERIFY_INTERVAL_INVALID");
    const requestTimeoutMs = integer(config.requestTimeoutMs, 100, 60_000, "DEPLOY_VERIFY_TIMEOUT_INVALID");
    const maximumP95Ms = integer(config.maximumP95Ms, 1, 60_000, "DEPLOY_VERIFY_P95_INVALID");
    if (!/^[a-fA-F0-9]{40}$/.test(config.expectedCommitSha)) {
      throw verificationError("DEPLOY_VERIFY_COMMIT_SHA_INVALID");
    }
    if (!/^sha256:[a-fA-F0-9]{64}$/.test(config.expectedImageDigest)) {
      throw verificationError("DEPLOY_VERIFY_IMAGE_DIGEST_INVALID");
    }
    const expected = {
      commitSha: config.expectedCommitSha.toLowerCase(),
      imageDigest: config.expectedImageDigest.toLowerCase(),
    };
    const startedAt = this.now();
    const results: Array<{ sample: number; result: DeploymentProbeResult }> = [];
    const failures: Array<{ sample: number; errorType: string }> = [];
    for (let index = 0; index < samples; index += 1) {
      try {
        const result = await this.probe(requestTimeoutMs);
        if (!Number.isFinite(result.durationMs) || result.durationMs < 0) {
          throw verificationError("DEPLOY_VERIFY_PROBE_INVALID");
        }
        results.push({ sample: index + 1, result });
      } catch (error) {
        failures.push({ sample: index + 1, errorType: errorType(error) });
      }
      if (index < samples - 1) await this.sleep(intervalMs);
    }
    const completedAt = this.now();
    const durations = results.map(({ result }) => result.durationMs);
    const latencyMs = {
      p50: percentile(durations, 0.5),
      p95: percentile(durations, 0.95),
      p99: percentile(durations, 0.99),
      max: durations.length ? Math.round(Math.max(...durations) * 100) / 100 : 0,
    };
    const livenessFailures = results.filter(({ result }) => !result.liveness).length;
    const readinessFailures = results.filter(({ result }) => !result.readiness).length;
    const identityMismatches = results.filter(({ result: { identity } }) =>
      identity.commitSha !== expected.commitSha || identity.imageDigest !== expected.imageDigest).length;
    const latencyMet = latencyMs.p95 <= maximumP95Ms;
    const ok = results.length === samples && livenessFailures === 0 && readinessFailures === 0 &&
      identityMismatches === 0 && latencyMet;
    return {
      ok,
      rollbackRecommended: !ok,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      expected,
      samples: {
        planned: samples,
        completed: results.length,
        failed: failures.length,
        livenessFailures,
        readinessFailures,
        identityMismatches,
      },
      probes: results.map(({ sample, result }) => ({
        sample,
        durationMs: result.durationMs,
        liveness: result.liveness,
        readiness: result.readiness,
        identityMatched: result.identity.commitSha === expected.commitSha
          && result.identity.imageDigest === expected.imageDigest,
      })),
      latencyMs,
      threshold: { maximumP95Ms, latencyMet },
      failures,
    };
  }
}
