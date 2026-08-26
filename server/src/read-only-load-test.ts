import "dotenv/config";
import { performance } from "node:perf_hooks";
import {
  LoadRequestResult,
  LoadTestScenario,
  ReadOnlyLoadTestService,
  validateLoadTestTarget,
} from "./operations/read-only-load-test.service.js";
import { withEvidenceCommitSha } from "./operations/evidence-metadata.js";

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    const error = new Error(`${name}_REQUIRED`);
    error.name = `${name}_REQUIRED`;
    throw error;
  }
  return value;
}

function numberEnvironment(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    const error = new Error(`${name}_INVALID`);
    error.name = `${name}_INVALID`;
    throw error;
  }
  return value;
}

async function bootstrap(): Promise<void> {
  const allowProduction = process.env.LOAD_TEST_ALLOW_PRODUCTION === "true";
  const baseUrl = validateLoadTestTarget(
    requiredEnvironment("LOAD_TEST_BASE_URL"),
    allowProduction,
    process.env.LOAD_TEST_CONFIRMATION,
  );
  const metricsToken = process.env.OPERATIONS_METRICS_TOKEN?.trim();
  const scenarios: LoadTestScenario[] = [
    { name: "liveness", path: "/api/v1/health/live" },
    { name: "readiness", path: "/api/v1/health/ready" },
    { name: "eras", path: "/api/v1/eras" },
    { name: "lessons", path: "/api/v1/lessons" },
  ];
  if (metricsToken) {
    scenarios.push({
      name: "workerMetrics",
      path: "/api/v1/internal/worker-metrics",
      headers: { Authorization: `Bearer ${metricsToken}` },
    });
  }

  const requester = async (scenario: LoadTestScenario, timeoutMs: number): Promise<LoadRequestResult> => {
    const startedAt = performance.now();
    try {
      const response = await fetch(new URL(scenario.path, baseUrl), {
        method: "GET",
        headers: {
          Accept: scenario.name === "workerMetrics" ? "text/plain" : "application/json",
          "User-Agent": "baduk-read-only-load-test/1.0",
          ...scenario.headers,
        },
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });
      await response.arrayBuffer();
      return {
        durationMs: performance.now() - startedAt,
        statusCode: response.status,
        ok: response.status === 200,
        errorType: null,
      };
    } catch (error) {
      return {
        durationMs: performance.now() - startedAt,
        statusCode: null,
        ok: false,
        errorType: error instanceof Error ? error.name : "UNKNOWN",
      };
    }
  };

  const report = await new ReadOnlyLoadTestService(requester).run(scenarios, {
    requests: numberEnvironment("LOAD_TEST_REQUESTS", 500),
    concurrency: numberEnvironment("LOAD_TEST_CONCURRENCY", 20),
    requestTimeoutMs: numberEnvironment("LOAD_TEST_TIMEOUT_MS", 5_000),
    maximumP95Ms: numberEnvironment("LOAD_TEST_MAX_P95_MS", 500),
    maximumErrorRatePercent: numberEnvironment("LOAD_TEST_MAX_ERROR_RATE_PERCENT", 1),
  });
  process.stdout.write(`${JSON.stringify(withEvidenceCommitSha(report), null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
}

void bootstrap().catch((error: unknown) => {
  const detail = error instanceof Error ? error.name : "READ_ONLY_LOAD_TEST_FAILED";
  process.stderr.write(`${JSON.stringify({ ok: false, detail })}\n`);
  process.exitCode = 1;
});
