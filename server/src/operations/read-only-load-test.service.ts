export const PRODUCTION_LOAD_CONFIRMATION = "RUN_READ_ONLY_PRODUCTION_LOAD_TEST";

export type LoadTestScenario = {
  name: string;
  path: string;
  headers?: Readonly<Record<string, string>>;
};

export type LoadRequestResult = {
  durationMs: number;
  statusCode: number | null;
  ok: boolean;
  errorType: string | null;
};

export type LoadTestConfig = {
  requests: number;
  concurrency: number;
  requestTimeoutMs: number;
  maximumP95Ms: number;
  maximumErrorRatePercent: number;
};

export type LoadTestScenarioReport = {
  name: string;
  requests: number;
  succeeded: number;
  failed: number;
  errorRatePercent: number;
  latencyMs: {
    p50: number;
    p95: number;
    p99: number;
    max: number;
  };
};

export type ReadOnlyLoadTestReport = {
  ok: boolean;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  requests: {
    planned: number;
    completed: number;
    succeeded: number;
    failed: number;
    requestsPerSecond: number;
    errorRatePercent: number;
  };
  latencyMs: {
    p50: number;
    p95: number;
    p99: number;
    max: number;
  };
  thresholds: {
    maximumP95Ms: number;
    maximumErrorRatePercent: number;
    latencyMet: boolean;
    errorRateMet: boolean;
  };
  scenarios: LoadTestScenarioReport[];
};

export type LoadRequester = (
  scenario: LoadTestScenario,
  requestTimeoutMs: number,
) => Promise<LoadRequestResult>;

function loadTestError(code: string): Error {
  const error = new Error(code);
  error.name = code;
  return error;
}

function boundedInteger(value: number, minimum: number, maximum: number, code: string): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw loadTestError(code);
  return value;
}

function boundedNumber(value: number, minimum: number, maximum: number, code: string): number {
  if (!Number.isFinite(value) || value < minimum || value > maximum) throw loadTestError(code);
  return value;
}

function rounded(value: number): number {
  return Math.round(value * 100) / 100;
}

function percentile(values: readonly number[], percentage: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * percentage) - 1));
  return rounded(sorted[index] ?? 0);
}

function latency(values: readonly number[]) {
  return {
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    p99: percentile(values, 0.99),
    max: rounded(values.length > 0 ? Math.max(...values) : 0),
  };
}

export function validateLoadTestTarget(
  baseUrlValue: string,
  allowProduction = false,
  confirmation?: string,
): string {
  let url: URL;
  try {
    url = new URL(baseUrlValue);
  } catch {
    throw loadTestError("LOAD_TEST_BASE_URL_INVALID");
  }
  if (!(["http:", "https:"] as string[]).includes(url.protocol) || !url.hostname || url.username || url.password) {
    throw loadTestError("LOAD_TEST_BASE_URL_INVALID");
  }
  if (url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) {
    throw loadTestError("LOAD_TEST_BASE_URL_MUST_BE_ORIGIN");
  }

  const hostname = url.hostname.toLowerCase();
  const isLocal = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
  const isNonProduction = /(^|[.-])(staging|stage|test|testing|sandbox|load|perf)([.-]|$)/i.test(hostname);
  if (!isLocal && !isNonProduction) {
    if (!allowProduction) throw loadTestError("LOAD_TEST_TARGET_NOT_NON_PRODUCTION");
    if (confirmation !== PRODUCTION_LOAD_CONFIRMATION) {
      throw loadTestError("LOAD_TEST_PRODUCTION_CONFIRMATION_REQUIRED");
    }
    if (url.protocol !== "https:") throw loadTestError("LOAD_TEST_PRODUCTION_HTTPS_REQUIRED");
  }

  return url.origin;
}

export class ReadOnlyLoadTestService {
  constructor(
    private readonly requester: LoadRequester,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async run(scenarios: readonly LoadTestScenario[], config: LoadTestConfig): Promise<ReadOnlyLoadTestReport> {
    if (scenarios.length === 0) throw loadTestError("LOAD_TEST_SCENARIOS_REQUIRED");
    if (scenarios.some((scenario) => !/^[a-zA-Z0-9._-]{1,50}$/.test(scenario.name) || !scenario.path.startsWith("/"))) {
      throw loadTestError("LOAD_TEST_SCENARIO_INVALID");
    }

    const requests = boundedInteger(config.requests, 1, 100_000, "LOAD_TEST_REQUESTS_INVALID");
    const concurrency = boundedInteger(config.concurrency, 1, 200, "LOAD_TEST_CONCURRENCY_INVALID");
    const requestTimeoutMs = boundedInteger(config.requestTimeoutMs, 100, 60_000, "LOAD_TEST_TIMEOUT_INVALID");
    const maximumP95Ms = boundedNumber(config.maximumP95Ms, 1, 60_000, "LOAD_TEST_P95_THRESHOLD_INVALID");
    const maximumErrorRatePercent = boundedNumber(
      config.maximumErrorRatePercent,
      0,
      100,
      "LOAD_TEST_ERROR_RATE_THRESHOLD_INVALID",
    );
    if (requests < scenarios.length) throw loadTestError("LOAD_TEST_REQUESTS_BELOW_SCENARIO_COUNT");

    const startedAt = this.now();
    const results = new Array<{ scenario: LoadTestScenario; result: LoadRequestResult }>(requests);
    let nextRequestIndex = 0;

    const worker = async (): Promise<void> => {
      while (true) {
        const index = nextRequestIndex;
        nextRequestIndex += 1;
        if (index >= requests) return;
        const scenario = scenarios[index % scenarios.length]!;
        let result: LoadRequestResult;
        try {
          result = await this.requester(scenario, requestTimeoutMs);
        } catch (error) {
          result = {
            durationMs: requestTimeoutMs,
            statusCode: null,
            ok: false,
            errorType: error instanceof Error ? error.name : "UNKNOWN",
          };
        }
        results[index] = { scenario, result };
      }
    };

    await Promise.all(Array.from({ length: Math.min(concurrency, requests) }, worker));
    const completedAt = this.now();
    const durationMs = Math.max(1, completedAt.getTime() - startedAt.getTime());
    const completedResults = results.filter((result): result is { scenario: LoadTestScenario; result: LoadRequestResult } => Boolean(result));
    const succeeded = completedResults.filter(({ result }) => result.ok).length;
    const failed = completedResults.length - succeeded;
    const errorRatePercent = rounded((failed / completedResults.length) * 100);
    const allLatency = latency(completedResults.map(({ result }) => result.durationMs));

    const scenarioReports = scenarios.map((scenario) => {
      const scenarioResults = completedResults.filter((item) => item.scenario.name === scenario.name);
      const scenarioSucceeded = scenarioResults.filter(({ result }) => result.ok).length;
      const scenarioFailed = scenarioResults.length - scenarioSucceeded;
      return {
        name: scenario.name,
        requests: scenarioResults.length,
        succeeded: scenarioSucceeded,
        failed: scenarioFailed,
        errorRatePercent: scenarioResults.length === 0 ? 0 : rounded((scenarioFailed / scenarioResults.length) * 100),
        latencyMs: latency(scenarioResults.map(({ result }) => result.durationMs)),
      };
    });

    const latencyMet = allLatency.p95 <= maximumP95Ms;
    const errorRateMet = errorRatePercent <= maximumErrorRatePercent;
    return {
      ok: completedResults.length === requests && latencyMet && errorRateMet,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      durationMs,
      requests: {
        planned: requests,
        completed: completedResults.length,
        succeeded,
        failed,
        requestsPerSecond: rounded(completedResults.length / (durationMs / 1_000)),
        errorRatePercent,
      },
      latencyMs: allLatency,
      thresholds: {
        maximumP95Ms,
        maximumErrorRatePercent,
        latencyMet,
        errorRateMet,
      },
      scenarios: scenarioReports,
    };
  }
}
