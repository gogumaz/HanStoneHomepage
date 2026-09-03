import { describe, expect, it } from "vitest";
import {
  STAGING_EVIDENCE_CONFIRMATION,
  StagingEvidenceCoordinatorService,
  type StagingEvidenceCoordinatorInput,
} from "./staging-evidence-coordinator.service.js";

const sha = "a".repeat(40);

function validInput(): StagingEvidenceCoordinatorInput {
  return {
    repository: "example/baduk-history",
    actorLogin: "gogumaz",
    defaultBranch: "main",
    localCommitSha: sha,
    remoteDefaultCommitSha: sha,
    dirtyFileCount: 0,
    repositorySecretNames: [
      "RELEASE_READINESS_TOKEN",
      "STAGING_API_BASE_URL",
      "STAGING_OPERATIONS_METRICS_TOKEN",
    ],
    runs: [],
    applyRequested: false,
    confirmation: null,
  };
}

describe("StagingEvidenceCoordinatorService", () => {
  it("plans both missing evidence workflows without dispatching", () => {
    const report = new StagingEvidenceCoordinatorService().plan(validInput());

    expect(report.ok).toBe(true);
    expect(report.mode).toBe("dry-run");
    expect(report.stage).toBe("ready");
    expect(report.actions.map(({ file }) => file)).toEqual([
      "staging-read-only-load.yml",
      "staging-worker-soak.yml",
    ]);
    expect(report.applyAuthorized).toBe(false);
  });

  it("authorizes only an explicitly confirmed dispatch", () => {
    const service = new StagingEvidenceCoordinatorService();
    const missing = service.plan({ ...validInput(), applyRequested: true });
    const confirmed = service.plan({
      ...validInput(),
      applyRequested: true,
      confirmation: STAGING_EVIDENCE_CONFIRMATION,
    });

    expect(missing.applyAuthorized).toBe(false);
    expect(missing.checks).toContainEqual({
      name: "applyConfirmation",
      status: "fail",
      code: "STAGING_EVIDENCE_CONFIRMATION_REQUIRED",
    });
    expect(confirmed.applyAuthorized).toBe(true);
  });

  it("reuses fresh successful evidence and dispatches only the missing workflow", () => {
    const report = new StagingEvidenceCoordinatorService(
      () => new Date("2026-08-31T00:00:00.000Z"),
    ).plan({
      ...validInput(),
      runs: [{
        databaseId: 101,
        workflowName: "Staging read-only load test",
        headSha: sha,
        status: "completed",
        conclusion: "success",
        createdAt: "2026-08-30T00:00:00.000Z",
      }],
    });

    expect(report.evidence[0]).toMatchObject({ state: "passed", runId: 101 });
    expect(report.actions).toEqual([{
      workflow: "Staging worker queue soak",
      file: "staging-worker-soak.yml",
    }]);
  });

  it("reports in-progress runs without creating duplicates", () => {
    const report = new StagingEvidenceCoordinatorService().plan({
      ...validInput(),
      runs: [{
        databaseId: 202,
        workflowName: "Staging worker queue soak",
        headSha: sha,
        status: "in_progress",
        conclusion: null,
        createdAt: new Date().toISOString(),
      }],
    });

    expect(report.stage).toBe("in-progress");
    expect(report.evidence[1]).toMatchObject({ state: "in-progress", runId: 202 });
    expect(report.actions.map(({ file }) => file)).toEqual(["staging-read-only-load.yml"]);
  });

  it("marks the stage complete when both fresh workflows passed", () => {
    const createdAt = "2026-08-30T00:00:00.000Z";
    const runs = ["Staging read-only load test", "Staging worker queue soak"].map(
      (workflowName, index) => ({
        databaseId: index + 1,
        workflowName,
        headSha: sha,
        status: "completed",
        conclusion: "success",
        createdAt,
      }),
    );
    const report = new StagingEvidenceCoordinatorService(
      () => new Date("2026-08-31T00:00:00.000Z"),
    ).plan({ ...validInput(), runs });

    expect(report.stage).toBe("complete");
    expect(report.actions).toEqual([]);
  });

  it("fails closed for unpublished, dirty, or unconfigured candidates", () => {
    const report = new StagingEvidenceCoordinatorService().plan({
      ...validInput(),
      remoteDefaultCommitSha: "b".repeat(40),
      dirtyFileCount: 3,
      repositorySecretNames: [],
    });

    expect(report.ok).toBe(false);
    expect(report.stage).toBe("blocked");
    expect(report.checks.filter(({ status }) => status === "fail")).toHaveLength(4);
  });

  it("rejects malformed metadata", () => {
    const service = new StagingEvidenceCoordinatorService();

    expect(() => service.plan({ ...validInput(), repository: "../unsafe" }))
      .toThrowError(expect.objectContaining({ name: "STAGING_EVIDENCE_REPOSITORY_INVALID" }));
    expect(() => service.plan({ ...validInput(), dirtyFileCount: -1 }))
      .toThrowError(expect.objectContaining({ name: "STAGING_EVIDENCE_DIRTY_COUNT_INVALID" }));
  });
});
