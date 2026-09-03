import { describe, expect, it } from "vitest";
import { StagingEvidenceBundleService, type StagingEvidenceBundleInput } from "./staging-evidence-bundle.service.js";

const commit = "a".repeat(40);
const hash = "b".repeat(64);
const now = new Date("2026-08-31T12:00:00.000Z");

function load(startedAt: string, completedAt: string) {
  return {
    ok: true,
    candidateCommit: commit,
    startedAt,
    completedAt,
    requests: { planned: 500, completed: 500 },
    thresholds: { latencyMet: true, errorRateMet: true },
  };
}

function validInput(): StagingEvidenceBundleInput {
  const workerStartedAt = "2026-08-31T11:40:00.000Z";
  const workerCompletedAt = "2026-08-31T11:50:00.000Z";
  return {
    releaseId: "release-2026.08.31",
    candidateCommitSha: commit,
    loadTestRunId: 101,
    workerSoakRunId: 102,
    maximumAgeHours: 168,
    reports: {
      readOnlyLoad: load("2026-08-31T11:30:00.000Z", "2026-08-31T11:31:00.000Z"),
      workerSoak: {
        ok: true,
        candidateCommit: commit,
        startedAt: workerStartedAt,
        completedAt: workerCompletedAt,
        samples: { planned: 60, completed: 60, failed: 0 },
        thresholds: {
          latencyMet: true,
          criticalSamplesMet: true,
          queueHealthMet: true,
          metricsFreshnessMet: true,
        },
        queues: ["account_mail", "inquiry_notification", "video_scan", "hls_transcode", "object_deletion"]
          .map((name) => ({ name, healthy: true })),
      },
      controlledLoad: load("2026-08-31T11:40:05.000Z", "2026-08-31T11:41:00.000Z"),
      execution: {
        ok: true,
        candidateCommit: commit,
        generatedAt: "2026-08-31T11:50:01.000Z",
        workerSoakExitCode: 0,
        controlledLoadExitCode: 0,
      },
    },
    sourceSha256: { readOnlyLoad: hash, workerSoak: hash, controlledLoad: hash, execution: hash },
  };
}

describe("StagingEvidenceBundleService", () => {
  it("binds successful load and concurrent worker-soak artifacts without exposing source contents", () => {
    const report = new StagingEvidenceBundleService(() => now).create(validInput());

    expect(report.ok).toBe(true);
    expect(report.checks).toHaveLength(9);
    expect(report.sources).toHaveLength(4);
    expect(report.evidenceSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify(report)).not.toContain("requestsPerSecond");
  });

  it("rejects a candidate mismatch and a failed controlled workload", () => {
    const input = validInput();
    input.reports.controlledLoad = {
      ...(input.reports.controlledLoad as Record<string, unknown>),
      ok: false,
      candidateCommit: "c".repeat(40),
    };
    const report = new StagingEvidenceBundleService(() => now).create(input);

    expect(report.ok).toBe(false);
    expect(report.checks).toContainEqual({
      name: "candidateIdentity", status: "fail", code: "STAGING_BUNDLE_CANDIDATE_MISMATCH",
    });
    expect(report.checks).toContainEqual({
      name: "controlledLoad", status: "fail", code: "STAGING_BUNDLE_CONTROLLED_LOAD_INVALID",
    });
  });

  it("requires the controlled load and worker observation windows to overlap", () => {
    const input = validInput();
    input.reports.controlledLoad = load("2026-08-31T11:51:00.000Z", "2026-08-31T11:52:00.000Z");
    const report = new StagingEvidenceBundleService(() => now).create(input);

    expect(report.checks).toContainEqual({
      name: "concurrentObservation", status: "fail", code: "STAGING_BUNDLE_WORKLOAD_DID_NOT_OVERLAP_SOAK",
    });
  });

  it("rejects stale evidence and a premature execution summary", () => {
    const input = validInput();
    input.maximumAgeHours = 1;
    input.reports.readOnlyLoad = load("2026-08-31T10:30:00.000Z", "2026-08-31T10:31:00.000Z");
    (input.reports.execution as Record<string, unknown>).generatedAt = "2026-08-31T11:45:00.000Z";
    const report = new StagingEvidenceBundleService(() => now).create(input);

    expect(report.checks).toContainEqual({
      name: "executionTimeline", status: "fail", code: "STAGING_BUNDLE_EXECUTION_TIMELINE_INVALID",
    });
    expect(report.checks).toContainEqual({
      name: "freshness", status: "fail", code: "STAGING_BUNDLE_EVIDENCE_EXPIRED_OR_FUTURE",
    });
  });

  it("rejects unsafe identifiers, run IDs, age bounds, and hashes", () => {
    const service = new StagingEvidenceBundleService(() => now);
    expect(() => service.create({ ...validInput(), releaseId: "../release" }))
      .toThrowError(expect.objectContaining({ name: "STAGING_BUNDLE_RELEASE_ID_INVALID" }));
    expect(() => service.create({ ...validInput(), loadTestRunId: 0 }))
      .toThrowError(expect.objectContaining({ name: "STAGING_BUNDLE_RUN_ID_INVALID" }));
    expect(() => service.create({ ...validInput(), maximumAgeHours: 0 }))
      .toThrowError(expect.objectContaining({ name: "STAGING_BUNDLE_MAXIMUM_AGE_INVALID" }));
    expect(() => service.create({
      ...validInput(), sourceSha256: { ...validInput().sourceSha256, execution: "invalid" },
    })).toThrowError(expect.objectContaining({ name: "STAGING_BUNDLE_SOURCE_SHA256_INVALID" }));
  });
});
