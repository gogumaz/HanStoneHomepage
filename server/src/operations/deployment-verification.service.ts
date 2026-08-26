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
    const results: DeploymentProbeResult[] = [];
    const failures: Array<{ sample: number; errorType: string }> = [];
    for (let index = 0; index < samples; index += 1) {
      try {
        const result = await this.probe(requestTimeoutMs);
        if (!Number.isFinite(result.durationMs) || result.durationMs < 0) {
          throw verificationError("DEPLOY_VERIFY_PROBE_INVALID");
        }
        results.push(result);
      } catch (error) {
        failures.push({ sample: index + 1, errorType: errorType(error) });
      }
      if (index < samples - 1) await this.sleep(intervalMs);
    }
    const completedAt = this.now();
    const durations = results.map(({ durationMs }) => durationMs);
    const latencyMs = {
      p50: percentile(durations, 0.5),
      p95: percentile(durations, 0.95),
      p99: percentile(durations, 0.99),
      max: durations.length ? Math.round(Math.max(...durations) * 100) / 100 : 0,
    };
    const livenessFailures = results.filter(({ liveness }) => !liveness).length;
    const readinessFailures = results.filter(({ readiness }) => !readiness).length;
    const identityMismatches = results.filter(({ identity }) =>
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
      latencyMs,
      threshold: { maximumP95Ms, latencyMet },
      failures,
    };
  }
}
