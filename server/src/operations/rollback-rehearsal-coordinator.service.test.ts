import { describe, expect, it } from "vitest";
import {
  RollbackRehearsalCoordinatorService,
  type RollbackRehearsalCoordinatorInput,
} from "./rollback-rehearsal-coordinator.service.js";

const sha = "a".repeat(40);

function input(): RollbackRehearsalCoordinatorInput {
  return {
    repository: "example/baduk-history",
    actorLogin: "gogumaz",
    defaultBranch: "main",
    localCommitSha: sha,
    remoteDefaultCommitSha: sha,
    dirtyFileCount: 0,
    workflowActive: true,
    repositorySecretNames: [
      "ROLLBACK_DRILL_API_BASE_URL", "ROLLBACK_DRILL_WEB_BASE_URL", "ROLLBACK_DRILL_OPERATIONS_METRICS_TOKEN",
    ],
    drillId: "rollback-2026-q3",
    currentReleaseId: "release-current",
    currentAcceptanceRunId: 10,
    targetReleaseId: "release-previous",
    targetCloseoutRunId: 20,
    runs: [
      {
        databaseId: 10,
        workflowName: "Release candidate acceptance",
        displayTitle: "Release candidate acceptance · release-current",
        headSha: sha,
        status: "completed",
        conclusion: "success",
        artifactNames: ["release-acceptance-release-current-10"],
      },
      {
        databaseId: 20,
        workflowName: "Release closeout",
        displayTitle: "Release closeout · release-previous",
        headSha: "b".repeat(40),
        status: "completed",
        conclusion: "success",
        artifactNames: ["release-closeout-release-previous-20"],
      },
    ],
    applyRequested: false,
    confirmation: null,
  };
}

describe("RollbackRehearsalCoordinatorService", () => {
  it("plans a single dry-run dispatch from immutable current and previous artifacts", () => {
    const report = new RollbackRehearsalCoordinatorService().plan(input());
    expect(report.ok).toBe(true);
    expect(report.stage).toBe("ready");
    expect(report.action).toEqual({ workflow: "rollback-rehearsal.yml" });
    expect(report.applyAuthorized).toBe(false);
  });

  it("requires the explicit isolated rehearsal confirmation before dispatch", () => {
    const service = new RollbackRehearsalCoordinatorService();
    const missing = service.plan({ ...input(), applyRequested: true });
    const confirmed = service.plan({
      ...input(), applyRequested: true, confirmation: "AUTHORIZE_ISOLATED_ROLLBACK_REHEARSAL",
    });
    expect(missing.applyAuthorized).toBe(false);
    expect(confirmed.applyAuthorized).toBe(true);
  });

  it("rejects missing secrets, an unpublished candidate, and a dirty tree", () => {
    const report = new RollbackRehearsalCoordinatorService().plan({
      ...input(), repositorySecretNames: [], remoteDefaultCommitSha: "c".repeat(40), dirtyFileCount: 2,
    });
    expect(report.stage).toBe("blocked");
    expect(report.checks.filter(({ code }) => code === "ROLLBACK_COORDINATOR_SECRET_MISSING")).toHaveLength(3);
    expect(report.checks.map(({ code }) => code)).toEqual(expect.arrayContaining([
      "ROLLBACK_COORDINATOR_CANDIDATE_NOT_PUBLISHED", "ROLLBACK_COORDINATOR_WORKING_TREE_NOT_CLEAN",
    ]));
  });

  it("rejects failed, mismatched, or incorrectly named source artifacts", () => {
    const value = input();
    value.runs[0]!.conclusion = "failure";
    value.runs[1]!.artifactNames = ["wrong-artifact"];
    const report = new RollbackRehearsalCoordinatorService().plan(value);
    expect(report.checks.map(({ code }) => code)).toEqual(expect.arrayContaining([
      "ROLLBACK_COORDINATOR_CURRENT_ACCEPTANCE_INVALID", "ROLLBACK_COORDINATOR_TARGET_CLOSEOUT_INVALID",
    ]));
  });

  it("does not dispatch a duplicate active or successful drill ID", () => {
    const value = input();
    value.runs.push({
      databaseId: 30,
      workflowName: "Rollback rehearsal verification",
      displayTitle: "Rollback rehearsal · rollback-2026-q3",
      headSha: sha,
      status: "in_progress",
      conclusion: null,
      artifactNames: [],
    });
    const active = new RollbackRehearsalCoordinatorService().plan(value);
    value.runs[2] = { ...value.runs[2]!, status: "completed", conclusion: "success" };
    const complete = new RollbackRehearsalCoordinatorService().plan(value);
    expect(active.stage).toBe("in-progress");
    expect(complete.stage).toBe("complete");
    expect(active.action).toBeNull();
    expect(complete.action).toBeNull();
  });

  it("requires a distinct previous release and safe metadata", () => {
    const same = new RollbackRehearsalCoordinatorService().plan({
      ...input(), targetReleaseId: "release-current",
    });
    expect(same.checks).toContainEqual({
      name: "previousRelease", status: "fail", code: "ROLLBACK_COORDINATOR_TARGET_NOT_PREVIOUS_RELEASE",
    });
    expect(() => new RollbackRehearsalCoordinatorService().plan({ ...input(), repository: "../unsafe" }))
      .toThrowError(expect.objectContaining({ name: "ROLLBACK_COORDINATOR_REPOSITORY_INVALID" }));
  });
});
