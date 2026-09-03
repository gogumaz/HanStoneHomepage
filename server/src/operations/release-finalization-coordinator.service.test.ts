import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { calculateDeploymentVerificationEvidenceSha256 } from "./deployment-verification.service.js";
import {
  PRODUCTION_DEPLOYMENT_CONFIRMATION,
  ReleaseFinalizationCoordinatorService,
  type FinalizationEvidenceRun,
  type ReleaseFinalizationCoordinatorInput,
} from "./release-finalization-coordinator.service.js";
import { REQUIRED_PRODUCTION_SECRETS } from "./release-readiness.service.js";

const commitSha = "a".repeat(40);
const imageDigest = `sha256:${"b".repeat(64)}`;
const imageReference = `ghcr.io/example/api@${imageDigest}`;
const webManifestSha256 = "c".repeat(64);
const stagingBundleSha256 = "9".repeat(64);
const acceptanceCheckedAt = "2026-08-31T00:00:00.000Z";
const acceptanceEvidenceNames = [
  "preflight", "recovery", "readOnlyLoad", "workerSoak", "webDeployment", "fieldValidation", "supplyChain",
] as const;
const acceptanceEvidenceChecks: Record<(typeof acceptanceEvidenceNames)[number], readonly string[]> = {
  preflight: [
    "commitSha", "report", "configuration", "recoveryPolicy", "database", "rateLimitStore",
    "objectStorage", "cdn", "hlsTranscoder", "malwareScanner", "smtp", "freshness",
  ],
  recovery: [
    "commitSha", "report", "migration", "criticalTables", "relationships", "rpo", "rto",
    "rpoObjective", "rtoObjective", "freshness",
  ],
  readOnlyLoad: ["commitSha", "report", "latency", "errorRate", "completion", "freshness"],
  workerSoak: [
    "commitSha", "report", "latency", "criticalSamples", "queueHealth", "metricsFreshness", "completion",
    "account_mail", "inquiry_notification", "video_scan", "hls_transcode", "object_deletion", "freshness",
  ],
  webDeployment: [
    "commitSha", "report", "schemaVersion", "fileInventory", "entrypoints", "fileHashes", "contentTypes",
    "cachePolicy", "totals", "freshness",
  ],
  fieldValidation: [
    "commitSha", "report", "schemaVersion", "projectInventory", "chromium", "field-firefox",
    "field-mobile-chrome", "field-mobile-safari", "totals", "freshness",
  ],
  supplyChain: [
    "commitSha", "report", "schemaVersion", "vulnerabilityPolicy", "artifactInventory", "webSbomHash",
    "webComponentInventory", "webCycloneDxVersion", "apiSbomHash", "apiComponentInventory",
    "apiCycloneDxVersion", "freshness",
  ],
};
const acceptanceEvidence = acceptanceEvidenceNames.map((name) => ({
  name,
  status: "pass" as const,
  sha256: name === "webDeployment" ? webManifestSha256 : "e".repeat(64),
  maximumAgeHours: 168,
  observedAt: acceptanceCheckedAt,
  ageHours: 0,
  checks: acceptanceEvidenceChecks[name].map((checkName) => ({
    name: checkName,
    status: "pass" as const,
    code: "OK" as const,
  })),
}));
const acceptanceManifestSha256 = createHash("sha256").update(JSON.stringify({
  releaseId: "release-2026.08.31",
  commitSha,
  imageReference,
  imageDigest,
  checkedAt: acceptanceCheckedAt,
  stagingEvidenceBundle: {
    status: "pass",
    sha256: stagingBundleSha256,
    maximumAgeHours: 168,
  },
  evidence: acceptanceEvidence.map(({ name, sha256, maximumAgeHours, status }) => ({
    name,
    sha256,
    maximumAgeHours,
    status,
  })),
}), "utf8").digest("hex");
const stagingBundleBase = {
  schemaVersion: 1,
  ok: true,
  releaseId: "release-2026.08.31",
  candidateCommitSha: commitSha,
  loadTestRunId: 101,
  workerSoakRunId: 102,
  checkedAt: "2026-08-31T00:00:00.000Z",
  maximumAgeHours: 168,
  checks: [
    "sourceInventory", "candidateIdentity", "readOnlyLoad", "workerSoak", "controlledLoad",
    "execution", "concurrentObservation", "executionTimeline", "freshness",
  ].map((name) => ({ name, status: "pass" as const, code: "OK" as const })),
  sources: ["readOnlyLoad", "workerSoak", "controlledLoad", "execution"].map((name) => ({
    name,
    sha256: name === "readOnlyLoad" || name === "workerSoak" ? "e".repeat(64) : "f".repeat(64),
    observedAt: "2026-08-31T00:00:00.000Z",
  })),
};
const stagingBundleReport = {
  ...stagingBundleBase,
  evidenceSha256: createHash("sha256").update(JSON.stringify(stagingBundleBase)).digest("hex"),
};
const artifactRetention = {
  artifactExpired: false,
  artifactCreatedAt: "2026-08-31T00:00:00.000Z",
  artifactExpiresAt: "2026-11-30T00:00:00.000Z",
} as const;

function acceptanceRun(): FinalizationEvidenceRun {
  const passed = (names: readonly string[]) => names.map((name) => ({ name, status: "pass", code: "OK" }));
  const webFiles = ["index.html", "app.html", "payment/success.html", "payment/fail.html"].map((path) => ({
    path,
    sha256: "a".repeat(64),
    bytes: 100,
    contentType: "text/html; charset=utf-8",
    cacheControl: "public,max-age=0,must-revalidate",
  }));
  const evidenceReports = {
    "production-preflight.json": {
      ok: true,
      commitSha,
      checkedAt: acceptanceCheckedAt,
      checks: passed([
        "configuration", "recoveryPolicy", "database", "rateLimitStore", "objectStorage", "cdn",
        "hlsTranscoder", "malwareScanner", "smtp",
      ]),
    },
    "recovery-drill.json": {
      ok: true,
      commitSha,
      completedAt: acceptanceCheckedAt,
      checks: passed(["migration", "criticalTables", "relationships", "rpo", "rto"]),
      objectives: { rpoMet: true, rtoMet: true },
    },
    "staging-read-only-load-report.json": {
      ok: true,
      commitSha,
      completedAt: acceptanceCheckedAt,
      thresholds: { latencyMet: true, errorRateMet: true },
      requests: { planned: 100, completed: 100 },
    },
    "staging-worker-soak-report.json": {
      ok: true,
      commitSha,
      completedAt: acceptanceCheckedAt,
      thresholds: {
        latencyMet: true,
        criticalSamplesMet: true,
        queueHealthMet: true,
        metricsFreshnessMet: true,
      },
      samples: { planned: 2, completed: 2, failed: 0 },
      queues: ["account_mail", "inquiry_notification", "video_scan", "hls_transcode", "object_deletion"]
        .map((name) => ({ name, healthy: true })),
    },
    "web-deployment-manifest.json": {
      schemaVersion: 1,
      ok: true,
      commitSha,
      generatedAt: acceptanceCheckedAt,
      files: webFiles,
      totals: { files: webFiles.length, bytes: webFiles.reduce((sum, file) => sum + file.bytes, 0) },
    },
    "field-validation-report.json": {
      schemaVersion: 1,
      ok: true,
      commitSha,
      completedAt: acceptanceCheckedAt,
      projects: ["chromium", "field-firefox", "field-mobile-chrome", "field-mobile-safari"]
        .map((name) => ({ name, status: "pass", passed: 1, failed: 0, flaky: 0 })),
      totals: { passed: 4, failed: 0, flaky: 0 },
    },
    "manifest.json": {
      schemaVersion: 1,
      ok: true,
      commitSha,
      generatedAt: acceptanceCheckedAt,
      vulnerabilityPolicy: "npm-audit-production-high-critical-zero",
      artifacts: ["web", "api"].map((name) => ({
        name,
        sha256: "b".repeat(64),
        componentCount: 1,
        specVersion: "1.6",
      })),
    },
  };
  return {
    runId: 10,
    artifactPresent: true,
    ...artifactRetention,
    reportSha256: "1".repeat(64),
    report: {
      ok: true,
      releaseId: "release-2026.08.31",
      commitSha,
      imageReference,
      imageDigest,
      manifestSha256: acceptanceManifestSha256,
      checkedAt: acceptanceCheckedAt,
      evidence: acceptanceEvidence.map((entry) => ({
        ...entry,
        checks: entry.checks.map((detailCheck) => ({ ...detailCheck })),
      })),
      stagingEvidenceBundle: {
        status: "pass",
        observedAt: acceptanceCheckedAt,
        ageHours: 0,
        sha256: stagingBundleSha256,
        maximumAgeHours: 168,
        checks: ["identity", "checks", "sources", "loadSource", "workerSource", "selfDigest", "freshness"]
          .map((name) => ({ name, status: "pass", code: "OK" })),
      },
    },
    relatedReports: {
      "staging-evidence-bundle.json": structuredClone(stagingBundleReport),
      ...evidenceReports,
    },
    relatedSha256: {
      "production-preflight.json": "e".repeat(64),
      "recovery-drill.json": "e".repeat(64),
      "staging-read-only-load-report.json": "e".repeat(64),
      "staging-worker-soak-report.json": "e".repeat(64),
      "staging-worker-controlled-load-report.json": "f".repeat(64),
      "staging-worker-soak-execution.json": "f".repeat(64),
      "staging-evidence-bundle.json": stagingBundleSha256,
      "web-deployment-manifest.json": webManifestSha256,
      "field-validation-report.json": "e".repeat(64),
      "manifest.json": "e".repeat(64),
    },
  };
}

function refreshAcceptanceManifest(run: FinalizationEvidenceRun): void {
  const report = run.report as {
    releaseId: string;
    commitSha: string;
    imageReference: string;
    imageDigest: string;
    checkedAt: string;
    manifestSha256: string;
    stagingEvidenceBundle: { status: string; sha256: string; maximumAgeHours: number };
    evidence: Array<{ name: string; sha256: string; maximumAgeHours: number; status: string }>;
  };
  report.manifestSha256 = createHash("sha256").update(JSON.stringify({
    releaseId: report.releaseId,
    commitSha: report.commitSha,
    imageReference: report.imageReference,
    imageDigest: report.imageDigest,
    checkedAt: report.checkedAt,
    stagingEvidenceBundle: {
      status: report.stagingEvidenceBundle.status,
      sha256: report.stagingEvidenceBundle.sha256,
      maximumAgeHours: report.stagingEvidenceBundle.maximumAgeHours,
    },
    evidence: report.evidence.map(({ name, sha256, maximumAgeHours, status }) => ({
      name, sha256, maximumAgeHours, status,
    })),
  }), "utf8").digest("hex");
}

function verificationRun(): FinalizationEvidenceRun {
  const preflightSha256 = "7".repeat(64);
  const passed = (names: readonly string[]) => names.map((name) => ({ name, status: "pass", code: "OK" }));
  const transportChecks = passed([
    "productionEnvironment", "apiHttps", "webHttps", "apiTlsCertificate", "webTlsCertificate",
    "publicAppHttps", "corsHttps", "oauthHttps", "databaseTls", "redisTls", "objectStorageHttps",
    "cdnHttps", "smtpTls", "preflight", "runtimeConnections", "deploymentVerification",
    "candidateIdentity", "evidenceTimestamps",
  ]);
  const transportBase = {
    schemaVersion: 3,
    releaseId: "release-2026.08.31",
    commitSha,
    checkedAt: "2026-08-31T00:10:10.000Z",
    preflightCheckedAt: "2026-08-31T00:05:00.000Z",
    deploymentVerifiedAt: "2026-08-31T00:10:00.000Z",
    activeTransports: {
      oauthProviders: ["naver", "kakao", "google"],
      objectStorage: "provider-default-https",
      cdn: "https",
      smtp: "starttls",
    },
    minimumCertificateValidityDays: 14,
    tlsEndpoints: {
      api: { originSha256: "a".repeat(64), protocol: "TLSv1.3", certificateSha256: "b".repeat(64),
        validFrom: "2026-08-01T00:00:00.000Z", validTo: "2026-12-01T00:00:00.000Z" },
      web: { originSha256: "c".repeat(64), protocol: "TLSv1.3", certificateSha256: "d".repeat(64),
        validFrom: "2026-08-01T00:00:00.000Z", validTo: "2026-12-01T00:00:00.000Z" },
    },
    artifacts: {
      environmentSha256: "6".repeat(64),
      preflightSha256,
      deploymentVerificationSha256: "2".repeat(64),
    },
    checks: transportChecks,
  };
  const transport = {
    ok: true,
    ...transportBase,
    evidenceSha256: createHash("sha256").update(JSON.stringify({
      ...transportBase,
      checks: transportChecks.map(({ name, status }) => ({ name, status })),
    })).digest("hex"),
  };
  const mailChecks = passed([
    "preflight", "candidateCommit", "smtpCheck", "smtpDetail", "preflightTimestamp",
    "preflightFreshness", "bounceWebhook", "providerEventCorrelation", "bounceAuditLog",
  ]);
  const mailBase = {
    schemaVersion: 2,
    releaseId: "release-2026.08.31",
    commitSha,
    checkedAt: "2026-08-31T00:10:20.000Z",
    preflightCheckedAt: "2026-08-31T00:05:00.000Z",
    providerEventIdSha256: "8".repeat(64),
    auditLogId: "audit-log-1",
    dnsEvidence: {
      dmarcPolicy: "reject",
      domainSha256: "9".repeat(64),
      dkimSelectorSha256: "a".repeat(64),
      dnsRecordsSha256: "b".repeat(64),
    },
    artifacts: { preflightSha256, bounceWebhookResponseSha256: "c".repeat(64) },
    checks: mailChecks,
  };
  const mail = {
    ok: true,
    ...mailBase,
    evidenceSha256: createHash("sha256").update(JSON.stringify({
      ...mailBase,
      checks: mailChecks.map(({ name, status }) => ({ name, status })),
    })).digest("hex"),
  };
  const legalChecks = passed([
    "approvalEvidence", "policyVersion", "candidateCommit", "approvalTimestamp",
    "documentSha256", "generatedTimestamp", "preflight",
  ]);
  const legalBase = {
    schemaVersion: 2,
    releaseId: "release-2026.08.31",
    commitSha,
    checkedAt: "2026-08-31T00:10:30.000Z",
    policyVersion: "guardian-link-v1",
    approvedAt: "2026-08-30T00:00:00.000Z",
    documentSha256: "d".repeat(64),
    artifacts: {
      approvalEvidenceSha256: "e".repeat(64),
      preflightSha256,
      environmentSha256: "6".repeat(64),
    },
    checks: legalChecks,
  };
  const legal = {
    ok: true,
    ...legalBase,
    evidenceSha256: createHash("sha256").update(JSON.stringify({
      ...legalBase,
      checks: legalChecks.map(({ name, status }) => ({ name, status })),
    })).digest("hex"),
  };
  const reportBase = {
    schemaVersion: 2,
    releaseId: "release-2026.08.31",
    ok: true,
    rollbackRecommended: false,
    startedAt: "2026-08-31T00:09:00.000Z",
    completedAt: "2026-08-31T00:10:00.000Z",
    expected: { commitSha, imageDigest },
    samples: {
      planned: 3,
      completed: 3,
      failed: 0,
      livenessFailures: 0,
      readinessFailures: 0,
      identityMismatches: 0,
    },
    probes: [100, 100, 120].map((durationMs, index) => ({
      sample: index + 1,
      durationMs,
      liveness: true,
      readiness: true,
      identityMatched: true,
    })),
    latencyMs: { p50: 100, p95: 120, p99: 120, max: 120 },
    threshold: { maximumP95Ms: 1_000, latencyMet: true },
    failures: [],
    web: {
      ok: true,
      checkedAt: "2026-08-31T00:10:00.000Z",
      expected: { commitSha, manifestSha256: webManifestSha256 },
      checks: [
        "manifestSha256", "manifestSchema", "manifestCommit", "manifestCacheControl", "manifestContentType",
        "indexInventory", "assetInventory", "indexSha256", "indexCacheControl", "indexContentType",
        "assetSha256", "assetCacheControl", "assetContentType",
      ].map((name) => ({ name, status: "pass", code: "OK" })),
    },
  };
  return {
    runId: 20,
    artifactPresent: true,
    ...artifactRetention,
    artifactCreatedAt: "2026-08-31T00:11:00.000Z",
    reportSha256: "2".repeat(64),
    report: {
      ...reportBase,
      evidenceSha256: calculateDeploymentVerificationEvidenceSha256(reportBase),
    },
    relatedReports: {
      "transport-security-evidence.json": transport,
      "mail-operations-evidence.json": mail,
      "legal-approval-binding.json": legal,
    },
    relatedSha256: {
      "transport-security-evidence.json": "3".repeat(64),
      "mail-operations-evidence.json": "4".repeat(64),
      "legal-approval-binding.json": "5".repeat(64),
    },
  };
}

function closeoutRun(
  acceptedManifestSha256 = acceptanceManifestSha256,
  verifiedAt = "2026-08-31T00:10:00.000Z",
): FinalizationEvidenceRun {
  const relatedSha256 = {
    "release-acceptance.json": "1".repeat(64),
    "production-deployment-verification.json": "2".repeat(64),
    "transport-security-evidence.json": "3".repeat(64),
    "mail-operations-evidence.json": "4".repeat(64),
    "legal-approval-binding.json": "5".repeat(64),
  };
  const artifacts = {
    acceptanceSha256: relatedSha256["release-acceptance.json"],
    deploymentVerificationSha256: relatedSha256["production-deployment-verification.json"],
    transportSecuritySha256: relatedSha256["transport-security-evidence.json"],
    mailOperationsSha256: relatedSha256["mail-operations-evidence.json"],
    legalApprovalBindingSha256: relatedSha256["legal-approval-binding.json"],
  };
  const checks = [
    "acceptance", "acceptanceEvidence", "stagingEvidenceBundle", "acceptanceManifest",
    "acceptanceImageReference", "deploymentVerification", "rollbackDecision", "deploymentSamples",
    "deploymentLatency", "deploymentHealth", "candidateIdentity", "webDeployment", "webCandidateIdentity",
    "transportSecurity", "mailOperations", "legalApprovalBinding", "timelineOrder", "timelineDelay", "timelineFuture",
  ].map((name) => ({ name, status: "pass", code: "OK" }));
  const acceptedAt = "2026-08-31T00:00:00.000Z";
  const timeline = {
    acceptedAt,
    verifiedAt,
    verificationDelayMinutes: Math.round(((Date.parse(verifiedAt) - Date.parse(acceptedAt)) / 60_000) * 100) / 100,
    maximumVerificationDelayHours: 24,
  };
  const report = {
    ok: true,
    releaseId: "release-2026.08.31",
    commitSha,
    imageReference,
    imageDigest,
    webDeploymentManifestSha256: webManifestSha256,
    stagingEvidenceBundleSha256: stagingBundleSha256,
    acceptanceManifestSha256: acceptedManifestSha256,
    closedAt: "2026-08-31T00:11:00.000Z",
    artifacts,
    timeline,
    checks,
  };
  const closeoutSource = JSON.stringify({
    releaseId: report.releaseId,
    commitSha: report.commitSha,
    imageDigest: report.imageDigest,
    imageReference: report.imageReference,
    webDeploymentManifestSha256: report.webDeploymentManifestSha256,
    stagingEvidenceBundleSha256: report.stagingEvidenceBundleSha256,
    acceptanceManifestSha256: report.acceptanceManifestSha256,
    closedAt: report.closedAt,
    artifacts,
    maximumVerificationDelayHours: report.timeline.maximumVerificationDelayHours,
    timeline,
    checks: checks.map(({ name, status }) => ({ name, status })),
  });
  return {
    runId: 30,
    artifactPresent: true,
    ...artifactRetention,
    artifactCreatedAt: "2026-08-31T00:12:00.000Z",
    report: {
      ...report,
      closeoutSha256: createHash("sha256").update(closeoutSource, "utf8").digest("hex"),
    },
    relatedSha256,
  };
}

function validInput(): ReleaseFinalizationCoordinatorInput {
  return {
    repository: "example/baduk-history",
    actorLogin: "gogumaz",
    defaultBranch: "main",
    localCommitSha: commitSha,
    remoteDefaultCommitSha: commitSha,
    dirtyFileCount: 0,
    releaseId: "release-2026.08.31",
    imageReference,
    registryHost: "ghcr.io",
    productionSecretNames: [...REQUIRED_PRODUCTION_SECRETS],
    deploymentConfirmation: PRODUCTION_DEPLOYMENT_CONFIRMATION,
    maximumVerificationDelayHours: 24,
    acceptance: acceptanceRun(),
    acceptanceActiveRunId: null,
    verification: null,
    verificationActiveRunId: null,
    closeout: null,
    closeoutActiveRunId: null,
    applyRequested: false,
    confirmation: null,
  };
}

describe("ReleaseFinalizationCoordinatorService", () => {
  it("plans production verification from matching acceptance evidence", () => {
    const report = new ReleaseFinalizationCoordinatorService().plan(validInput());
    expect(report.ok).toBe(true);
    expect(report.stage).toBe("verification-ready");
    expect(report.action).toEqual({
      kind: "verifyDeployment",
      workflow: "production-deployment-verification.yml",
      webManifestSha256,
    });
  });

  it("requires deployment confirmation and production verification secrets", () => {
    const report = new ReleaseFinalizationCoordinatorService().plan({
      ...validInput(), productionSecretNames: [], deploymentConfirmation: null,
    });
    expect(report.stage).toBe("blocked");
    expect(report.checks.filter(({ code }) => code === "RELEASE_FINALIZATION_PRODUCTION_SECRET_MISSING"))
      .toHaveLength(9);
    expect(report.checks).toContainEqual({
      name: "deploymentConfirmation", status: "fail", code: "RELEASE_FINALIZATION_DEPLOYMENT_CONFIRMATION_REQUIRED",
    });
  });

  it("plans closeout only after matching successful deployment verification", () => {
    const report = new ReleaseFinalizationCoordinatorService().plan({
      ...validInput(), deploymentConfirmation: null, productionSecretNames: [], verification: verificationRun(),
    });
    expect(report.ok).toBe(true);
    expect(report.stage).toBe("closeout-ready");
    expect(report.action).toEqual({ kind: "closeout", workflow: "release-closeout.yml" });
    expect(report.acceptanceRunId).toBe(10);
    expect(report.verificationRunId).toBe(20);
  });

  it("recognizes a matching final closeout and prevents duplicate dispatch", () => {
    const report = new ReleaseFinalizationCoordinatorService().plan({
      ...validInput(), verification: verificationRun(), closeout: closeoutRun(),
    });
    expect(report.stage).toBe("complete");
    expect(report.closeoutRunId).toBe(30);
    expect(report.action).toBeNull();
    expect(report.applyAuthorized).toBe(false);
  });

  it("fails closed on mismatched or malformed evidence", () => {
    const acceptance = acceptanceRun();
    (acceptance.report as { commitSha: string }).commitSha = "1".repeat(40);
    const verification = verificationRun();
    (verification.report as { rollbackRecommended: boolean }).rollbackRecommended = true;
    const report = new ReleaseFinalizationCoordinatorService().plan({ ...validInput(), acceptance, verification });
    expect(report.stage).toBe("blocked");
    expect(report.checks).toContainEqual({
      name: "evidence:acceptance", status: "fail", code: "RELEASE_FINALIZATION_ACCEPTANCE_INVALID",
    });
    expect(report.checks).toContainEqual({
      name: "evidence:verificationIntegrity", status: "fail", code: "RELEASE_FINALIZATION_VERIFICATION_INVALID",
    });
  });

  it("rejects an acceptance report whose manifest digest cannot be reproduced", () => {
    const acceptance = acceptanceRun();
    const evidence = (acceptance.report as { evidence: Array<{ sha256: string }> }).evidence;
    evidence[0]!.sha256 = "0".repeat(64);
    const report = new ReleaseFinalizationCoordinatorService().plan({ ...validInput(), acceptance });

    expect(report.stage).toBe("blocked");
    expect(report.checks).toContainEqual({
      name: "evidence:acceptance", status: "fail", code: "RELEASE_FINALIZATION_ACCEPTANCE_INVALID",
    });
  });

  it("rejects an acceptance whose archived staging bundle fails self-verification", () => {
    const acceptance = acceptanceRun();
    const bundle = acceptance.relatedReports?.["staging-evidence-bundle.json"] as {
      checks: Array<{ status: string }>;
    };
    bundle.checks[0]!.status = "fail";
    const report = new ReleaseFinalizationCoordinatorService().plan({ ...validInput(), acceptance });

    expect(report.stage).toBe("blocked");
    expect(report.checks).toContainEqual({
      name: "evidence:acceptance", status: "fail", code: "RELEASE_FINALIZATION_ACCEPTANCE_INVALID",
    });
  });

  it("rejects an acceptance whose recorded evidence hash differs from the archived source file", () => {
    const acceptance = acceptanceRun();
    acceptance.relatedSha256!["recovery-drill.json"] = "0".repeat(64);
    const report = new ReleaseFinalizationCoordinatorService().plan({ ...validInput(), acceptance });

    expect(report.stage).toBe("blocked");
    expect(report.checks).toContainEqual({
      name: "evidence:acceptance", status: "fail", code: "RELEASE_FINALIZATION_ACCEPTANCE_INVALID",
    });
  });

  it("rejects altered acceptance detail checks that are outside the manifest digest", () => {
    const acceptance = acceptanceRun();
    const evidence = (acceptance.report as {
      evidence: Array<{ checks: Array<{ status: string }> }>;
    }).evidence;
    evidence[0]!.checks[0]!.status = "fail";
    const report = new ReleaseFinalizationCoordinatorService().plan({ ...validInput(), acceptance });

    expect(report.stage).toBe("blocked");
    expect(report.checks).toContainEqual({
      name: "evidence:acceptance", status: "fail", code: "RELEASE_FINALIZATION_ACCEPTANCE_INVALID",
    });
  });

  it("rejects self-consistent acceptance metadata when an archived source no longer passes", () => {
    const acceptance = acceptanceRun();
    const recovery = acceptance.relatedReports?.["recovery-drill.json"] as {
      objectives: { rpoMet: boolean };
    };
    recovery.objectives.rpoMet = false;
    acceptance.relatedSha256!["recovery-drill.json"] = "0".repeat(64);
    const report = acceptance.report as {
      evidence: Array<{ name: string; sha256: string }>;
    };
    report.evidence.find(({ name }) => name === "recovery")!.sha256 = "0".repeat(64);
    refreshAcceptanceManifest(acceptance);

    const result = new ReleaseFinalizationCoordinatorService().plan({ ...validInput(), acceptance });

    expect(result.stage).toBe("blocked");
    expect(result.checks).toContainEqual({
      name: "evidence:acceptance", status: "fail", code: "RELEASE_FINALIZATION_ACCEPTANCE_INVALID",
    });
  });

  it("rejects staging summary timestamps that cannot be reproduced from the archived bundle", () => {
    const acceptance = acceptanceRun();
    const staging = (acceptance.report as {
      stagingEvidenceBundle: { observedAt: string; ageHours: number };
    }).stagingEvidenceBundle;
    staging.observedAt = "2026-08-30T23:00:00.000Z";
    staging.ageHours = 1;

    const result = new ReleaseFinalizationCoordinatorService().plan({ ...validInput(), acceptance });

    expect(result.stage).toBe("blocked");
    expect(result.checks).toContainEqual({
      name: "evidence:acceptance", status: "fail", code: "RELEASE_FINALIZATION_ACCEPTANCE_INVALID",
    });
  });

  it("rejects deployment verification without complete transport, mail, and legal evidence", () => {
    const verification = verificationRun();
    delete verification.relatedReports?.["legal-approval-binding.json"];
    const report = new ReleaseFinalizationCoordinatorService().plan({ ...validInput(), verification });

    expect(report.stage).toBe("blocked");
    expect(report.checks).toContainEqual({
      name: "evidence:verificationIntegrity", status: "fail", code: "RELEASE_FINALIZATION_VERIFICATION_INVALID",
    });
  });

  it("rejects auxiliary evidence whose internal digest cannot be reproduced", () => {
    const verification = verificationRun();
    const mail = verification.relatedReports?.["mail-operations-evidence.json"] as {
      dnsEvidence: { dmarcPolicy: string };
    };
    mail.dnsEvidence.dmarcPolicy = "quarantine";
    const report = new ReleaseFinalizationCoordinatorService().plan({ ...validInput(), verification });

    expect(report.stage).toBe("blocked");
    expect(report.checks).toContainEqual({
      name: "evidence:verificationIntegrity", status: "fail", code: "RELEASE_FINALIZATION_VERIFICATION_INVALID",
    });
  });

  it("rejects self-consistent auxiliary evidence bound to a different deployment report", () => {
    const verification = verificationRun();
    const transport = verification.relatedReports?.["transport-security-evidence.json"] as Record<string, unknown>;
    (transport.artifacts as { deploymentVerificationSha256: string }).deploymentVerificationSha256 = "0".repeat(64);
    const { ok: _ok, evidenceSha256: _evidenceSha256, ...base } = transport;
    const checks = transport.checks as Array<{ name: string; status: string }>;
    transport.evidenceSha256 = createHash("sha256").update(JSON.stringify({
      ...base,
      checks: checks.map(({ name, status }) => ({ name, status })),
    })).digest("hex");
    const report = new ReleaseFinalizationCoordinatorService().plan({ ...validInput(), verification });

    expect(report.stage).toBe("blocked");
    expect(report.checks).toContainEqual({
      name: "evidence:verificationIntegrity", status: "fail", code: "RELEASE_FINALIZATION_VERIFICATION_INVALID",
    });
  });

  it("rejects self-consistent auxiliary evidence bound to another release ID", () => {
    const verification = verificationRun();
    const transport = verification.relatedReports?.["transport-security-evidence.json"] as Record<string, unknown>;
    transport.releaseId = "release-other";
    const { ok: _ok, evidenceSha256: _evidenceSha256, ...base } = transport;
    const checks = transport.checks as Array<{ name: string; status: string }>;
    transport.evidenceSha256 = createHash("sha256").update(JSON.stringify({
      ...base,
      checks: checks.map(({ name, status }) => ({ name, status })),
    })).digest("hex");

    const report = new ReleaseFinalizationCoordinatorService().plan({ ...validInput(), verification });

    expect(report.stage).toBe("blocked");
    expect(report.checks).toContainEqual({
      name: "evidence:verificationIntegrity", status: "fail", code: "RELEASE_FINALIZATION_VERIFICATION_INVALID",
    });
  });

  it("rejects deployment verification with incomplete probe samples", () => {
    const verification = verificationRun();
    (verification.report as { samples: { completed: number } }).samples.completed = 2;
    const report = new ReleaseFinalizationCoordinatorService().plan({ ...validInput(), verification });

    expect(report.stage).toBe("blocked");
    expect(report.checks).toContainEqual({
      name: "evidence:verificationIntegrity", status: "fail", code: "RELEASE_FINALIZATION_VERIFICATION_INVALID",
    });
  });

  it("rejects deployment latency aggregates that do not match the archived probes", () => {
    const verification = verificationRun();
    (verification.report as { latencyMs: { p50: number } }).latencyMs.p50 = 110;
    const report = new ReleaseFinalizationCoordinatorService().plan({ ...validInput(), verification });

    expect(report.stage).toBe("blocked");
    expect(report.checks).toContainEqual({
      name: "evidence:verificationIntegrity", status: "fail", code: "RELEASE_FINALIZATION_VERIFICATION_INVALID",
    });
  });

  it("rejects a self-consistent deployment report bound to another release ID", () => {
    const verification = verificationRun();
    const report = verification.report as Record<string, unknown>;
    report.releaseId = "release-other";
    report.evidenceSha256 = calculateDeploymentVerificationEvidenceSha256(report);

    const result = new ReleaseFinalizationCoordinatorService().plan({ ...validInput(), verification });

    expect(result.stage).toBe("blocked");
    expect(result.checks).toContainEqual({
      name: "evidence:verificationIntegrity", status: "fail", code: "RELEASE_FINALIZATION_VERIFICATION_INVALID",
    });
  });

  it("rejects acceptance or closeout records that lose the staging bundle binding", () => {
    const acceptance = acceptanceRun();
    (acceptance.report as { stagingEvidenceBundle: { status: string } }).stagingEvidenceBundle.status = "fail";
    const invalidAcceptance = new ReleaseFinalizationCoordinatorService().plan({ ...validInput(), acceptance });
    expect(invalidAcceptance.checks).toContainEqual({
      name: "evidence:acceptance", status: "fail", code: "RELEASE_FINALIZATION_ACCEPTANCE_INVALID",
    });

    const closeout = closeoutRun();
    (closeout.report as { stagingEvidenceBundleSha256: string }).stagingEvidenceBundleSha256 = "8".repeat(64);
    const invalidCloseout = new ReleaseFinalizationCoordinatorService().plan({
      ...validInput(), verification: verificationRun(), closeout,
    });
    expect(invalidCloseout.checks).toContainEqual({
      name: "evidence:closeoutIntegrity", status: "fail", code: "RELEASE_FINALIZATION_CLOSEOUT_INVALID",
    });
  });

  it("rejects a closeout whose recorded source hash differs from the archived file", () => {
    const closeout = closeoutRun();
    closeout.relatedSha256!["mail-operations-evidence.json"] = "6".repeat(64);
    const report = new ReleaseFinalizationCoordinatorService().plan({
      ...validInput(), verification: verificationRun(), closeout,
    });

    expect(report.stage).toBe("blocked");
    expect(report.checks).toContainEqual({
      name: "evidence:closeoutIntegrity", status: "fail", code: "RELEASE_FINALIZATION_CLOSEOUT_INVALID",
    });
  });

  it("rejects a closeout whose archived core reports differ from the selected successful runs", () => {
    const acceptance = acceptanceRun();
    acceptance.reportSha256 = "6".repeat(64);
    const acceptanceMismatch = new ReleaseFinalizationCoordinatorService().plan({
      ...validInput(), acceptance, verification: verificationRun(), closeout: closeoutRun(),
    });
    expect(acceptanceMismatch.checks).toContainEqual({
      name: "evidence:closeoutIntegrity", status: "fail", code: "RELEASE_FINALIZATION_CLOSEOUT_INVALID",
    });

    const verification = verificationRun();
    verification.reportSha256 = "7".repeat(64);
    const verificationMismatch = new ReleaseFinalizationCoordinatorService().plan({
      ...validInput(), verification, closeout: closeoutRun(),
    });
    expect(verificationMismatch.checks).toContainEqual({
      name: "evidence:closeoutIntegrity", status: "fail", code: "RELEASE_FINALIZATION_CLOSEOUT_INVALID",
    });
  });

  it("rejects closeout auxiliary evidence copied from a different verification run", () => {
    const verification = verificationRun();
    verification.relatedSha256!["mail-operations-evidence.json"] = "8".repeat(64);
    const report = new ReleaseFinalizationCoordinatorService().plan({
      ...validInput(), verification, closeout: closeoutRun(),
    });

    expect(report.stage).toBe("blocked");
    expect(report.checks).toContainEqual({
      name: "evidence:closeoutIntegrity", status: "fail", code: "RELEASE_FINALIZATION_CLOSEOUT_INVALID",
    });
  });

  it("rejects a self-consistent closeout timeline that differs from its source reports", () => {
    const closeout = closeoutRun(acceptanceManifestSha256, "2026-08-31T00:09:00.000Z");
    const report = new ReleaseFinalizationCoordinatorService().plan({
      ...validInput(), verification: verificationRun(), closeout,
    });

    expect(report.stage).toBe("blocked");
    expect(report.checks).toContainEqual({
      name: "evidence:closeoutIntegrity", status: "fail", code: "RELEASE_FINALIZATION_CLOSEOUT_INVALID",
    });
  });

  it("rejects a valid-looking closeout digest that cannot be reproduced", () => {
    const closeout = closeoutRun();
    (closeout.report as { closeoutSha256: string }).closeoutSha256 = "f".repeat(64);
    const report = new ReleaseFinalizationCoordinatorService().plan({
      ...validInput(), verification: verificationRun(), closeout,
    });

    expect(report.stage).toBe("blocked");
    expect(report.checks).toContainEqual({
      name: "evidence:closeoutIntegrity", status: "fail", code: "RELEASE_FINALIZATION_CLOSEOUT_INVALID",
    });
  });

  it("rejects a self-consistent closeout bound to a different acceptance manifest", () => {
    const closeout = closeoutRun("8".repeat(64));
    const report = new ReleaseFinalizationCoordinatorService().plan({
      ...validInput(), verification: verificationRun(), closeout,
    });

    expect(report.stage).toBe("blocked");
    expect(report.checks).toContainEqual({
      name: "evidence:closeoutIntegrity", status: "fail", code: "RELEASE_FINALIZATION_CLOSEOUT_INVALID",
    });
  });

  it("rejects expired or shorter-than-90-day evidence retention", () => {
    const expired = verificationRun();
    expired.artifactExpired = true;
    const expiredReport = new ReleaseFinalizationCoordinatorService().plan({
      ...validInput(), verification: expired,
    });
    expect(expiredReport.checks).toContainEqual({
      name: "retention:verification",
      status: "fail",
      code: "RELEASE_FINALIZATION_VERIFICATION_RETENTION_INVALID",
    });

    const short = acceptanceRun();
    short.artifactExpiresAt = "2026-09-30T00:00:00.000Z";
    const shortReport = new ReleaseFinalizationCoordinatorService().plan({ ...validInput(), acceptance: short });
    expect(shortReport.checks).toContainEqual({
      name: "retention:acceptance",
      status: "fail",
      code: "RELEASE_FINALIZATION_ACCEPTANCE_RETENTION_INVALID",
    });
  });

  it("rejects reports whose timestamps do not correlate with artifact creation", () => {
    const acceptance = acceptanceRun();
    acceptance.artifactCreatedAt = "2026-08-31T02:00:00.000Z";
    const staleAcceptance = new ReleaseFinalizationCoordinatorService().plan({ ...validInput(), acceptance });
    expect(staleAcceptance.checks).toContainEqual({
      name: "evidence:acceptance", status: "fail", code: "RELEASE_FINALIZATION_ACCEPTANCE_INVALID",
    });

    const verification = verificationRun();
    verification.artifactCreatedAt = "2026-08-30T23:00:00.000Z";
    const futureVerification = new ReleaseFinalizationCoordinatorService().plan({ ...validInput(), verification });
    expect(futureVerification.checks).toContainEqual({
      name: "evidence:verificationIntegrity", status: "fail", code: "RELEASE_FINALIZATION_VERIFICATION_INVALID",
    });

    const closeout = closeoutRun();
    closeout.artifactCreatedAt = "2026-08-31T02:00:00.000Z";
    const staleCloseout = new ReleaseFinalizationCoordinatorService().plan({
      ...validInput(), verification: verificationRun(), closeout,
    });
    expect(staleCloseout.checks).toContainEqual({
      name: "evidence:closeoutIntegrity", status: "fail", code: "RELEASE_FINALIZATION_CLOSEOUT_INVALID",
    });
  });

  it("tracks active verification and closeout without duplicate actions", () => {
    const service = new ReleaseFinalizationCoordinatorService();
    const verifying = service.plan({ ...validInput(), verificationActiveRunId: 21 });
    const closing = service.plan({ ...validInput(), verification: verificationRun(), closeoutActiveRunId: 31 });
    expect(verifying.stage).toBe("verification-in-progress");
    expect(verifying.action).toBeNull();
    expect(closing.stage).toBe("closeout-in-progress");
    expect(closing.action).toBeNull();
  });

  it("reports an active acceptance without treating it as completed evidence", () => {
    const report = new ReleaseFinalizationCoordinatorService().plan({
      ...validInput(), acceptance: null, acceptanceActiveRunId: 9,
    });
    expect(report.stage).toBe("acceptance-in-progress");
    expect(report.action).toBeNull();
  });

  it("authorizes an action only with the solo release confirmation", () => {
    const service = new ReleaseFinalizationCoordinatorService();
    const missing = service.plan({ ...validInput(), applyRequested: true });
    const confirmed = service.plan({
      ...validInput(), applyRequested: true, confirmation: "AUTHORIZE_SOLO_PRODUCTION_RELEASE",
    });
    expect(missing.applyAuthorized).toBe(false);
    expect(confirmed.applyAuthorized).toBe(true);
  });

  it("rejects unsafe metadata", () => {
    const service = new ReleaseFinalizationCoordinatorService();
    expect(() => service.plan({ ...validInput(), repository: "../unsafe" }))
      .toThrowError(expect.objectContaining({ name: "RELEASE_FINALIZATION_REPOSITORY_INVALID" }));
    expect(() => service.plan({ ...validInput(), maximumVerificationDelayHours: 0 }))
      .toThrowError(expect.objectContaining({ name: "RELEASE_FINALIZATION_MAXIMUM_DELAY_INVALID" }));
  });
});
