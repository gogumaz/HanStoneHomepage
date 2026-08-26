import { describe, expect, it, vi } from "vitest";
import {
  parseWorkerMetrics,
  WorkerSoakService,
  type WorkerMetricsSample,
  type WorkerSoakConfig,
} from "./worker-soak.service.js";

function metrics(overrides: { health?: number; due?: number; stale?: number; terminal?: number } = {}): string {
  const health = overrides.health ?? 0;
  const due = overrides.due ?? 0;
  const stale = overrides.stale ?? 0;
  const terminal = overrides.terminal ?? 0;
  const queues = ["account_mail", "inquiry_notification", "video_scan", "hls_transcode", "object_deletion"];
  return [
    "# HELP baduk_worker_health_status status",
    `baduk_worker_health_status ${health}`,
    ...queues.flatMap((queue) => [
      `baduk_worker_queue_due{queue="${queue}"} ${due}`,
      `baduk_worker_queue_stale_locks{queue="${queue}"} ${stale}`,
      `baduk_worker_queue_terminal_errors{queue="${queue}"} ${terminal}`,
    ]),
    "baduk_worker_health_checked_timestamp_seconds 1787529600",
  ].join("\n");
}

const config: WorkerSoakConfig = {
  samples: 3,
  intervalMs: 100,
  requestTimeoutMs: 1_000,
  maximumP95Ms: 500,
  maximumCriticalSamples: 0,
  maximumBacklogGrowth: 0,
  maximumTerminalErrorGrowth: 0,
};

function sample(text: string, durationMs = 20): WorkerMetricsSample {
  return { durationMs, snapshot: parseWorkerMetrics(text) };
}

describe("parseWorkerMetrics", () => {
  it("parses every protected worker queue metric", () => {
    const snapshot = parseWorkerMetrics(metrics({ health: 1, due: 2, terminal: 3 }));
    expect(snapshot.healthStatus).toBe(1);
    expect(snapshot.queues.video_scan).toEqual({ due: 2, staleLocks: 0, terminalErrors: 3 });
  });

  it("rejects missing, duplicate, unknown, and oversized metric data", () => {
    expect(() => parseWorkerMetrics(metrics().replace('baduk_worker_queue_due{queue="video_scan"} 0\n', ""))).toThrowError(
      expect.objectContaining({ name: "WORKER_METRICS_REQUIRED_VALUE_MISSING" }),
    );
    expect(() => parseWorkerMetrics(`${metrics()}\nbaduk_worker_health_status 0`)).toThrowError(
      expect.objectContaining({ name: "WORKER_METRICS_DUPLICATE" }),
    );
    expect(() => parseWorkerMetrics(`${metrics()}\nbaduk_worker_queue_due{queue="unknown"} 0`)).toThrowError(
      expect.objectContaining({ name: "WORKER_METRICS_QUEUE_UNKNOWN" }),
    );
    expect(() => parseWorkerMetrics("x".repeat(65_537))).toThrowError(
      expect.objectContaining({ name: "WORKER_METRICS_BODY_TOO_LARGE" }),
    );
  });
});

describe("WorkerSoakService", () => {
  it("passes a stable queue and reports latency without exposing sampler errors", async () => {
    const results = [sample(metrics({ due: 2 }), 10), sample(metrics({ due: 1 }), 20), sample(metrics(), 30)];
    const sampler = vi.fn(async () => results.shift()!);
    const sleep = vi.fn(async () => undefined);
    const dates = [new Date("2026-08-24T00:00:00.000Z"), new Date("2026-08-24T00:00:01.000Z")];
    const report = await new WorkerSoakService(sampler, () => dates.shift()!, sleep).run(config);

    expect(report.ok).toBe(true);
    expect(report.samples).toEqual({ planned: 3, completed: 3, failed: 0, critical: 0, attention: 0 });
    expect(report.latencyMs).toEqual({ p50: 20, p95: 30, p99: 30, max: 30 });
    expect(report.queues[0]).toMatchObject({ baselineDue: 2, finalDue: 0, backlogGrowth: 0, healthy: true });
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("fails on growing backlog, stale locks, terminal error growth, and critical health", async () => {
    const results = [
      sample(metrics()),
      sample(metrics({ health: 2, due: 1, stale: 1, terminal: 1 })),
      sample(metrics({ due: 2, terminal: 1 })),
    ];
    const report = await new WorkerSoakService(
      async () => results.shift()!,
      () => new Date("2026-08-24T00:00:00.000Z"),
      async () => undefined,
    ).run(config);

    expect(report.ok).toBe(false);
    expect(report.thresholds).toMatchObject({ criticalSamplesMet: false, queueHealthMet: false });
    expect(report.queues[0]).toMatchObject({ backlogGrowth: 2, peakStaleLocks: 1, terminalErrorGrowth: 1, healthy: false });
  });

  it("records only a sanitized error type when sampling fails", async () => {
    let index = 0;
    const report = await new WorkerSoakService(
      async () => {
        index += 1;
        if (index === 2) {
          const error = new Error("secret URL and token");
          error.name = "FETCH_FAILED";
          throw error;
        }
        return sample(metrics());
      },
      () => new Date("2026-08-24T00:00:00.000Z"),
      async () => undefined,
    ).run(config);

    expect(report.ok).toBe(false);
    expect(report.failures).toEqual([{ sample: 2, errorType: "FETCH_FAILED" }]);
    expect(JSON.stringify(report)).not.toContain("secret URL and token");
  });

  it("fails a long observation when the protected metrics timestamp is cached", async () => {
    const report = await new WorkerSoakService(
      async () => sample(metrics()),
      () => new Date("2026-08-24T00:00:00.000Z"),
      async () => undefined,
    ).run({ ...config, intervalMs: 1_000 });

    expect(report.ok).toBe(false);
    expect(report.thresholds.metricsFreshnessMet).toBe(false);
  });

  it("rejects unsafe sampling bounds", async () => {
    const service = new WorkerSoakService(async () => sample(metrics()));
    await expect(service.run({ ...config, samples: 1 })).rejects.toMatchObject({ name: "WORKER_SOAK_SAMPLES_INVALID" });
    await expect(service.run({ ...config, intervalMs: 99 })).rejects.toMatchObject({ name: "WORKER_SOAK_INTERVAL_INVALID" });
    await expect(service.run({ ...config, maximumCriticalSamples: 4 })).rejects.toMatchObject({
      name: "WORKER_SOAK_CRITICAL_THRESHOLD_INVALID",
    });
  });
});
