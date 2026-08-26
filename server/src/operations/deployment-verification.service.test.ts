import { describe, expect, it, vi } from "vitest";
import {
  DeploymentVerificationService,
  validateDeploymentTarget,
  type DeploymentProbeResult,
  type DeploymentVerificationConfig,
} from "./deployment-verification.service.js";

const digest = `sha256:${"a".repeat(64)}`;
const identity = { commitSha: "a".repeat(40), imageDigest: digest };
const config: DeploymentVerificationConfig = {
  samples: 3,
  intervalMs: 100,
  requestTimeoutMs: 1_000,
  maximumP95Ms: 500,
  expectedCommitSha: identity.commitSha,
  expectedImageDigest: identity.imageDigest,
};

function result(overrides: Partial<DeploymentProbeResult> = {}): DeploymentProbeResult {
  return { durationMs: 20, liveness: true, readiness: true, identity, ...overrides };
}

describe("DeploymentVerificationService", () => {
  it("allows HTTPS origins and local HTTP while rejecting unsafe deployment targets", () => {
    expect(validateDeploymentTarget("https://api.example.com")).toBe("https://api.example.com");
    expect(validateDeploymentTarget("http://127.0.0.1:3000")).toBe("http://127.0.0.1:3000");
    expect(() => validateDeploymentTarget("http://api.example.com")).toThrowError(
      expect.objectContaining({ name: "DEPLOY_VERIFY_BASE_URL_INVALID" }),
    );
    expect(() => validateDeploymentTarget("https://user:password@api.example.com/path")).toThrowError(
      expect.objectContaining({ name: "DEPLOY_VERIFY_BASE_URL_INVALID" }),
    );
  });

  it("accepts repeated healthy probes from the exact candidate image", async () => {
    const durations = [10, 20, 30];
    const sleep = vi.fn(async () => undefined);
    const dates = [new Date("2026-08-25T00:00:00Z"), new Date("2026-08-25T00:00:01Z")];
    const report = await new DeploymentVerificationService(
      async () => result({ durationMs: durations.shift()! }),
      () => dates.shift()!,
      sleep,
    ).run(config);

    expect(report.ok).toBe(true);
    expect(report.rollbackRecommended).toBe(false);
    expect(report.samples).toEqual({
      planned: 3, completed: 3, failed: 0, livenessFailures: 0, readinessFailures: 0, identityMismatches: 0,
    });
    expect(report.latencyMs).toEqual({ p50: 20, p95: 30, p99: 30, max: 30 });
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("recommends rollback for readiness or candidate identity mismatches", async () => {
    const responses = [
      result(),
      result({ readiness: false }),
      result({ identity: { ...identity, commitSha: "1".repeat(40) } }),
    ];
    const report = await new DeploymentVerificationService(
      async () => responses.shift()!,
      () => new Date("2026-08-25T00:00:00Z"),
      async () => undefined,
    ).run(config);
    expect(report.ok).toBe(false);
    expect(report.rollbackRecommended).toBe(true);
    expect(report.samples).toMatchObject({ readinessFailures: 1, identityMismatches: 1 });
  });

  it("sanitizes probe failures and fails closed", async () => {
    const error = new Error("https://private.example/token");
    error.name = "FETCH_FAILED";
    const report = await new DeploymentVerificationService(
      async () => { throw error; },
      () => new Date("2026-08-25T00:00:00Z"),
      async () => undefined,
    ).run(config);
    expect(report.ok).toBe(false);
    expect(report.failures).toEqual([
      { sample: 1, errorType: "FETCH_FAILED" },
      { sample: 2, errorType: "FETCH_FAILED" },
      { sample: 3, errorType: "FETCH_FAILED" },
    ]);
    expect(JSON.stringify(report)).not.toContain("private.example");
  });

  it("rejects unsafe bounds and mutable expected identities", async () => {
    const service = new DeploymentVerificationService(async () => result());
    await expect(service.run({ ...config, samples: 0 })).rejects.toMatchObject({ name: "DEPLOY_VERIFY_SAMPLES_INVALID" });
    await expect(service.run({ ...config, expectedCommitSha: "main" })).rejects.toMatchObject({
      name: "DEPLOY_VERIFY_COMMIT_SHA_INVALID",
    });
    await expect(service.run({ ...config, expectedImageDigest: "latest" })).rejects.toMatchObject({
      name: "DEPLOY_VERIFY_IMAGE_DIGEST_INVALID",
    });
  });
});
