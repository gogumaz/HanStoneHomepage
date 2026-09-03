import { describe, expect, it } from "vitest";
import { calculateDeploymentVerificationEvidenceSha256 } from "./deployment-verification.service.js";
import { ReleaseCloseoutService, type ReleaseCloseoutInput } from "./release-closeout.service.js";

const commitSha = "a".repeat(40);
const imageDigest = `sha256:${"a".repeat(64)}`;
const webManifestSha256 = "4".repeat(64);
const stagingBundleSha256 = "6".repeat(64);
const webChecks = [
  "manifestSha256", "manifestSchema", "manifestCommit", "manifestCacheControl", "manifestContentType",
  "indexInventory", "assetInventory", "indexSha256", "indexCacheControl", "indexContentType",
  "assetSha256", "assetCacheControl", "assetContentType",
].map((name) => ({ name, status: "pass", code: "OK" }));

function validInput(): ReleaseCloseoutInput {
  const deploymentBase = {
    schemaVersion: 2,
    releaseId: "release-2026.08.25",
    ok: true,
    rollbackRecommended: false,
    startedAt: "2026-08-25T00:09:00.000Z",
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
    probes: [10, 20, 30].map((durationMs, index) => ({
      sample: index + 1,
      durationMs,
      liveness: true,
      readiness: true,
      identityMatched: true,
    })),
    latencyMs: { p50: 20, p95: 30, p99: 30, max: 30 },
    threshold: { maximumP95Ms: 500, latencyMet: true },
    web: {
      ok: true,
      checkedAt: "2026-08-25T00:10:00.000Z",
      expected: { commitSha, manifestSha256: webManifestSha256 },
      checks: webChecks.map((item) => ({ ...item })),
    },
    failures: [],
    targetUrl: "https://private.example.com",
  };
  return {
    acceptanceSha256: "1".repeat(64),
    deploymentVerificationSha256: "2".repeat(64),
    transportSecuritySha256: "7".repeat(64),
    mailOperationsSha256: "8".repeat(64),
    legalApprovalBindingSha256: "9".repeat(64),
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
      stagingEvidenceBundle: {
        status: "pass",
        sha256: stagingBundleSha256,
        checks: [{ name: "identity", status: "pass", code: "OK" }],
      },
      privateDetail: "do-not-copy",
    },
    deploymentVerification: {
      ...deploymentBase,
      evidenceSha256: calculateDeploymentVerificationEvidenceSha256(deploymentBase),
    },
    transportSecurity: {
      ok: true,
      schemaVersion: 3,
      releaseId: "release-2026.08.25",
      commitSha,
      preflightCheckedAt: "2026-08-25T00:00:00.000Z",
      deploymentVerifiedAt: "2026-08-25T00:10:00.000Z",
      checks: [
        "productionEnvironment", "apiHttps", "webHttps", "apiTlsCertificate", "webTlsCertificate",
        "publicAppHttps", "corsHttps", "oauthHttps", "databaseTls", "redisTls", "objectStorageHttps",
        "cdnHttps", "smtpTls", "preflight", "runtimeConnections", "deploymentVerification",
        "candidateIdentity", "evidenceTimestamps",
      ].map((name) => ({ name, status: "pass", code: "OK" })),
      privateHost: "private.example.com",
    },
    mailOperations: {
      ok: true,
      schemaVersion: 2,
      releaseId: "release-2026.08.25",
      commitSha,
      preflightCheckedAt: "2026-08-25T00:00:00.000Z",
      checks: [
        "preflight", "candidateCommit", "smtpCheck", "smtpDetail", "preflightTimestamp",
        "preflightFreshness", "bounceWebhook", "providerEventCorrelation", "bounceAuditLog",
      ].map((name) => ({ name, status: "pass", code: "OK" })),
      artifacts: { preflightSha256: "f".repeat(64) },
    },
    legalApprovalBinding: {
      ok: true,
      schemaVersion: 2,
      releaseId: "release-2026.08.25",
      commitSha,
      policyVersion: "guardian-link-v1",
      artifacts: { preflightSha256: "f".repeat(64) },
      checks: [
        "approvalEvidence", "policyVersion", "candidateCommit", "approvalTimestamp",
        "documentSha256", "generatedTimestamp", "preflight",
      ].map((name) => ({ name, status: "pass", code: "OK" })),
    },
  };
}

function refreshDeploymentEvidence(input: ReleaseCloseoutInput): void {
  const deployment = input.deploymentVerification as Record<string, unknown>;
  deployment.evidenceSha256 = calculateDeploymentVerificationEvidenceSha256(deployment);
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
      stagingEvidenceBundleSha256: stagingBundleSha256,
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

  it("rejects a missing or failed staging evidence bundle", () => {
    const input = validInput();
    const acceptance = input.acceptance as { stagingEvidenceBundle: { status: string } };
    acceptance.stagingEvidenceBundle.status = "fail";
    const report = new ReleaseCloseoutService(() => new Date("2026-08-25T00:11:00.000Z")).run(input);

    expect(report.checks).toContainEqual({
      name: "stagingEvidenceBundle",
      status: "fail",
      code: "RELEASE_ACCEPTANCE_STAGING_BUNDLE_INVALID",
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

  it("rejects missing or candidate-mismatched transport security evidence", () => {
    const input = validInput();
    (input.transportSecurity as { commitSha: string }).commitSha = "b".repeat(40);
    const report = new ReleaseCloseoutService(() => new Date("2026-08-25T00:11:00.000Z")).run(input);

    expect(report.ok).toBe(false);
    expect(report.checks).toContainEqual({
      name: "transportSecurity", status: "fail", code: "TRANSPORT_SECURITY_EVIDENCE_INVALID",
    });
  });

  it("cryptographically binds transport security evidence to the closeout", () => {
    const service = new ReleaseCloseoutService(() => new Date("2026-08-25T00:11:00.000Z"));
    const original = service.run(validInput());
    const changed = validInput();
    changed.transportSecuritySha256 = "8".repeat(64);
    const changedReport = service.run(changed);

    expect(changedReport.ok).toBe(true);
    expect(changedReport.artifacts.transportSecuritySha256).toBe("8".repeat(64));
    expect(changedReport.closeoutSha256).not.toBe(original.closeoutSha256);
  });

  it("rejects mail evidence that exposes the provider event ID", () => {
    const input = validInput();
    (input.mailOperations as Record<string, unknown>).providerEventId = "provider-event-private";
    const report = new ReleaseCloseoutService(() => new Date("2026-08-25T00:11:00.000Z")).run(input);

    expect(report.checks).toContainEqual({
      name: "mailOperations", status: "fail", code: "MAIL_OPERATIONS_EVIDENCE_INVALID",
    });
  });

  it("cryptographically binds mail operations evidence to the closeout", () => {
    const service = new ReleaseCloseoutService(() => new Date("2026-08-25T00:11:00.000Z"));
    const original = service.run(validInput());
    const changed = validInput();
    changed.mailOperationsSha256 = "9".repeat(64);
    const changedReport = service.run(changed);

    expect(changedReport.ok).toBe(true);
    expect(changedReport.closeoutSha256).not.toBe(original.closeoutSha256);
  });

  it("rejects legal approval binding from a different preflight", () => {
    const input = validInput();
    (input.legalApprovalBinding as { artifacts: { preflightSha256: string } }).artifacts.preflightSha256 = "0".repeat(64);
    const report = new ReleaseCloseoutService(() => new Date("2026-08-25T00:11:00.000Z")).run(input);

    expect(report.checks).toContainEqual({
      name: "legalApprovalBinding", status: "fail", code: "LEGAL_APPROVAL_BINDING_EVIDENCE_INVALID",
    });
  });

  it("cryptographically binds legal approval evidence to the closeout", () => {
    const service = new ReleaseCloseoutService(() => new Date("2026-08-25T00:11:00.000Z"));
    const original = service.run(validInput());
    const changed = validInput();
    changed.legalApprovalBindingSha256 = "0".repeat(64);
    expect(service.run(changed).closeoutSha256).not.toBe(original.closeoutSha256);
  });

  it("cryptographically binds the accepted web deployment manifest to the closeout", () => {
    const service = new ReleaseCloseoutService(() => new Date("2026-08-25T00:11:00.000Z"));
    const original = service.run(validInput());
    const changed = validInput();
    const acceptance = changed.acceptance as { evidence: Array<{ name: string; sha256: string }> };
    acceptance.evidence.find(({ name }) => name === "webDeployment")!.sha256 = "7".repeat(64);
    const deployment = changed.deploymentVerification as { web: { expected: { manifestSha256: string } } };
    deployment.web.expected.manifestSha256 = "7".repeat(64);
    refreshDeploymentEvidence(changed);
    const changedReport = service.run(changed);

    expect(changedReport.ok).toBe(true);
    expect(changedReport.webDeploymentManifestSha256).toBe("7".repeat(64));
    expect(changedReport.closeoutSha256).not.toBe(original.closeoutSha256);
  });

  it("cryptographically binds the staging evidence bundle to the closeout", () => {
    const service = new ReleaseCloseoutService(() => new Date("2026-08-25T00:11:00.000Z"));
    const original = service.run(validInput());
    const changed = validInput();
    (changed.acceptance as { stagingEvidenceBundle: { sha256: string } }).stagingEvidenceBundle.sha256 = "7".repeat(64);
    const changedReport = service.run(changed);

    expect(changedReport.ok).toBe(true);
    expect(changedReport.stagingEvidenceBundleSha256).toBe("7".repeat(64));
    expect(changedReport.closeoutSha256).not.toBe(original.closeoutSha256);
  });

  it("cryptographically binds the complete verification timeline to the closeout", () => {
    const service = new ReleaseCloseoutService(() => new Date("2026-08-25T00:11:00.000Z"));
    const original = service.run(validInput());
    const changed = validInput();
    const deployment = changed.deploymentVerification as { completedAt: string; web: { checkedAt: string } };
    deployment.completedAt = "2026-08-25T00:09:00.000Z";
    deployment.web.checkedAt = "2026-08-25T00:09:00.000Z";
    (changed.transportSecurity as { deploymentVerifiedAt: string }).deploymentVerifiedAt =
      "2026-08-25T00:09:00.000Z";
    refreshDeploymentEvidence(changed);
    const changedReport = service.run(changed);

    expect(changedReport.ok).toBe(true);
    expect(changedReport.timeline.verificationDelayMinutes).toBe(9);
    expect(changedReport.closeoutSha256).not.toBe(original.closeoutSha256);
  });

  it("rejects a deployment report whose API completion and web verification times diverge", () => {
    const input = validInput();
    const deployment = input.deploymentVerification as { web: { checkedAt: string } };
    deployment.web.checkedAt = "2026-08-25T00:09:30.000Z";
    refreshDeploymentEvidence(input);

    const report = new ReleaseCloseoutService(() => new Date("2026-08-25T00:11:00.000Z")).run(input);

    expect(report.ok).toBe(false);
    expect(report.checks).toContainEqual({
      name: "deploymentVerification", status: "fail", code: "DEPLOYMENT_VERIFICATION_NOT_SUCCESSFUL",
    });
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
