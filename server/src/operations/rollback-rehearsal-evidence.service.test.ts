import { describe, expect, it } from "vitest";
import { calculateDeploymentVerificationEvidenceSha256 } from "./deployment-verification.service.js";
import {
  RollbackRehearsalEvidenceService,
  type RollbackRehearsalEvidenceInput,
} from "./rollback-rehearsal-evidence.service.js";

const currentCommit = "a".repeat(40);
const targetCommit = "b".repeat(40);
const currentDigest = `sha256:${"c".repeat(64)}`;
const targetDigest = `sha256:${"d".repeat(64)}`;
const webHash = "e".repeat(64);
const hash = "f".repeat(64);
const now = () => new Date("2026-08-31T12:00:00.000Z");

function deploymentVerification() {
  const base = {
    schemaVersion: 2,
    releaseId: "release-previous",
    ok: true,
    rollbackRecommended: false,
    startedAt: "2026-08-31T10:59:00.000Z",
    completedAt: "2026-08-31T11:00:00.000Z",
    expected: { commitSha: targetCommit, imageDigest: targetDigest },
    samples: {
      planned: 3,
      completed: 3,
      failed: 0,
      livenessFailures: 0,
      readinessFailures: 0,
      identityMismatches: 0,
    },
    probes: [10, 20, 30].map((durationMs, index) => ({
      sample: index + 1,
      durationMs,
      liveness: true,
      readiness: true,
      identityMatched: true,
    })),
    latencyMs: { p50: 20, p95: 30, p99: 30, max: 30 },
    threshold: { maximumP95Ms: 500, latencyMet: true },
    failures: [],
    web: {
      ok: true,
      checkedAt: "2026-08-31T11:00:00.000Z",
      expected: { commitSha: targetCommit, manifestSha256: webHash },
      checks: [{ name: "manifest", status: "pass", code: "OK" }],
    },
  };
  return { ...base, evidenceSha256: calculateDeploymentVerificationEvidenceSha256(base) };
}

function input(): RollbackRehearsalEvidenceInput {
  return {
    drillId: "rollback-drill-2026-q3",
    environmentLabel: "isolated-staging-drill",
    apiBaseUrl: "https://api.rollback-drill.example.net",
    webBaseUrl: "https://web.rollback-drill.example.net",
    maximumAgeHours: 24,
    currentAcceptance: {
      ok: true,
      releaseId: "release-current",
      commitSha: currentCommit,
      imageDigest: currentDigest,
      checkedAt: "2026-08-31T10:00:00.000Z",
      secret: "must-not-copy",
    },
    targetCloseout: {
      ok: true,
      releaseId: "release-previous",
      commitSha: targetCommit,
      imageDigest: targetDigest,
      imageReference: `ghcr.io/example/api@${targetDigest}`,
      webDeploymentManifestSha256: webHash,
      closedAt: "2026-08-30T10:00:00.000Z",
      closeoutSha256: "1".repeat(64),
    },
    deploymentVerification: deploymentVerification(),
    sourceSha256: { currentAcceptance: hash, targetCloseout: hash, deploymentVerification: hash },
  };
}

describe("RollbackRehearsalEvidenceService", () => {
  it("seals a successful isolated rollback and re-verification without copying secrets or URLs", () => {
    const report = new RollbackRehearsalEvidenceService(now).create(input());
    expect(report.ok).toBe(true);
    expect(report.target.imageReference).toContain(`@${targetDigest}`);
    expect(report.evidenceSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify(report)).not.toContain("must-not-copy");
    expect(JSON.stringify(report)).not.toContain("rollback-drill.example.net");
  });

  it("rejects production-looking or insecure drill targets", () => {
    const value = input();
    value.environmentLabel = "production";
    value.apiBaseUrl = "http://api.example.com";
    const report = new RollbackRehearsalEvidenceService(now).create(value);
    expect(report.checks).toContainEqual({
      name: "isolatedEnvironment", status: "fail", code: "ROLLBACK_REHEARSAL_ENVIRONMENT_NOT_ISOLATED",
    });
  });

  it("rejects the current image as a rollback target and identity mismatches", () => {
    const value = input();
    const closeout = value.targetCloseout as { commitSha: string; imageDigest: string; imageReference: string };
    closeout.commitSha = currentCommit;
    closeout.imageDigest = currentDigest;
    closeout.imageReference = `ghcr.io/example/api@${currentDigest}`;
    const report = new RollbackRehearsalEvidenceService(now).create(value);
    expect(report.checks.map(({ name, status }) => ({ name, status }))).toEqual(expect.arrayContaining([
      { name: "previousRelease", status: "fail" },
      { name: "deploymentIdentity", status: "fail" },
    ]));
  });

  it("rejects unhealthy, incomplete, stale, or chronologically invalid verification", () => {
    const value = input();
    const verification = value.deploymentVerification as {
      ok: boolean; completedAt: string; samples: { completed: number };
    };
    verification.ok = false;
    verification.samples.completed = 2;
    verification.completedAt = "2026-08-29T11:00:00.000Z";
    const report = new RollbackRehearsalEvidenceService(now).create(value);
    expect(report.checks).toContainEqual({
      name: "deploymentHealth", status: "fail", code: "ROLLBACK_REHEARSAL_DEPLOYMENT_VERIFICATION_INVALID",
    });
    expect(report.checks).toContainEqual({
      name: "timeline", status: "fail", code: "ROLLBACK_REHEARSAL_TIMELINE_INVALID_OR_EXPIRED",
    });
  });

  it("rejects invalid drill metadata, age limits, and source hashes", () => {
    const service = new RollbackRehearsalEvidenceService(now);
    expect(() => service.create({ ...input(), drillId: "../unsafe" }))
      .toThrowError(expect.objectContaining({ name: "ROLLBACK_REHEARSAL_DRILL_ID_INVALID" }));
    expect(() => service.create({ ...input(), maximumAgeHours: 0 }))
      .toThrowError(expect.objectContaining({ name: "ROLLBACK_REHEARSAL_MAXIMUM_AGE_INVALID" }));
    expect(() => service.create({
      ...input(), sourceSha256: { ...input().sourceSha256, targetCloseout: "invalid" },
    })).toThrowError(expect.objectContaining({ name: "ROLLBACK_REHEARSAL_SOURCE_SHA256_INVALID" }));
  });
});
