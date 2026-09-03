export const REQUIRED_RELEASE_WORKFLOWS = [
  "CI",
  "Release readiness audit",
  "Staging read-only load test",
  "Staging worker queue soak",
  "Release candidate acceptance",
  "Production deployment verification",
  "Release closeout",
  "Rollback rehearsal verification",
] as const;

export const REQUIRED_PRODUCTION_SECRETS = [
  "PRODUCTION_PREFLIGHT_ENV_FILE_BASE64",
  "PRODUCTION_DATABASE_URL",
  "RECOVERY_DATABASE_URL",
  "PRODUCTION_API_BASE_URL",
  "PRODUCTION_WEB_BASE_URL",
  "PRODUCTION_OPERATIONS_METRICS_TOKEN",
  "PRODUCTION_MAIL_BOUNCE_RESPONSE_BASE64",
  "PRODUCTION_MAIL_PROVIDER_EVENT_ID",
  "PRODUCTION_LEGAL_APPROVAL_EVIDENCE_BASE64",
] as const;

export const REQUIRED_REPOSITORY_SECRETS = [
  "RELEASE_READINESS_TOKEN",
  "STAGING_API_BASE_URL",
  "STAGING_OPERATIONS_METRICS_TOKEN",
  "ROLLBACK_DRILL_API_BASE_URL",
  "ROLLBACK_DRILL_WEB_BASE_URL",
  "ROLLBACK_DRILL_OPERATIONS_METRICS_TOKEN",
] as const;

export type ReleaseReadinessInput = {
  repository: string;
  defaultBranch: string;
  actorLogin: string;
  approvalMode: "solo";
  soloOperatorLogin: string;
  localCommitSha: string;
  remoteDefaultCommitSha: string | null;
  dirtyFileCount: number;
  workflows: Array<{ name: string; state: string }>;
  productionEnvironmentExists: boolean;
  productionReviewers: Array<{ type: "User" | "Team"; identity: string }>;
  productionPreventSelfReview: boolean;
  productionProtectedBranchesOnly: boolean;
  productionCustomDeploymentBranchNames: string[];
  productionSecretNames: string[];
  repositorySecretNames: string[];
};

export type ReleaseReadinessReport = {
  ok: boolean;
  checkedAt: string;
  repository: string;
  commitSha: string;
  checks: Array<{ name: string; status: "pass" | "fail"; code: string }>;
};

type ReadinessCheck = ReleaseReadinessReport["checks"][number];

function readinessError(code: string): Error {
  const error = new Error(code);
  error.name = code;
  return error;
}

function check(name: string, passed: boolean, code: string): ReadinessCheck {
  return { name, status: passed ? "pass" : "fail", code: passed ? "OK" : code };
}

function isRepositoryName(value: string): boolean {
  const parts = value.split("/");
  return parts.length === 2 && parts.every((part) => (
    /^[A-Za-z0-9_.-]{1,100}$/.test(part)
    && part !== "."
    && part !== ".."
  ));
}

export class ReleaseReadinessService {
  constructor(private readonly now: () => Date = () => new Date()) {}

  run(input: ReleaseReadinessInput): ReleaseReadinessReport {
    if (!isRepositoryName(input.repository)) {
      throw readinessError("RELEASE_READINESS_REPOSITORY_INVALID");
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,254}$/.test(input.defaultBranch) ||
        input.defaultBranch.includes("..") || input.defaultBranch.includes("//") ||
        input.defaultBranch.endsWith("/") || input.defaultBranch.endsWith(".")) {
      throw readinessError("RELEASE_READINESS_DEFAULT_BRANCH_INVALID");
    }
    if (!/^[a-fA-F0-9]{40}$/.test(input.localCommitSha)) {
      throw readinessError("RELEASE_READINESS_LOCAL_COMMIT_INVALID");
    }
    if (input.remoteDefaultCommitSha !== null && !/^[a-fA-F0-9]{40}$/.test(input.remoteDefaultCommitSha)) {
      throw readinessError("RELEASE_READINESS_REMOTE_COMMIT_INVALID");
    }
    if (!Number.isSafeInteger(input.dirtyFileCount) || input.dirtyFileCount < 0) {
      throw readinessError("RELEASE_READINESS_DIRTY_COUNT_INVALID");
    }
    if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,98}[A-Za-z0-9])?$/u.test(input.actorLogin)) {
      throw readinessError("RELEASE_READINESS_ACTOR_LOGIN_INVALID");
    }
    if (input.approvalMode !== "solo") {
      throw readinessError("RELEASE_READINESS_APPROVAL_MODE_INVALID");
    }
    if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,98}[A-Za-z0-9])?$/u.test(input.soloOperatorLogin)) {
      throw readinessError("RELEASE_READINESS_SOLO_OPERATOR_INVALID");
    }
    if (input.productionReviewers.some(({ type, identity }) => (
      (type !== "User" && type !== "Team")
      || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,98}[A-Za-z0-9])?$/u.test(identity)
    ))) {
      throw readinessError("RELEASE_READINESS_REVIEWER_INVALID");
    }

    const localCommitSha = input.localCommitSha.toLowerCase();
    const remoteCommitSha = input.remoteDefaultCommitSha?.toLowerCase() ?? null;
    const activeWorkflows = new Set(
      input.workflows.filter(({ state }) => state === "active").map(({ name }) => name),
    );
    const secretNames = new Set(input.productionSecretNames);
    const repositorySecretNames = new Set(input.repositorySecretNames);
    const customDeploymentBranchNames = new Set(input.productionCustomDeploymentBranchNames);
    const soloOperatorMatches = input.actorLogin.toLowerCase() === input.soloOperatorLogin.toLowerCase();
    const deploymentBranchPolicySafe = input.productionProtectedBranchesOnly || (
      customDeploymentBranchNames.size === 1 && customDeploymentBranchNames.has(input.defaultBranch)
    );
    const checks: ReadinessCheck[] = [
      check(
        "candidatePublished",
        remoteCommitSha === localCommitSha,
        remoteCommitSha === null ? "REMOTE_DEFAULT_COMMIT_UNAVAILABLE" : "LOCAL_REMOTE_COMMIT_MISMATCH",
      ),
      check("workingTree", input.dirtyFileCount === 0, "WORKING_TREE_NOT_CLEAN"),
      ...REQUIRED_RELEASE_WORKFLOWS.map((name) => check(
        `workflow:${name}`,
        activeWorkflows.has(name),
        "REQUIRED_WORKFLOW_NOT_ACTIVE",
      )),
      check("environment:production", input.productionEnvironmentExists, "PRODUCTION_ENVIRONMENT_MISSING"),
      check(
        "environment:production:reviewers",
        input.productionEnvironmentExists && input.productionReviewers.length === 0,
        "PRODUCTION_SOLO_REVIEWERS_PRESENT",
      ),
      check(
        "environment:production:soloOperator",
        soloOperatorMatches,
        "PRODUCTION_SOLO_OPERATOR_MISMATCH",
      ),
      check(
        "environment:production:preventSelfReview",
        input.productionEnvironmentExists && input.productionReviewers.length === 0 && !input.productionPreventSelfReview,
        "PRODUCTION_SOLO_SELF_REVIEW_POLICY_INVALID",
      ),
      check(
        "environment:production:deploymentBranch",
        input.productionEnvironmentExists && deploymentBranchPolicySafe,
        "PRODUCTION_DEPLOYMENT_BRANCH_POLICY_UNSAFE",
      ),
      ...REQUIRED_REPOSITORY_SECRETS.map((name) => check(
        `secret:repository:${name}`,
        repositorySecretNames.has(name),
        "REPOSITORY_SECRET_MISSING",
      )),
      ...REQUIRED_PRODUCTION_SECRETS.map((name) => check(
        `secret:${name}`,
        input.productionEnvironmentExists && secretNames.has(name),
        "PRODUCTION_SECRET_MISSING",
      )),
    ];

    return {
      ok: checks.every(({ status }) => status === "pass"),
      checkedAt: this.now().toISOString(),
      repository: input.repository,
      commitSha: localCommitSha,
      checks,
    };
  }
}
