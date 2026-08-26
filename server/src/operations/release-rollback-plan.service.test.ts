import { describe, expect, it } from "vitest";
import {
  ReleaseRollbackPlanService,
  ROLLBACK_CONFIRMATION,
  type ReleaseRollbackPlanInput,
} from "./release-rollback-plan.service.js";

const currentDigest = `sha256:${"a".repeat(64)}`;
const targetDigest = `sha256:${"b".repeat(64)}`;
const currentWebManifestSha256 = "5".repeat(64);
const targetWebManifestSha256 = "6".repeat(64);

function input(): ReleaseRollbackPlanInput {
  return {
    currentAcceptanceSha256: "1".repeat(64),
    failedDeploymentVerificationSha256: "2".repeat(64),
    targetCloseoutSha256: "3".repeat(64),
    databaseStrategy: "forward-only",
    confirmation: ROLLBACK_CONFIRMATION,
    maximumFailureAgeHours: 24,
    currentAcceptance: {
      ok: true,
      releaseId: "release-current",
      commitSha: "a".repeat(40),
      imageDigest: currentDigest,
      imageReference: `registry.example.com/api@${currentDigest}`,
      checkedAt: "2026-08-25T00:00:00.000Z",
      evidence: [{ name: "webDeployment", status: "pass", sha256: currentWebManifestSha256 }],
      privateValue: "do-not-copy",
    },
    failedDeploymentVerification: {
      ok: false,
      rollbackRecommended: true,
      completedAt: "2026-08-25T00:10:00.000Z",
      expected: { commitSha: "a".repeat(40), imageDigest: currentDigest },
      web: {
        expected: { commitSha: "a".repeat(40), manifestSha256: currentWebManifestSha256 },
      },
      failures: [{ errorType: "PRIVATE_FAILURE" }],
    },
    targetCloseout: {
      ok: true,
      releaseId: "release-previous",
      commitSha: "b".repeat(40),
      imageDigest: targetDigest,
      imageReference: `registry.example.com/api@${targetDigest}`,
      webDeploymentManifestSha256: targetWebManifestSha256,
      closedAt: "2026-08-24T00:00:00.000Z",
      closeoutSha256: "4".repeat(64),
    },
  };
}

describe("ReleaseRollbackPlanService", () => {
  const now = () => new Date("2026-08-25T01:00:00.000Z");

  it("authorizes only a previous immutable release after a fresh failed verification", () => {
    const service = new ReleaseRollbackPlanService(now);
    const report = service.run(input());
    expect(report.ok).toBe(true);
    expect(report.rollbackAuthorized).toBe(true);
    expect(report.current.releaseId).toBe("release-current");
    expect(report.target).toMatchObject({
      releaseId: "release-previous",
      imageDigest: targetDigest,
      webDeploymentManifestSha256: targetWebManifestSha256,
    });
    expect(report.rollbackPlanSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(service.run(input()).rollbackPlanSha256).toBe(report.rollbackPlanSha256);
    expect(JSON.stringify(report)).not.toContain("do-not-copy");
    expect(JSON.stringify(report)).not.toContain("PRIVATE_FAILURE");
  });

  it("rejects rollback without a verifier recommendation or with the same target image", () => {
    const value = input();
    (value.failedDeploymentVerification as { rollbackRecommended: boolean }).rollbackRecommended = false;
    const target = value.targetCloseout as { commitSha: string; imageDigest: string; imageReference: string };
    target.commitSha = "a".repeat(40);
    target.imageDigest = currentDigest;
    target.imageReference = `registry.example.com/api@${currentDigest}`;
    const report = new ReleaseRollbackPlanService(now).run(value);
    expect(report.ok).toBe(false);
    expect(report.checks).toContainEqual({
      name: "failedDeployment",
      status: "fail",
      code: "ROLLBACK_NOT_RECOMMENDED_BY_VERIFICATION",
    });
    expect(report.checks).toContainEqual({
      name: "targetDifferent",
      status: "fail",
      code: "ROLLBACK_TARGET_NOT_PREVIOUS_IMAGE",
    });
  });

  it("requires forward-only database handling and explicit authorization", () => {
    const value = input();
    value.databaseStrategy = "rollback-migrations";
    value.confirmation = "yes";
    const report = new ReleaseRollbackPlanService(now).run(value);
    expect(report.rollbackAuthorized).toBe(false);
    expect(report.checks).toContainEqual({
      name: "databaseStrategy",
      status: "fail",
      code: "ROLLBACK_DATABASE_STRATEGY_INVALID",
    });
    expect(report.checks).toContainEqual({
      name: "confirmation",
      status: "fail",
      code: "ROLLBACK_CONFIRMATION_REQUIRED",
    });
  });

  it("rejects a failed web deployment identity that does not match the current accepted artifact", () => {
    const value = input();
    const failed = value.failedDeploymentVerification as { web: { expected: { manifestSha256: string } } };
    failed.web.expected.manifestSha256 = "9".repeat(64);
    const report = new ReleaseRollbackPlanService(now).run(value);

    expect(report.rollbackAuthorized).toBe(false);
    expect(report.checks).toContainEqual({
      name: "failedCandidateIdentity",
      status: "fail",
      code: "ROLLBACK_FAILED_CANDIDATE_MISMATCH",
    });
  });

  it("rejects stale failure evidence, invalid timelines, hashes, and policy bounds", () => {
    const stale = input();
    (stale.failedDeploymentVerification as { completedAt: string }).completedAt = "2026-08-20T00:00:00.000Z";
    const staleReport = new ReleaseRollbackPlanService(now).run(stale);
    expect(staleReport.checks).toContainEqual({
      name: "failureFreshness",
      status: "fail",
      code: "ROLLBACK_FAILURE_EVIDENCE_EXPIRED",
    });

    expect(() => new ReleaseRollbackPlanService(now).run({ ...input(), currentAcceptanceSha256: "invalid" }))
      .toThrowError(expect.objectContaining({ name: "ROLLBACK_ARTIFACT_SHA256_INVALID" }));
    expect(() => new ReleaseRollbackPlanService(now).run({ ...input(), maximumFailureAgeHours: 0 }))
      .toThrowError(expect.objectContaining({ name: "ROLLBACK_FAILURE_MAXIMUM_AGE_INVALID" }));
  });
});
