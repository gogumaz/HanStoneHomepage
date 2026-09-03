import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ReleaseAcceptanceService,
  type ReleaseAcceptanceInput,
} from "./release-acceptance.service.js";

const now = new Date("2026-08-24T12:00:00.000Z");
const preflightNames = [
  "configuration",
  "recoveryPolicy",
  "database",
  "rateLimitStore",
  "objectStorage",
  "cdn",
  "hlsTranscoder",
  "malwareScanner",
  "smtp",
];
const recoveryNames = ["migration", "criticalTables", "relationships", "rpo", "rto"];
const queueNames = ["account_mail", "inquiry_notification", "video_scan", "hls_transcode", "object_deletion"];

function validInput(): ReleaseAcceptanceInput {
  const value: ReleaseAcceptanceInput = {
    releaseId: "release-2026.08.24",
    commitSha: "A".repeat(40),
    imageReference: `registry.example.com/baduk-history-api@sha256:${"a".repeat(64)}`,
    evidenceSha256: {
      preflight: "1".repeat(64),
      recovery: "2".repeat(64),
      readOnlyLoad: "3".repeat(64),
      workerSoak: "4".repeat(64),
      webDeployment: "5".repeat(64),
      fieldValidation: "6".repeat(64),
      supplyChain: "7".repeat(64),
    },
    maximumAgeHours: {
      preflight: 24,
      recovery: 2_400,
      readOnlyLoad: 168,
      workerSoak: 168,
      webDeployment: 168,
      fieldValidation: 168,
      supplyChain: 168,
    },
    stagingEvidenceBundle: null,
    stagingEvidenceBundleSha256: "8".repeat(64),
    stagingEvidenceBundleMaximumAgeHours: 168,
    reports: {
      preflight: {
        ok: true,
        commitSha: "a".repeat(40),
        checkedAt: "2026-08-24T11:30:00.000Z",
        checks: preflightNames.map((name) => ({ name, status: "pass", detail: "secret-value" })),
      },
      recovery: {
        ok: true,
        commitSha: "a".repeat(40),
        completedAt: "2026-08-20T12:00:00.000Z",
        objectives: { rpoMet: true, rtoMet: true },
        checks: recoveryNames.map((name) => ({ name, status: "pass", detail: "private-database" })),
      },
      readOnlyLoad: {
        ok: true,
        commitSha: "a".repeat(40),
        completedAt: "2026-08-24T10:00:00.000Z",
        thresholds: { latencyMet: true, errorRateMet: true },
        requests: { planned: 500, completed: 500, failed: 0 },
      },
      workerSoak: {
        ok: true,
        commitSha: "a".repeat(40),
        completedAt: "2026-08-24T11:00:00.000Z",
        thresholds: {
          latencyMet: true,
          criticalSamplesMet: true,
          queueHealthMet: true,
          metricsFreshnessMet: true,
        },
        samples: { planned: 60, completed: 60, failed: 0 },
        queues: queueNames.map((name) => ({ name, healthy: true, rawMetric: "private" })),
      },
      webDeployment: {
        schemaVersion: 1,
        ok: true,
        commitSha: "a".repeat(40),
        generatedAt: "2026-08-24T11:05:00.000Z",
        files: [
          ["index.html", "text/html; charset=utf-8", "public,max-age=0,must-revalidate", 10],
          ["app.html", "text/html; charset=utf-8", "public,max-age=0,must-revalidate", 11],
          ["payment/success.html", "text/html; charset=utf-8", "public,max-age=0,must-revalidate", 12],
          ["payment/fail.html", "text/html; charset=utf-8", "public,max-age=0,must-revalidate", 13],
          ["assets/app-AbCd1234.js", "text/javascript; charset=utf-8", "public,max-age=31536000,immutable", 14],
        ].map(([path, contentType, cacheControl, bytes], index) => ({
          path,
          contentType,
          cacheControl,
          bytes,
          sha256: String(index + 1).repeat(64),
        })),
        totals: { files: 5, bytes: 60 },
      },
      fieldValidation: {
        schemaVersion: 1,
        ok: true,
        commitSha: "a".repeat(40),
        completedAt: "2026-08-24T11:10:00.000Z",
        projects: ["chromium", "field-firefox", "field-mobile-chrome", "field-mobile-safari"].map((name) => ({
          name,
          status: "pass",
          passed: 2,
          failed: 0,
          skipped: 0,
          flaky: 0,
        })),
        totals: { passed: 8, failed: 0, skipped: 0, flaky: 0 },
      },
      supplyChain: {
        schemaVersion: 1,
        ok: true,
        commitSha: "a".repeat(40),
        generatedAt: "2026-08-24T11:15:00.000Z",
        vulnerabilityPolicy: "npm-audit-production-high-critical-zero",
        artifacts: ["web", "api"].map((name, index) => ({
          name,
          sha256: String(index + 6).repeat(64),
          componentCount: index + 7,
          specVersion: "1.5",
        })),
      },
    },
  };
  const bundleBase = {
    schemaVersion: 1,
    ok: true,
    releaseId: value.releaseId,
    candidateCommitSha: value.commitSha.toLowerCase(),
    loadTestRunId: 101,
    workerSoakRunId: 102,
    checkedAt: "2026-08-24T11:30:00.000Z",
    maximumAgeHours: 168,
    checks: [
      "sourceInventory", "candidateIdentity", "readOnlyLoad", "workerSoak", "controlledLoad",
      "execution", "concurrentObservation", "executionTimeline", "freshness",
    ].map((name) => ({ name, status: "pass", code: "OK" })),
    sources: [
      { name: "readOnlyLoad", sha256: value.evidenceSha256.readOnlyLoad, observedAt: "2026-08-24T10:00:00.000Z" },
      { name: "workerSoak", sha256: value.evidenceSha256.workerSoak, observedAt: "2026-08-24T11:00:00.000Z" },
      { name: "controlledLoad", sha256: "8".repeat(64), observedAt: "2026-08-24T10:30:00.000Z" },
      { name: "execution", sha256: "9".repeat(64), observedAt: "2026-08-24T11:00:01.000Z" },
    ],
  };
  value.stagingEvidenceBundle = {
    ...bundleBase,
    evidenceSha256: createHash("sha256").update(JSON.stringify(bundleBase)).digest("hex"),
  };
  return value;
}

describe("ReleaseAcceptanceService", () => {
  it("accepts fresh and complete release evidence without copying sensitive details", () => {
    const report = new ReleaseAcceptanceService(() => now).run(validInput());

    expect(report.ok).toBe(true);
    expect(report.commitSha).toBe("a".repeat(40));
    expect(report.imageReference).toBe(`registry.example.com/baduk-history-api@sha256:${"a".repeat(64)}`);
    expect(report.imageDigest).toBe(`sha256:${"a".repeat(64)}`);
    expect(report.manifestSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(report.evidence[0]?.sha256).toBe("1".repeat(64));
    expect(report.evidence.map(({ status }) => status)).toEqual([
      "pass", "pass", "pass", "pass", "pass", "pass", "pass",
    ]);
    expect(report.stagingEvidenceBundle.status).toBe("pass");
    expect(JSON.stringify(report)).not.toContain("secret-value");
    expect(JSON.stringify(report)).not.toContain("private-database");
    expect(JSON.stringify(report)).not.toContain("rawMetric");
  });

  it("rejects incomplete load and unhealthy worker queue evidence", () => {
    const input = validInput();
    const load = input.reports.readOnlyLoad as { requests: { completed: number } };
    load.requests.completed = 499;
    const soak = input.reports.workerSoak as { queues: Array<{ name: string; healthy: boolean }> };
    soak.queues[2]!.healthy = false;
    const report = new ReleaseAcceptanceService(() => now).run(input);

    expect(report.ok).toBe(false);
    expect(report.evidence.find(({ name }) => name === "readOnlyLoad")?.checks).toContainEqual({
      name: "completion",
      status: "fail",
      code: "LOAD_TEST_INCOMPLETE",
    });
    expect(report.evidence.find(({ name }) => name === "workerSoak")?.checks).toContainEqual({
      name: "video_scan",
      status: "fail",
      code: "WORKER_SOAK_QUEUE_NOT_HEALTHY",
    });
  });

  it("rejects evidence generated from a different candidate commit", () => {
    const input = validInput();
    (input.reports.workerSoak as { commitSha: string }).commitSha = "1".repeat(40);
    const report = new ReleaseAcceptanceService(() => now).run(input);

    expect(report.ok).toBe(false);
    expect(report.evidence.find(({ name }) => name === "workerSoak")?.checks[0]).toEqual({
      name: "commitSha",
      status: "fail",
      code: "EVIDENCE_COMMIT_SHA_MISMATCH",
    });
  });

  it("rejects incomplete or policy-mismatched supply-chain evidence", () => {
    const input = validInput();
    const supplyChain = input.reports.supplyChain as {
      vulnerabilityPolicy: string;
      artifacts: Array<{ name: string; componentCount: number }>;
    };
    supplyChain.vulnerabilityPolicy = "audit-disabled";
    supplyChain.artifacts[1]!.componentCount = 0;
    const report = new ReleaseAcceptanceService(() => now).run(input);
    const checks = report.evidence.find(({ name }) => name === "supplyChain")?.checks;

    expect(report.ok).toBe(false);
    expect(checks).toContainEqual({
      name: "vulnerabilityPolicy",
      status: "fail",
      code: "SUPPLY_CHAIN_VULNERABILITY_POLICY_NOT_MET",
    });
    expect(checks).toContainEqual({
      name: "apiComponentInventory",
      status: "fail",
      code: "SUPPLY_CHAIN_COMPONENT_INVENTORY_EMPTY",
    });
  });

  it("rejects missing, failed, or flaky field browser profiles", () => {
    const input = validInput();
    const fieldValidation = input.reports.fieldValidation as {
      projects: Array<{ name: string; status: string; failed: number; flaky: number }>;
    };
    fieldValidation.projects.pop();
    fieldValidation.projects[1]!.status = "fail";
    fieldValidation.projects[1]!.flaky = 1;
    const report = new ReleaseAcceptanceService(() => now).run(input);
    const checks = report.evidence.find(({ name }) => name === "fieldValidation")?.checks;

    expect(report.ok).toBe(false);
    expect(checks).toContainEqual({
      name: "projectInventory",
      status: "fail",
      code: "FIELD_VALIDATION_PROJECT_INVENTORY_INVALID",
    });
    expect(checks).toContainEqual({
      name: "field-firefox",
      status: "fail",
      code: "FIELD_VALIDATION_PROJECT_NOT_PASSED",
    });
  });

  it("rejects tampered web hashes and unsafe CDN cache policies", () => {
    const input = validInput();
    const web = input.reports.webDeployment as {
      files: Array<{ path: string; sha256: string; cacheControl: string }>;
    };
    web.files[0]!.cacheControl = "public,max-age=31536000,immutable";
    web.files.at(-1)!.sha256 = "invalid";
    const report = new ReleaseAcceptanceService(() => now).run(input);
    const checks = report.evidence.find(({ name }) => name === "webDeployment")?.checks;

    expect(report.ok).toBe(false);
    expect(checks).toContainEqual({
      name: "entrypoints",
      status: "fail",
      code: "WEB_DEPLOYMENT_ENTRYPOINT_INVALID",
    });
    expect(checks).toContainEqual({
      name: "fileHashes",
      status: "fail",
      code: "WEB_DEPLOYMENT_FILE_SHA256_INVALID",
    });
  });

  it("binds the image and exact evidence bytes into a deterministic manifest digest", () => {
    const service = new ReleaseAcceptanceService(() => now);
    const first = service.run(validInput());
    const changed = validInput();
    changed.evidenceSha256.workerSoak = "9".repeat(64);
    const second = service.run(changed);
    const changedPolicy = validInput();
    changedPolicy.maximumAgeHours.workerSoak = 24;
    const changedBundle = validInput();
    changedBundle.stagingEvidenceBundleSha256 = "0".repeat(64);

    expect(service.run(validInput()).manifestSha256).toBe(first.manifestSha256);
    expect(second.manifestSha256).not.toBe(first.manifestSha256);
    expect(service.run(changedPolicy).manifestSha256).not.toBe(first.manifestSha256);
    expect(service.run(changedBundle).manifestSha256).not.toBe(first.manifestSha256);
  });

  it("rejects a tampered staging bundle or source reports that differ from the seven evidence files", () => {
    const tampered = validInput();
    (tampered.stagingEvidenceBundle as { releaseId: string }).releaseId = "different-release";
    const tamperedReport = new ReleaseAcceptanceService(() => now).run(tampered);
    expect(tamperedReport.ok).toBe(false);
    expect(tamperedReport.stagingEvidenceBundle.checks.map(({ code }) => code)).toEqual(expect.arrayContaining([
      "STAGING_BUNDLE_IDENTITY_INVALID",
      "STAGING_BUNDLE_SELF_DIGEST_INVALID",
    ]));

    const mismatched = validInput();
    const sources = (mismatched.stagingEvidenceBundle as { sources: Array<{ name: string; sha256: string }> }).sources;
    sources.find(({ name }) => name === "workerSoak")!.sha256 = "0".repeat(64);
    const mismatchReport = new ReleaseAcceptanceService(() => now).run(mismatched);
    expect(mismatchReport.stagingEvidenceBundle.checks).toContainEqual({
      name: "workerSource", status: "fail", code: "STAGING_BUNDLE_WORKER_SOURCE_MISMATCH",
    });
  });

  it("rejects expired, future, and invalid evidence timestamps", () => {
    const input = validInput();
    (input.reports.preflight as { checkedAt: string }).checkedAt = "2026-08-20T00:00:00.000Z";
    (input.reports.recovery as { completedAt: string }).completedAt = "invalid";
    (input.reports.readOnlyLoad as { completedAt: string }).completedAt = "2026-08-24T12:06:00.000Z";
    const report = new ReleaseAcceptanceService(() => now).run(input);

    expect(report.ok).toBe(false);
    expect(report.evidence.find(({ name }) => name === "preflight")?.checks.at(-1)?.code).toBe("EVIDENCE_EXPIRED");
    expect(report.evidence.find(({ name }) => name === "recovery")?.checks.at(-1)?.code).toBe(
      "EVIDENCE_TIMESTAMP_INVALID",
    );
    expect(report.evidence.find(({ name }) => name === "readOnlyLoad")?.checks.at(-1)?.code).toBe(
      "EVIDENCE_TIMESTAMP_IN_FUTURE",
    );
  });

  it("fails closed for malformed reports and unsafe release metadata", () => {
    const input = validInput();
    input.reports.preflight = "not-an-object";
    const report = new ReleaseAcceptanceService(() => now).run(input);
    expect(report.ok).toBe(false);
    expect(report.evidence[0]?.observedAt).toBeNull();

    expect(() => new ReleaseAcceptanceService(() => now).run({ ...validInput(), releaseId: "../release" })).toThrowError(
      expect.objectContaining({ name: "RELEASE_ID_INVALID" }),
    );
    expect(() => new ReleaseAcceptanceService(() => now).run({ ...validInput(), commitSha: "main" })).toThrowError(
      expect.objectContaining({ name: "RELEASE_COMMIT_SHA_INVALID" }),
    );
    expect(() => new ReleaseAcceptanceService(() => now).run({ ...validInput(), imageReference: "image:latest" })).toThrowError(
      expect.objectContaining({ name: "RELEASE_IMAGE_REFERENCE_INVALID" }),
    );
    expect(() => new ReleaseAcceptanceService(() => now).run({
      ...validInput(),
      imageReference: `https://registry.example.com/image@sha256:${"a".repeat(64)}`,
    })).toThrowError(expect.objectContaining({ name: "RELEASE_IMAGE_REFERENCE_INVALID" }));
    expect(() => new ReleaseAcceptanceService(() => now).run({
      ...validInput(),
      evidenceSha256: { ...validInput().evidenceSha256, workerSoak: "invalid" },
    })).toThrowError(expect.objectContaining({ name: "RELEASE_EVIDENCE_SHA256_INVALID" }));
    expect(() => new ReleaseAcceptanceService(() => now).run({
      ...validInput(),
      maximumAgeHours: { ...validInput().maximumAgeHours, preflight: 0 },
    })).toThrowError(expect.objectContaining({ name: "RELEASE_EVIDENCE_MAXIMUM_AGE_INVALID" }));
    expect(() => new ReleaseAcceptanceService(() => now).run({
      ...validInput(), stagingEvidenceBundleSha256: "invalid",
    })).toThrowError(expect.objectContaining({ name: "RELEASE_STAGING_BUNDLE_SHA256_INVALID" }));
  });
});
