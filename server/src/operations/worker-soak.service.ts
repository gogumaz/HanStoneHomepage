export const WORKER_QUEUE_NAMES = [
  "account_mail",
  "inquiry_notification",
  "video_scan",
  "hls_transcode",
  "object_deletion",
] as const;

export type WorkerQueueName = (typeof WORKER_QUEUE_NAMES)[number];

export type WorkerMetricsSnapshot = {
  healthStatus: 0 | 1 | 2;
  checkedTimestampSeconds: number;
  queues: Record<WorkerQueueName, { due: number; staleLocks: number; terminalErrors: number }>;
};

export type WorkerSoakConfig = {
  samples: number;
  intervalMs: number;
  requestTimeoutMs: number;
  maximumP95Ms: number;
  maximumCriticalSamples: number;
  maximumBacklogGrowth: number;
  maximumTerminalErrorGrowth: number;
};

export type WorkerMetricsSample = {
  durationMs: number;
  snapshot: WorkerMetricsSnapshot;
};

export type WorkerMetricsSampler = (requestTimeoutMs: number) => Promise<WorkerMetricsSample>;

export type WorkerSoakReport = {
  ok: boolean;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  samples: {
    planned: number;
    completed: number;
    failed: number;
    critical: number;
    attention: number;
  };
  latencyMs: { p50: number; p95: number; p99: number; max: number };
  thresholds: {
    maximumP95Ms: number;
    maximumCriticalSamples: number;
    maximumBacklogGrowth: number;
    maximumTerminalErrorGrowth: number;
    latencyMet: boolean;
    criticalSamplesMet: boolean;
    queueHealthMet: boolean;
    metricsFreshnessMet: boolean;
  };
  queues: Array<{
    name: WorkerQueueName;
    baselineDue: number | null;
    finalDue: number | null;
    peakDue: number | null;
    backlogGrowth: number | null;
    peakStaleLocks: number | null;
    baselineTerminalErrors: number | null;
    finalTerminalErrors: number | null;
    terminalErrorGrowth: number | null;
    healthy: boolean;
  }>;
  failures: Array<{ sample: number; errorType: string }>;
};

const MAX_METRICS_BYTES = 64 * 1024;
const QUEUE_SET = new Set<string>(WORKER_QUEUE_NAMES);

function soakError(code: string): Error {
  const error = new Error(code);
  error.name = code;
  return error;
}

function boundedInteger(value: number, minimum: number, maximum: number, code: string): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw soakError(code);
  return value;
}

function rounded(value: number): number {
  return Math.round(value * 100) / 100;
}

function percentile(values: readonly number[], ratio: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return rounded(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)] ?? 0);
}

function sanitizedErrorType(error: unknown): string {
  if (!(error instanceof Error) || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(error.name)) return "UNKNOWN";
  return error.name;
}

function parseNonNegativeInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw soakError("WORKER_METRICS_VALUE_INVALID");
  return parsed;
}

export function parseWorkerMetrics(text: string): WorkerMetricsSnapshot {
  if (Buffer.byteLength(text, "utf8") > MAX_METRICS_BYTES) throw soakError("WORKER_METRICS_BODY_TOO_LARGE");

  const values = new Map<string, string>();
  const relevant = /^(baduk_worker_(?:health_status|health_checked_timestamp_seconds|queue_(?:due|stale_locks|terminal_errors)))(?:\{queue="([^"]+)"\})?\s+([^\s]+)$/;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = relevant.exec(line);
    if (!match) continue;
    const metric = match[1]!;
    const queue = match[2];
    const key = queue ? `${metric}:${queue}` : metric;
    if (values.has(key)) throw soakError("WORKER_METRICS_DUPLICATE");
    values.set(key, match[3]!);
  }

  const scalar = (name: string): number => {
    const value = values.get(name);
    if (value === undefined) throw soakError("WORKER_METRICS_REQUIRED_VALUE_MISSING");
    return parseNonNegativeInteger(value);
  };
  const healthStatus = scalar("baduk_worker_health_status");
  if (healthStatus !== 0 && healthStatus !== 1 && healthStatus !== 2) {
    throw soakError("WORKER_METRICS_HEALTH_STATUS_INVALID");
  }

  const queues = {} as WorkerMetricsSnapshot["queues"];
  for (const queue of WORKER_QUEUE_NAMES) {
    queues[queue] = {
      due: scalar(`baduk_worker_queue_due:${queue}`),
      staleLocks: scalar(`baduk_worker_queue_stale_locks:${queue}`),
      terminalErrors: scalar(`baduk_worker_queue_terminal_errors:${queue}`),
    };
  }

  for (const key of values.keys()) {
    const queue = key.includes(":") ? key.slice(key.lastIndexOf(":") + 1) : undefined;
    if (queue && !QUEUE_SET.has(queue)) throw soakError("WORKER_METRICS_QUEUE_UNKNOWN");
  }

  return {
    healthStatus,
    checkedTimestampSeconds: scalar("baduk_worker_health_checked_timestamp_seconds"),
    queues,
  };
}

export class WorkerSoakService {
  constructor(
    private readonly sampler: WorkerMetricsSampler,
    private readonly now: () => Date = () => new Date(),
    private readonly sleep: (milliseconds: number) => Promise<void> = (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
  ) {}

  async run(config: WorkerSoakConfig): Promise<WorkerSoakReport> {
    const samples = boundedInteger(config.samples, 2, 10_000, "WORKER_SOAK_SAMPLES_INVALID");
    const intervalMs = boundedInteger(config.intervalMs, 100, 3_600_000, "WORKER_SOAK_INTERVAL_INVALID");
    const requestTimeoutMs = boundedInteger(config.requestTimeoutMs, 100, 60_000, "WORKER_SOAK_TIMEOUT_INVALID");
    const maximumP95Ms = boundedInteger(config.maximumP95Ms, 1, 60_000, "WORKER_SOAK_P95_THRESHOLD_INVALID");
    const maximumCriticalSamples = boundedInteger(
      config.maximumCriticalSamples,
      0,
      samples,
      "WORKER_SOAK_CRITICAL_THRESHOLD_INVALID",
    );
    const maximumBacklogGrowth = boundedInteger(
      config.maximumBacklogGrowth,
      0,
      100_000,
      "WORKER_SOAK_BACKLOG_THRESHOLD_INVALID",
    );
    const maximumTerminalErrorGrowth = boundedInteger(
      config.maximumTerminalErrorGrowth,
      0,
      100_000,
      "WORKER_SOAK_TERMINAL_ERROR_THRESHOLD_INVALID",
    );

    const startedAt = this.now();
    const completed: WorkerMetricsSample[] = [];
    const failures: Array<{ sample: number; errorType: string }> = [];
    for (let index = 0; index < samples; index += 1) {
      try {
        const observation = await this.sampler(requestTimeoutMs);
        if (!Number.isFinite(observation.durationMs) || observation.durationMs < 0) {
          throw soakError("WORKER_METRICS_SAMPLE_INVALID");
        }
        completed.push(observation);
      } catch (error) {
        failures.push({ sample: index + 1, errorType: sanitizedErrorType(error) });
      }
      if (index < samples - 1) await this.sleep(intervalMs);
    }
    const completedAt = this.now();
    const durations = completed.map(({ durationMs }) => durationMs);
    const latencyMs = {
      p50: percentile(durations, 0.5),
      p95: percentile(durations, 0.95),
      p99: percentile(durations, 0.99),
      max: rounded(durations.length > 0 ? Math.max(...durations) : 0),
    };
    const critical = completed.filter(({ snapshot }) => snapshot.healthStatus === 2).length;
    const attention = completed.filter(({ snapshot }) => snapshot.healthStatus === 1).length;

    const queues = WORKER_QUEUE_NAMES.map((name) => {
      const observations = completed.map(({ snapshot }) => snapshot.queues[name]);
      const first = observations[0];
      const last = observations.at(-1);
      const peakDue = observations.length ? Math.max(...observations.map(({ due }) => due)) : null;
      const peakStaleLocks = observations.length ? Math.max(...observations.map(({ staleLocks }) => staleLocks)) : null;
      const backlogGrowth = first && last ? Math.max(0, last.due - first.due) : null;
      const terminalErrorGrowth = first && last ? Math.max(0, last.terminalErrors - first.terminalErrors) : null;
      const healthy =
        first !== undefined &&
        last !== undefined &&
        peakStaleLocks === 0 &&
        backlogGrowth !== null &&
        backlogGrowth <= maximumBacklogGrowth &&
        terminalErrorGrowth !== null &&
        terminalErrorGrowth <= maximumTerminalErrorGrowth;
      return {
        name,
        baselineDue: first?.due ?? null,
        finalDue: last?.due ?? null,
        peakDue,
        backlogGrowth,
        peakStaleLocks,
        baselineTerminalErrors: first?.terminalErrors ?? null,
        finalTerminalErrors: last?.terminalErrors ?? null,
        terminalErrorGrowth,
        healthy,
      };
    });

    const latencyMet = latencyMs.p95 <= maximumP95Ms;
    const criticalSamplesMet = critical <= maximumCriticalSamples;
    const queueHealthMet = queues.every(({ healthy }) => healthy);
    const timestamps = completed.map(({ snapshot }) => snapshot.checkedTimestampSeconds);
    const timestampRegressed = timestamps.some((value, index) => index > 0 && value < timestamps[index - 1]!);
    const observationWindowMs = intervalMs * (samples - 1);
    const metricsFreshnessMet =
      !timestampRegressed &&
      (observationWindowMs < 1_000 || timestamps.length < 2 || timestamps.at(-1)! > timestamps[0]!);
    return {
      ok: completed.length === samples && latencyMet && criticalSamplesMet && queueHealthMet && metricsFreshnessMet,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      durationMs: Math.max(1, completedAt.getTime() - startedAt.getTime()),
      samples: { planned: samples, completed: completed.length, failed: failures.length, critical, attention },
      latencyMs,
      thresholds: {
        maximumP95Ms,
        maximumCriticalSamples,
        maximumBacklogGrowth,
        maximumTerminalErrorGrowth,
        latencyMet,
        criticalSamplesMet,
        queueHealthMet,
        metricsFreshnessMet,
      },
      queues,
      failures,
    };
  }
}
