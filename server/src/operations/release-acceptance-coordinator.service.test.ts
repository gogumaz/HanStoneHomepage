import { describe, expect, it } from "vitest";
import {
  ReleaseAcceptanceCoordinatorService,
  type ReleaseAcceptanceCoordinatorInput,
  type ReleaseAcceptanceCoordinatorRun,
} from "./release-acceptance-coordinator.service.js";
import { REQUIRED_PRODUCTION_SECRETS } from "./release-readiness.service.js";

const sha = "a".repeat(40);
const now = new Date("2026-08-31T00:00:00.000Z");

function evidenceRuns(): ReleaseAcceptanceCoordinatorRun[] {
  return [
    {
      databaseId: 10,
      workflowName: "CI",
      displayTitle: "CI",
      headSha: sha,
      status: "completed",
      conclusion: "success",
      createdAt: "2026-08-30T00:00:00.000Z",
      artifactNames: [
        `release-supply-chain-${sha}`,
        `web-release-${sha}`,
        "browser-field-validation-10",
      ],
    },
    {
      databaseId: 20,
      workflowName: "Staging read-only load test",
      displayTitle: "load",
      headSha: sha,
      status: "completed",
      conclusion: "success",
      createdAt: "2026-08-30T01:00:00.000Z",
      artifactNames: ["staging-read-only-load-report-20"],
    },
    {
      databaseId: 30,
      workflowName: "Staging worker queue soak",
      displayTitle: "soak",
      headSha: sha,
      status: "completed",
      conclusion: "success",
      createdAt: "2026-08-30T02:00:00.000Z",
      artifactNames: ["staging-worker-soak-report-30"],
    },
  ];
}

function validInput(): ReleaseAcceptanceCoordinatorInput {
  return {
    repository: "example/baduk-history",
    actorLogin: "gogumaz",
    defaultBranch: "main",
    localCommitSha: sha,
    remoteDefaultCommitSha: sha,
    dirtyFileCount: 0,
    productionSecretNames: [...REQUIRED_PRODUCTION_SECRETS],
    releaseId: "release-2026.08.31",
    imageReference: `ghcr.io/example/api@sha256:${"b".repeat(64)}`,
    registryHost: "ghcr.io",
    backupCreatedAt: "2026-08-30T03:00:00.000Z",
    restoreStartedAt: "2026-08-30T04:00:00.000Z",
    runs: evidenceRuns(),
    applyRequested: false,
    confirmation: null,
  };
}

describe("ReleaseAcceptanceCoordinatorService", () => {
  it("builds a ready dry-run from three successful artifact-bound runs", () => {
    const report = new ReleaseAcceptanceCoordinatorService(() => now).plan(validInput());

    expect(report.ok).toBe(true);
    expect(report.stage).toBe("ready");
    expect(report.evidence.map(({ runId }) => runId)).toEqual([10, 20, 30]);
    expect(report.action?.file).toBe("release-candidate-acceptance.yml");
    expect(report.applyAuthorized).toBe(false);
  });

  it("authorizes dispatch only with the solo release confirmation", () => {
    const service = new ReleaseAcceptanceCoordinatorService(() => now);
    const missing = service.plan({ ...validInput(), applyRequested: true });
    const confirmed = service.plan({
      ...validInput(),
      applyRequested: true,
      confirmation: "AUTHORIZE_SOLO_PRODUCTION_RELEASE",
    });

    expect(missing.applyAuthorized).toBe(false);
    expect(confirmed.applyAuthorized).toBe(true);
  });

  it("rejects failed CI even if all expected artifacts exist", () => {
    const input = validInput();
    const ci = input.runs.find(({ workflowName }) => workflowName === "CI");
    if (ci) ci.conclusion = "failure";

    const report = new ReleaseAcceptanceCoordinatorService(() => now).plan(input);

    expect(report.stage).toBe("blocked");
    expect(report.checks).toContainEqual({
      name: "evidence:ci",
      status: "fail",
      code: "RELEASE_ACCEPTANCE_EVIDENCE_MISSING",
    });
  });

  it("rejects successful runs with missing or expired artifacts", () => {
    const input = validInput();
    input.runs[0]!.artifactNames = [];
    input.runs[1]!.createdAt = "2026-08-20T00:00:00.000Z";

    const report = new ReleaseAcceptanceCoordinatorService(() => now).plan(input);

    expect(report.evidence[0]?.state).toBe("missing");
    expect(report.evidence[1]?.state).toBe("missing");
  });

  it("reports all missing external inputs and production secrets", () => {
    const report = new ReleaseAcceptanceCoordinatorService(() => now).plan({
      ...validInput(),
      productionSecretNames: [],
      releaseId: null,
      imageReference: null,
      backupCreatedAt: null,
      restoreStartedAt: null,
    });

    expect(report.ok).toBe(false);
    expect(report.releaseId).toBeNull();
    expect(report.checks.filter(({ code }) => code === "RELEASE_ACCEPTANCE_PRODUCTION_SECRET_MISSING"))
      .toHaveLength(9);
  });

  it("does not duplicate an active or completed release ID", () => {
    const input = validInput();
    input.runs.push({
      databaseId: 40,
      workflowName: "Release candidate acceptance",
      displayTitle: "Release candidate acceptance · release-2026.08.31",
      headSha: sha,
      status: "in_progress",
      conclusion: null,
      createdAt: "2026-08-30T05:00:00.000Z",
      artifactNames: [],
    });
    const active = new ReleaseAcceptanceCoordinatorService(() => now).plan(input);
    input.runs[3] = { ...input.runs[3]!, status: "completed", conclusion: "success" };
    const complete = new ReleaseAcceptanceCoordinatorService(() => now).plan(input);

    expect(active.stage).toBe("in-progress");
    expect(active.action).toBeNull();
    expect(complete.stage).toBe("complete");
    expect(complete.action).toBeNull();
  });

  it("rejects unsafe immutable inputs and malformed metadata", () => {
    const service = new ReleaseAcceptanceCoordinatorService(() => now);
    const report = service.plan({
      ...validInput(),
      imageReference: `ghcr.io/example/api:latest@sha256:${"b".repeat(64)}`,
      restoreStartedAt: "2026-08-29T00:00:00.000Z",
    });

    expect(report.ok).toBe(false);
    expect(report.checks.find(({ name }) => name === "input:imageReference")?.status).toBe("fail");
    expect(report.checks.find(({ name }) => name === "input:restoreStartedAt")?.status).toBe("fail");
    expect(() => service.plan({ ...validInput(), repository: "../unsafe" }))
      .toThrowError(expect.objectContaining({ name: "RELEASE_ACCEPTANCE_REPOSITORY_INVALID" }));
  });
});
