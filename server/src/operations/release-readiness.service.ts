export const REQUIRED_RELEASE_WORKFLOWS = [
  "CI",
  "Release readiness audit",
  "Staging read-only load test",
  "Staging worker queue soak",
  "Release candidate acceptance",
  "Production deployment verification",
  "Release closeout",
] as const;

export const REQUIRED_PRODUCTION_SECRETS = [
  "PRODUCTION_PREFLIGHT_ENV_FILE_BASE64",
  "PRODUCTION_DATABASE_URL",
  "RECOVERY_DATABASE_URL",
  "PRODUCTION_API_BASE_URL",
  "PRODUCTION_WEB_BASE_URL",
  "PRODUCTION_OPERATIONS_METRICS_TOKEN",
] as const;

export const REQUIRED_REPOSITORY_SECRETS = [
  "RELEASE_READINESS_TOKEN",
] as const;

export type ReleaseReadinessInput = {
  repository: string;
  defaultBranch: string;
  localCommitSha: string;
  remoteDefaultCommitSha: string | null;
  dirtyFileCount: number;
  workflows: Array<{ name: string; state: string }>;
  productionEnvironmentExists: boolean;
  productionReviewerCount: number;
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
    if (!Number.isSafeInteger(input.productionReviewerCount) || input.productionReviewerCount < 0) {
      throw readinessError("RELEASE_READINESS_REVIEWER_COUNT_INVALID");
    }

    const localCommitSha = input.localCommitSha.toLowerCase();
    const remoteCommitSha = input.remoteDefaultCommitSha?.toLowerCase() ?? null;
    const activeWorkflows = new Set(
      input.workflows.filter(({ state }) => state === "active").map(({ name }) => name),
    );
    const secretNames = new Set(input.productionSecretNames);
    const repositorySecretNames = new Set(input.repositorySecretNames);
    const customDeploymentBranchNames = new Set(input.productionCustomDeploymentBranchNames);
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
        input.productionEnvironmentExists && input.productionReviewerCount > 0,
        "PRODUCTION_REVIEWER_MISSING",
      ),
      check(
        "environment:production:preventSelfReview",
        input.productionEnvironmentExists && input.productionReviewerCount > 0 && input.productionPreventSelfReview,
        "PRODUCTION_SELF_REVIEW_NOT_BLOCKED",
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
