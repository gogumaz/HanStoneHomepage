import { describe, expect, it, vi } from "vitest";
import {
  PRODUCTION_LOAD_CONFIRMATION,
  ReadOnlyLoadTestService,
  validateLoadTestTarget,
} from "./read-only-load-test.service.js";

const scenarios = [
  { name: "liveness", path: "/api/v1/health/live" },
  { name: "lessons", path: "/api/v1/lessons" },
] as const;

const passingConfig = {
  requests: 4,
  concurrency: 2,
  requestTimeoutMs: 5_000,
  maximumP95Ms: 100,
  maximumErrorRatePercent: 1,
};

describe("validateLoadTestTarget", () => {
  it("allows local and explicitly non-production targets", () => {
    expect(validateLoadTestTarget("http://127.0.0.1:3000")).toBe("http://127.0.0.1:3000");
    expect(validateLoadTestTarget("https://api.staging.example.com/")).toBe("https://api.staging.example.com");
  });

  it("rejects unmarked external targets by default", () => {
    expect(() => validateLoadTestTarget("https://api.example.com")).toThrowError(expect.objectContaining({
      name: "LOAD_TEST_TARGET_NOT_NON_PRODUCTION",
    }));
  });

  it("requires an exact confirmation and HTTPS for an explicitly allowed production target", () => {
    expect(() => validateLoadTestTarget("https://api.example.com", true, "yes")).toThrowError(expect.objectContaining({
      name: "LOAD_TEST_PRODUCTION_CONFIRMATION_REQUIRED",
    }));
    expect(() => validateLoadTestTarget(
      "http://api.example.com",
      true,
      PRODUCTION_LOAD_CONFIRMATION,
    )).toThrowError(expect.objectContaining({ name: "LOAD_TEST_PRODUCTION_HTTPS_REQUIRED" }));
    expect(validateLoadTestTarget(
      "https://api.example.com",
      true,
      PRODUCTION_LOAD_CONFIRMATION,
    )).toBe("https://api.example.com");
  });

  it("rejects credentials, paths, queries, and fragments", () => {
    expect(() => validateLoadTestTarget("https://user:secret@api.staging.example.com")).toThrowError();
    expect(() => validateLoadTestTarget("https://api.staging.example.com/api")).toThrowError();
    expect(() => validateLoadTestTarget("https://api.staging.example.com/?token=secret")).toThrowError();
  });
});

describe("ReadOnlyLoadTestService", () => {
  it("runs a bounded concurrent scenario rotation and passes configured thresholds", async () => {
    const durations = [10, 20, 30, 40];
    const requester = vi.fn(async () => ({
      durationMs: durations.shift()!,
      statusCode: 200,
      ok: true,
      errorType: null,
    }));
    const times = [new Date("2026-08-24T04:00:00.000Z"), new Date("2026-08-24T04:00:01.000Z")];
    const report = await new ReadOnlyLoadTestService(requester, () => times.shift()!).run(scenarios, passingConfig);

    expect(report.ok).toBe(true);
    expect(requester).toHaveBeenCalledTimes(4);
    expect(report.requests).toMatchObject({
      planned: 4,
      completed: 4,
      succeeded: 4,
      failed: 0,
      requestsPerSecond: 4,
      errorRatePercent: 0,
    });
    expect(report.latencyMs).toEqual({ p50: 20, p95: 40, p99: 40, max: 40 });
    expect(report.scenarios.map((scenario) => scenario.requests)).toEqual([2, 2]);
  });

  it("fails the report when latency or error-rate thresholds are missed", async () => {
    let request = 0;
    const requester = vi.fn(async () => {
      request += 1;
      return {
        durationMs: request === 4 ? 900 : 25,
        statusCode: request === 3 ? 503 : 200,
        ok: request !== 3,
        errorType: null,
      };
    });
    const clock = vi.fn()
      .mockReturnValueOnce(new Date("2026-08-24T04:00:00.000Z"))
      .mockReturnValue(new Date("2026-08-24T04:00:01.000Z"));
    const report = await new ReadOnlyLoadTestService(requester, clock).run(scenarios, {
      ...passingConfig,
      maximumP95Ms: 500,
      maximumErrorRatePercent: 10,
    });

    expect(report.ok).toBe(false);
    expect(report.requests).toMatchObject({ failed: 1, errorRatePercent: 25 });
    expect(report.thresholds).toEqual({
      maximumP95Ms: 500,
      maximumErrorRatePercent: 10,
      latencyMet: false,
      errorRateMet: false,
    });
  });

  it("converts requester failures to non-sensitive failed samples", async () => {
    const requester = vi.fn(async () => {
      throw new Error("https://user:secret@api.staging.example.com/private");
    });
    const clock = vi.fn()
      .mockReturnValueOnce(new Date("2026-08-24T04:00:00.000Z"))
      .mockReturnValue(new Date("2026-08-24T04:00:01.000Z"));
    const report = await new ReadOnlyLoadTestService(requester, clock).run(scenarios, {
      ...passingConfig,
      maximumErrorRatePercent: 100,
    });

    expect(report.requests.failed).toBe(4);
    expect(JSON.stringify(report)).not.toContain("secret");
    expect(JSON.stringify(report)).not.toContain("api.staging.example.com");
  });

  it("rejects unsafe request, concurrency, and scenario bounds", async () => {
    const requester = vi.fn();
    const service = new ReadOnlyLoadTestService(requester);

    await expect(service.run(scenarios, { ...passingConfig, concurrency: 201 })).rejects.toMatchObject({
      name: "LOAD_TEST_CONCURRENCY_INVALID",
    });
    await expect(service.run(scenarios, { ...passingConfig, requests: 1 })).rejects.toMatchObject({
      name: "LOAD_TEST_REQUESTS_BELOW_SCENARIO_COUNT",
    });
    expect(requester).not.toHaveBeenCalled();
  });
});
