import "dotenv/config";
import { performance } from "node:perf_hooks";
import { validateLoadTestTarget } from "./operations/read-only-load-test.service.js";
import { withEvidenceCommitSha } from "./operations/evidence-metadata.js";
import {
  parseWorkerMetrics,
  WorkerSoakService,
  type WorkerMetricsSampler,
  type WorkerSoakConfig,
} from "./operations/worker-soak.service.js";

function cliError(code: string): Error {
  const error = new Error(code);
  error.name = code;
  return error;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw cliError(`${name}_REQUIRED`);
  return value;
}

function integer(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value)) throw cliError(`${name}_INVALID`);
  return value;
}

async function main(): Promise<void> {
  const baseUrl = validateLoadTestTarget(required("WORKER_SOAK_BASE_URL"));
  const token = required("OPERATIONS_METRICS_TOKEN");
  if (!/^[A-Za-z0-9_-]{32,}$/.test(token)) throw cliError("OPERATIONS_METRICS_TOKEN_INVALID");
  const endpoint = new URL("/api/v1/internal/worker-metrics", baseUrl);

  const sampler: WorkerMetricsSampler = async (requestTimeoutMs) => {
    const startedAt = performance.now();
    const response = await fetch(endpoint, {
      method: "GET",
      headers: { accept: "text/plain", authorization: `Bearer ${token}` },
      redirect: "manual",
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
    const durationMs = Math.round((performance.now() - startedAt) * 100) / 100;
    if (response.status !== 200) throw cliError(`WORKER_METRICS_HTTP_${response.status}`);
    if (!response.headers.get("content-type")?.toLowerCase().startsWith("text/plain")) {
      throw cliError("WORKER_METRICS_CONTENT_TYPE_INVALID");
    }
    return { durationMs, snapshot: parseWorkerMetrics(await response.text()) };
  };

  const config: WorkerSoakConfig = {
    samples: integer("WORKER_SOAK_SAMPLES", 60),
    intervalMs: integer("WORKER_SOAK_INTERVAL_MS", 10_000),
    requestTimeoutMs: integer("WORKER_SOAK_TIMEOUT_MS", 5_000),
    maximumP95Ms: integer("WORKER_SOAK_MAX_P95_MS", 500),
    maximumCriticalSamples: integer("WORKER_SOAK_MAX_CRITICAL_SAMPLES", 0),
    maximumBacklogGrowth: integer("WORKER_SOAK_MAX_BACKLOG_GROWTH", 0),
    maximumTerminalErrorGrowth: integer("WORKER_SOAK_MAX_TERMINAL_ERROR_GROWTH", 0),
  };
  const report = await new WorkerSoakService(sampler).run(config);
  process.stdout.write(`${JSON.stringify(withEvidenceCommitSha(report), null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
}

main().catch((error: unknown) => {
  const errorType = error instanceof Error ? error.name : "UNKNOWN";
  process.stderr.write(`${JSON.stringify({ ok: false, errorType })}\n`);
  process.exitCode = 1;
});
