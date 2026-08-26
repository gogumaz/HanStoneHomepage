import { describe, expect, it } from "vitest";
import { ReleaseCloseoutService, type ReleaseCloseoutInput } from "./release-closeout.service.js";

const commitSha = "a".repeat(40);
const imageDigest = `sha256:${"a".repeat(64)}`;
const webManifestSha256 = "4".repeat(64);
const webChecks = [
  "manifestSha256", "manifestSchema", "manifestCommit", "manifestCacheControl", "manifestContentType",
  "indexInventory", "assetInventory", "indexSha256", "indexCacheControl", "indexContentType",
  "assetSha256", "assetCacheControl", "assetContentType",
].map((name) => ({ name, status: "pass", code: "OK" }));

function validInput(): ReleaseCloseoutInput {
  return {
    acceptanceSha256: "1".repeat(64),
    deploymentVerificationSha256: "2".repeat(64),
    maximumVerificationDelayHours: 24,
    acceptance: {
      ok: true,
      releaseId: "release-2026.08.25",
      commitSha,
      imageReference: `registry.example.com/baduk-history-api@${imageDigest}`,
      imageDigest,
      manifestSha256: "3".repeat(64),
      checkedAt: "2026-08-25T00:00:00.000Z",
      evidence: [
        "preflight", "recovery", "readOnlyLoad", "workerSoak", "webDeployment", "fieldValidation", "supplyChain",
      ]
        .map((name) => ({ name, status: "pass", sha256: name === "webDeployment" ? webManifestSha256 : "5".repeat(64) })),
      privateDetail: "do-not-copy",
    },
    deploymentVerification: {
      ok: true,
      rollbackRecommended: false,
      completedAt: "2026-08-25T00:10:00.000Z",
      expected: { commitSha, imageDigest },
      samples: {
        planned: 3,
        completed: 3,
        failed: 0,
        livenessFailures: 0,
        readinessFailures: 0,
        identityMismatches: 0,
      },
      threshold: { latencyMet: true },
      web: {
        ok: true,
        expected: { commitSha, manifestSha256: webManifestSha256 },
        checks: webChecks.map((item) => ({ ...item })),
      },
      failures: [],
      targetUrl: "https://private.example.com",
    },
  };
}

describe("ReleaseCloseoutService", () => {
  it("closes a release only after matching successful acceptance and deployment verification", () => {
    const service = new ReleaseCloseoutService(() => new Date("2026-08-25T00:11:00.000Z"));
    const report = service.run(validInput());

    expect(report.ok).toBe(true);
    expect(report).toMatchObject({
      releaseId: "release-2026.08.25",
      commitSha,
      imageReference: `registry.example.com/baduk-history-api@${imageDigest}`,
      imageDigest,
      webDeploymentManifestSha256: webManifestSha256,
    });
    expect(report.timeline.verificationDelayMinutes).toBe(10);
    expect(report.closeoutSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(service.run(validInput()).closeoutSha256).toBe(report.closeoutSha256);
    expect(JSON.stringify(report)).not.toContain("do-not-copy");
    expect(JSON.stringify(report)).not.toContain("private.example.com");
  });

  it("rejects a different deployed candidate and rollback recommendation", () => {
    const input = validInput();
    const deployment = input.deploymentVerification as {
      rollbackRecommended: boolean;
      expected: { commitSha: string };
    };
    deployment.rollbackRecommended = true;
    deployment.expected.commitSha = "1".repeat(40);
    const report = new ReleaseCloseoutService(() => new Date("2026-08-25T00:11:00.000Z")).run(input);

    expect(report.ok).toBe(false);
    expect(report.checks).toContainEqual({
      name: "rollbackDecision",
      status: "fail",
      code: "DEPLOYMENT_ROLLBACK_RECOMMENDED",
    });
    expect(report.checks).toContainEqual({
      name: "candidateIdentity",
      status: "fail",
      code: "DEPLOYMENT_CANDIDATE_IDENTITY_MISMATCH",
    });
  });

  it("rejects acceptance evidence that omits the supply-chain gate", () => {
    const input = validInput();
    const acceptance = input.acceptance as { evidence: Array<{ name: string; status: string }> };
    acceptance.evidence = acceptance.evidence.filter(({ name }) => name !== "supplyChain");
    const report = new ReleaseCloseoutService(() => new Date("2026-08-25T00:11:00.000Z")).run(input);

    expect(report.ok).toBe(false);
    expect(report.checks).toContainEqual({
      name: "acceptanceEvidence",
      status: "fail",
      code: "RELEASE_ACCEPTANCE_EVIDENCE_INCOMPLETE",
    });
  });

  it("rejects a deployed web artifact that differs from accepted evidence", () => {
    const input = validInput();
    const deployment = input.deploymentVerification as {
      web: { expected: { manifestSha256: string }; checks: Array<{ name: string; status: string; code: string }> };
    };
    deployment.web.expected.manifestSha256 = "9".repeat(64);
    deployment.web.checks[0] = { name: "manifestSha256", status: "fail", code: "WEB_DEPLOYMENT_MANIFEST_MISMATCH" };
    const report = new ReleaseCloseoutService(() => new Date("2026-08-25T00:11:00.000Z")).run(input);

    expect(report.ok).toBe(false);
    expect(report.checks).toContainEqual({
      name: "webDeployment", status: "fail", code: "WEB_DEPLOYMENT_VERIFICATION_NOT_SUCCESSFUL",
    });
    expect(report.checks).toContainEqual({
      name: "webCandidateIdentity", status: "fail", code: "WEB_DEPLOYMENT_CANDIDATE_IDENTITY_MISMATCH",
    });
  });

  it("cryptographically binds the accepted web deployment manifest to the closeout", () => {
    const service = new ReleaseCloseoutService(() => new Date("2026-08-25T00:11:00.000Z"));
    const original = service.run(validInput());
    const changed = validInput();
    const acceptance = changed.acceptance as { evidence: Array<{ name: string; sha256: string }> };
    acceptance.evidence.find(({ name }) => name === "webDeployment")!.sha256 = "7".repeat(64);
    const deployment = changed.deploymentVerification as { web: { expected: { manifestSha256: string } } };
    deployment.web.expected.manifestSha256 = "7".repeat(64);
    const changedReport = service.run(changed);

    expect(changedReport.ok).toBe(true);
    expect(changedReport.webDeploymentManifestSha256).toBe("7".repeat(64));
    expect(changedReport.closeoutSha256).not.toBe(original.closeoutSha256);
  });

  it("rejects verification performed before acceptance or after the allowed window", () => {
    const before = validInput();
    (before.deploymentVerification as { completedAt: string }).completedAt = "2026-08-24T23:59:00.000Z";
    const beforeReport = new ReleaseCloseoutService().run(before);
    expect(beforeReport.checks).toContainEqual({
      name: "timelineOrder",
      status: "fail",
      code: "DEPLOYMENT_VERIFICATION_BEFORE_ACCEPTANCE",
    });

    const expired = validInput();
    (expired.deploymentVerification as { completedAt: string }).completedAt = "2026-08-26T01:00:00.000Z";
    const expiredReport = new ReleaseCloseoutService().run(expired);
    expect(expiredReport.checks).toContainEqual({
      name: "timelineDelay",
      status: "fail",
      code: "DEPLOYMENT_VERIFICATION_EXPIRED",
    });
  });

  it("fails closed for malformed reports and invalid closeout policy", () => {
    const malformed = validInput();
    malformed.acceptance = "invalid";
    const report = new ReleaseCloseoutService().run(malformed);
    expect(report.ok).toBe(false);
    expect(report.releaseId).toBeNull();

    expect(() => new ReleaseCloseoutService().run({ ...validInput(), maximumVerificationDelayHours: 0 }))
      .toThrowError(expect.objectContaining({ name: "RELEASE_CLOSEOUT_MAXIMUM_DELAY_INVALID" }));
    expect(() => new ReleaseCloseoutService().run({ ...validInput(), acceptanceSha256: "invalid" }))
      .toThrowError(expect.objectContaining({ name: "RELEASE_CLOSEOUT_ARTIFACT_SHA256_INVALID" }));
  });
});
