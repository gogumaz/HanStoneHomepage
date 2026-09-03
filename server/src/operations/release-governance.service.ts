export const RELEASE_GOVERNANCE_CONFIRMATION = "CONFIGURE_PRODUCTION_RELEASE_GOVERNANCE";

export type ReleaseGovernanceInput = {
  repository: string;
  defaultBranch: string;
  actor: { login: string; id: number };
  soloOperatorLogin: string;
  productionEnvironmentExists: boolean;
  existingCustomBranchPolicies: string[];
  applyRequested: boolean;
  confirmation: string | null;
};

export type ReleaseGovernanceReport = {
  ok: boolean;
  mode: "dry-run" | "apply";
  repository: string;
  environment: "production";
  environmentExists: boolean;
  defaultBranch: string;
  approvalMode: "solo";
  soloOperatorLogin: string;
  checks: Array<{ name: string; status: "pass" | "fail"; code: string }>;
  actions: ["upsertProductionEnvironment", "ensureDefaultBranchPolicy"];
  applyAuthorized: boolean;
};

type GovernanceCheck = ReleaseGovernanceReport["checks"][number];

function governanceError(code: string): Error {
  const error = new Error(code);
  error.name = code;
  return error;
}

function check(name: string, passed: boolean, code: string): GovernanceCheck {
  return { name, status: passed ? "pass" : "fail", code: passed ? "OK" : code };
}

function validLogin(value: string): boolean {
  return /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,98}[A-Za-z0-9])?$/u.test(value);
}

function validRepository(value: string): boolean {
  const parts = value.split("/");
  return parts.length === 2 && parts.every((part) => (
    /^[A-Za-z0-9_.-]{1,100}$/u.test(part) && part !== "." && part !== ".."
  ));
}

function validBranch(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._/-]{0,254}$/u.test(value)
    && !value.includes("..")
    && !value.includes("//")
    && !value.endsWith("/")
    && !value.endsWith(".");
}

function validBranchPolicy(value: string): boolean {
  return value.length > 0 && value.length <= 255 && value.trim() === value && !/[\0\r\n]/u.test(value);
}

export class ReleaseGovernanceService {
  plan(input: ReleaseGovernanceInput): ReleaseGovernanceReport {
    if (!validRepository(input.repository)) {
      throw governanceError("RELEASE_GOVERNANCE_REPOSITORY_INVALID");
    }
    if (!validBranch(input.defaultBranch)) {
      throw governanceError("RELEASE_GOVERNANCE_DEFAULT_BRANCH_INVALID");
    }
    if (!validLogin(input.actor.login) || !Number.isSafeInteger(input.actor.id) || input.actor.id <= 0) {
      throw governanceError("RELEASE_GOVERNANCE_ACTOR_INVALID");
    }
    if (!validLogin(input.soloOperatorLogin)) {
      throw governanceError("RELEASE_GOVERNANCE_SOLO_OPERATOR_INVALID");
    }
    if (input.existingCustomBranchPolicies.some((name) => !validBranchPolicy(name))) {
      throw governanceError("RELEASE_GOVERNANCE_BRANCH_POLICY_INVALID");
    }

    const soloOperatorMatches = input.actor.login.toLowerCase() === input.soloOperatorLogin.toLowerCase();
    const unexpectedBranchPolicies = input.existingCustomBranchPolicies
      .filter((name) => name !== input.defaultBranch);
    const checks = [
      check("soloOperator", soloOperatorMatches, "RELEASE_GOVERNANCE_SOLO_OPERATOR_MISMATCH"),
      check(
        "existingBranchPolicies",
        unexpectedBranchPolicies.length === 0,
        "RELEASE_GOVERNANCE_UNEXPECTED_BRANCH_POLICY",
      ),
      check(
        "applyConfirmation",
        !input.applyRequested || input.confirmation === RELEASE_GOVERNANCE_CONFIRMATION,
        "RELEASE_GOVERNANCE_CONFIRMATION_REQUIRED",
      ),
    ];
    const ok = checks.every(({ status }) => status === "pass");

    return {
      ok,
      mode: input.applyRequested ? "apply" : "dry-run",
      repository: input.repository,
      environment: "production",
      environmentExists: input.productionEnvironmentExists,
      defaultBranch: input.defaultBranch,
      approvalMode: "solo",
      soloOperatorLogin: input.soloOperatorLogin,
      checks,
      actions: ["upsertProductionEnvironment", "ensureDefaultBranchPolicy"],
      applyAuthorized: input.applyRequested && ok,
    };
  }
}
