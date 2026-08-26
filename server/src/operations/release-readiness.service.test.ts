import { describe, expect, it } from "vitest";
import {
  ReleaseReadinessService,
  REQUIRED_PRODUCTION_SECRETS,
  REQUIRED_RELEASE_WORKFLOWS,
  REQUIRED_REPOSITORY_SECRETS,
  type ReleaseReadinessInput,
} from "./release-readiness.service.js";

function validInput(): ReleaseReadinessInput {
  return {
    repository: "example/baduk-history",
    defaultBranch: "main",
    localCommitSha: "a".repeat(40),
    remoteDefaultCommitSha: "a".repeat(40),
    dirtyFileCount: 0,
    workflows: REQUIRED_RELEASE_WORKFLOWS.map((name) => ({ name, state: "active" })),
    productionEnvironmentExists: true,
    productionReviewerCount: 1,
    productionPreventSelfReview: true,
    productionProtectedBranchesOnly: false,
    productionCustomDeploymentBranchNames: ["main"],
    productionSecretNames: [...REQUIRED_PRODUCTION_SECRETS],
    repositorySecretNames: [...REQUIRED_REPOSITORY_SECRETS],
  };
}

describe("ReleaseReadinessService", () => {
  it("passes a published clean candidate with protected production configuration", () => {
    const report = new ReleaseReadinessService(() => new Date("2026-08-25T08:00:00.000Z")).run(validInput());

    expect(report.ok).toBe(true);
    expect(report.commitSha).toBe("a".repeat(40));
    expect(report.checks.every(({ status }) => status === "pass")).toBe(true);
  });

  it("reports missing remote, workflow, environment, reviewer, and secret prerequisites", () => {
    const input = validInput();
    input.remoteDefaultCommitSha = "b".repeat(40);
    input.dirtyFileCount = 3;
    input.workflows = input.workflows.slice(0, 1);
    input.productionEnvironmentExists = false;
    input.productionReviewerCount = 0;
    input.productionPreventSelfReview = false;
    input.productionCustomDeploymentBranchNames = [];
    input.productionSecretNames = [];
    input.repositorySecretNames = [];
    const report = new ReleaseReadinessService().run(input);

    expect(report.ok).toBe(false);
    expect(report.checks).toContainEqual({
      name: "candidatePublished",
      status: "fail",
      code: "LOCAL_REMOTE_COMMIT_MISMATCH",
    });
    expect(report.checks).toContainEqual({
      name: "workingTree",
      status: "fail",
      code: "WORKING_TREE_NOT_CLEAN",
    });
    expect(report.checks.filter(({ code }) => code === "REQUIRED_WORKFLOW_NOT_ACTIVE")).toHaveLength(6);
    expect(report.checks.filter(({ code }) => code === "PRODUCTION_SECRET_MISSING")).toHaveLength(6);
    expect(report.checks.filter(({ code }) => code === "REPOSITORY_SECRET_MISSING")).toHaveLength(1);
    expect(report.checks).toContainEqual({
      name: "environment:production:preventSelfReview",
      status: "fail",
      code: "PRODUCTION_SELF_REVIEW_NOT_BLOCKED",
    });
    expect(report.checks).toContainEqual({
      name: "environment:production:deploymentBranch",
      status: "fail",
      code: "PRODUCTION_DEPLOYMENT_BRANCH_POLICY_UNSAFE",
    });
  });

  it("rejects malformed repository, commit, and counter inputs", () => {
    const service = new ReleaseReadinessService();

    expect(() => service.run({ ...validInput(), repository: "../unsafe" }))
      .toThrowError(expect.objectContaining({ name: "RELEASE_READINESS_REPOSITORY_INVALID" }));
    expect(() => service.run({ ...validInput(), localCommitSha: "main" }))
      .toThrowError(expect.objectContaining({ name: "RELEASE_READINESS_LOCAL_COMMIT_INVALID" }));
    expect(() => service.run({ ...validInput(), defaultBranch: "../unsafe" }))
      .toThrowError(expect.objectContaining({ name: "RELEASE_READINESS_DEFAULT_BRANCH_INVALID" }));
    expect(() => service.run({ ...validInput(), dirtyFileCount: -1 }))
      .toThrowError(expect.objectContaining({ name: "RELEASE_READINESS_DIRTY_COUNT_INVALID" }));
  });

  it("accepts protected branches and rejects broad custom deployment policies", () => {
    const protectedInput = validInput();
    protectedInput.productionProtectedBranchesOnly = true;
    protectedInput.productionCustomDeploymentBranchNames = [];
    expect(new ReleaseReadinessService().run(protectedInput).ok).toBe(true);

    const broadInput = validInput();
    broadInput.productionCustomDeploymentBranchNames = ["main", "release/*"];
    const report = new ReleaseReadinessService().run(broadInput);
    expect(report.checks).toContainEqual({
      name: "environment:production:deploymentBranch",
      status: "fail",
      code: "PRODUCTION_DEPLOYMENT_BRANCH_POLICY_UNSAFE",
    });
  });
});
