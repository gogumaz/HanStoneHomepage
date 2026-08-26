import type { ExecutionContext } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InternalMetricsController, formatWorkerHealthMetrics } from "./internal-metrics.controller.js";
import { MetricsTokenGuard } from "./metrics-token.guard.js";
import type { WorkerHealthReport, WorkerHealthService } from "./worker-health.service.js";

const token = "metrics_token_1234567890_abcdefghij";

function context(authorization?: string): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers: { authorization } }) }),
  } as unknown as ExecutionContext;
}

const report: WorkerHealthReport = {
  status: "critical",
  checkedAt: "2026-08-24T00:30:00.000Z",
  backlogThresholdMinutes: 15,
  queues: [
    { name: "accountMail", status: "critical", due: 2, staleLocks: 1, terminalErrors: 0, oldestDueAt: "2026-08-24T00:00:00.000Z" },
    { name: "inquiryNotification", status: "attention", due: 0, staleLocks: 0, terminalErrors: 1, oldestDueAt: null },
    { name: "videoScan", status: "healthy", due: 0, staleLocks: 0, terminalErrors: 0, oldestDueAt: null },
    { name: "hlsTranscode", status: "healthy", due: 0, staleLocks: 0, terminalErrors: 0, oldestDueAt: null },
    { name: "objectDeletion", status: "healthy", due: 0, staleLocks: 0, terminalErrors: 0, oldestDueAt: null },
  ],
};

describe("internal worker metrics", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("uses a constant-time bearer token check and rejects missing credentials", () => {
    vi.stubEnv("DATABASE_URL", "postgresql://test:test@localhost/test");
    vi.stubEnv("OPERATIONS_METRICS_TOKEN", token);
    const guard = new MetricsTokenGuard();
    expect(guard.canActivate(context(`Bearer ${token}`))).toBe(true);
    expect(() => guard.canActivate(context("Bearer invalid_invalid_invalid_invalid_123")))
      .toThrow(expect.objectContaining({ code: "OPERATIONS_METRICS_UNAUTHORIZED", status: 401 }));
    expect(() => guard.canActivate(context()))
      .toThrow(expect.objectContaining({ code: "OPERATIONS_METRICS_UNAUTHORIZED", status: 401 }));
  });

  it("renders bounded Prometheus gauges without queue payloads", () => {
    const metrics = formatWorkerHealthMetrics(report);
    expect(metrics).toContain("baduk_worker_health_status 2");
    expect(metrics).toContain('baduk_worker_queue_due{queue="account_mail"} 2');
    expect(metrics).toContain('baduk_worker_queue_stale_locks{queue="account_mail"} 1');
    expect(metrics).toContain('baduk_worker_queue_terminal_errors{queue="inquiry_notification"} 1');
    expect(metrics).not.toContain("2026-08-24T00:00:00.000Z");
  });

  it("returns Prometheus content with no-store headers", async () => {
    const service = { inspect: vi.fn(async () => report) } as unknown as WorkerHealthService;
    const controller = new InternalMetricsController(service);
    const response = { setHeader: vi.fn(), send: vi.fn() };
    await controller.workerMetrics(response);
    expect(response.setHeader).toHaveBeenCalledWith(
      "Content-Type",
      "text/plain; version=0.0.4; charset=utf-8",
    );
    expect(response.setHeader).toHaveBeenCalledWith("Cache-Control", "private, no-store");
    expect(response.send).toHaveBeenCalledWith(expect.stringContaining("baduk_worker_health_status 2"));
  });

  it("returns only the protected immutable release identity", () => {
    vi.stubEnv("DEPLOYMENT_COMMIT_SHA", "A".repeat(40));
    vi.stubEnv("DEPLOYMENT_IMAGE_DIGEST", `sha256:${"a".repeat(64)}`);
    const service = { inspect: vi.fn(async () => report) } as unknown as WorkerHealthService;
    const controller = new InternalMetricsController(service);
    expect(controller.releaseIdentity()).toEqual({
      commitSha: "a".repeat(40),
      imageDigest: `sha256:${"a".repeat(64)}`,
    });
    expect(JSON.stringify(controller.releaseIdentity())).not.toContain(token);
  });
});
