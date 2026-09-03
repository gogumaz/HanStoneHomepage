import { describe, expect, it } from "vitest";
import {
  RELEASE_GOVERNANCE_CONFIRMATION,
  ReleaseGovernanceService,
  type ReleaseGovernanceInput,
} from "./release-governance.service.js";

function validInput(): ReleaseGovernanceInput {
  return {
    repository: "example/baduk-history",
    defaultBranch: "main",
    actor: { login: "release-operator", id: 10 },
    soloOperatorLogin: "release-operator",
    productionEnvironmentExists: false,
    existingCustomBranchPolicies: [],
    applyRequested: false,
    confirmation: null,
  };
}

describe("ReleaseGovernanceService", () => {
  it("creates a non-mutating plan for the designated solo operator", () => {
    const report = new ReleaseGovernanceService().plan(validInput());

    expect(report.ok).toBe(true);
    expect(report.mode).toBe("dry-run");
    expect(report.environmentExists).toBe(false);
    expect(report.applyAuthorized).toBe(false);
    expect(report.actions).toEqual(["upsertProductionEnvironment", "ensureDefaultBranchPolicy"]);
  });

  it("authorizes apply only with the exact confirmation", () => {
    const service = new ReleaseGovernanceService();
    const missing = service.plan({ ...validInput(), applyRequested: true });
    const confirmed = service.plan({
      ...validInput(),
      applyRequested: true,
      confirmation: RELEASE_GOVERNANCE_CONFIRMATION,
    });

    expect(missing.applyAuthorized).toBe(false);
    expect(missing.checks).toContainEqual({
      name: "applyConfirmation",
      status: "fail",
      code: "RELEASE_GOVERNANCE_CONFIRMATION_REQUIRED",
    });
    expect(confirmed.ok).toBe(true);
    expect(confirmed.applyAuthorized).toBe(true);
  });

  it("rejects a different operator and unexpected broad policies", () => {
    const service = new ReleaseGovernanceService();
    const wrongOperator = service.plan({
      ...validInput(),
      actor: { login: "different-operator", id: 30 },
    });
    const broadPolicy = service.plan({
      ...validInput(),
      existingCustomBranchPolicies: ["main", "release/*"],
    });

    expect(wrongOperator.checks).toContainEqual({
      name: "soloOperator",
      status: "fail",
      code: "RELEASE_GOVERNANCE_SOLO_OPERATOR_MISMATCH",
    });
    expect(broadPolicy.checks).toContainEqual({
      name: "existingBranchPolicies",
      status: "fail",
      code: "RELEASE_GOVERNANCE_UNEXPECTED_BRANCH_POLICY",
    });
  });

  it("rejects malformed identities and repository metadata", () => {
    const service = new ReleaseGovernanceService();

    expect(() => service.plan({ ...validInput(), repository: "../unsafe" }))
      .toThrowError(expect.objectContaining({ name: "RELEASE_GOVERNANCE_REPOSITORY_INVALID" }));
    expect(() => service.plan({ ...validInput(), defaultBranch: "../unsafe" }))
      .toThrowError(expect.objectContaining({ name: "RELEASE_GOVERNANCE_DEFAULT_BRANCH_INVALID" }));
    expect(() => service.plan({ ...validInput(), actor: { login: "bad/name", id: 10 } }))
      .toThrowError(expect.objectContaining({ name: "RELEASE_GOVERNANCE_ACTOR_INVALID" }));
    expect(() => service.plan({ ...validInput(), soloOperatorLogin: "bad/name" }))
      .toThrowError(expect.objectContaining({ name: "RELEASE_GOVERNANCE_SOLO_OPERATOR_INVALID" }));
  });
});
