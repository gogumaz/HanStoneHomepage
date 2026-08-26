import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  ReleaseReadinessService,
  type ReleaseReadinessInput,
} from "./operations/release-readiness.service.js";

const execFileAsync = promisify(execFile);
const ghExecutable = process.platform === "win32" ? "gh.exe" : "gh";

function cliError(code: string): Error {
  const error = new Error(code);
  error.name = code;
  return error;
}

async function command(executable: string, args: string[], code: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync(executable, args, {
      encoding: "utf8",
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true,
    });
    return stdout;
  } catch {
    throw cliError(code);
  }
}

function json<T>(raw: string, code: string, fallback?: T): T {
  if (!raw.trim() && fallback !== undefined) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw cliError(code);
  }
}

async function main(): Promise<void> {
  const repositoryInfo = json<{
    nameWithOwner?: unknown;
    defaultBranchRef?: { name?: unknown } | null;
  }>(
    await command(ghExecutable, ["repo", "view", "--json", "nameWithOwner,defaultBranchRef"], "GH_REPOSITORY_READ_FAILED"),
    "GH_REPOSITORY_JSON_INVALID",
  );
  if (typeof repositoryInfo.nameWithOwner !== "string" ||
      typeof repositoryInfo.defaultBranchRef?.name !== "string") {
    throw cliError("GH_REPOSITORY_METADATA_INVALID");
  }
  const repository = repositoryInfo.nameWithOwner;
  const defaultBranch = repositoryInfo.defaultBranchRef.name;
  const localCommitSha = (await command("git", ["rev-parse", "HEAD"], "GIT_HEAD_READ_FAILED")).trim();
  const status = await command("git", ["status", "--porcelain=v1", "-z"], "GIT_STATUS_READ_FAILED");
  const dirtyFileCount = status ? status.split("\0").filter(Boolean).length : 0;
  const remoteDefaultCommitSha = (await command(
    ghExecutable,
    ["api", `repos/${repository}/commits/${encodeURIComponent(defaultBranch)}`, "--jq", ".sha"],
    "GH_REMOTE_COMMIT_READ_FAILED",
  )).trim();
  const workflows = json<Array<{ name: string; state: string }>>(
    await command(
      ghExecutable,
      ["workflow", "list", "--all", "--json", "name,state"],
      "GH_WORKFLOW_LIST_FAILED",
    ),
    "GH_WORKFLOW_JSON_INVALID",
    [],
  );
  const repositorySecrets = json<Array<{ name?: unknown }>>(
    await command(
      ghExecutable,
      ["secret", "list", "--json", "name"],
      "GH_REPOSITORY_SECRET_LIST_FAILED",
    ),
    "GH_REPOSITORY_SECRET_JSON_INVALID",
    [],
  );
  const repositorySecretNames = repositorySecrets.flatMap(
    ({ name }) => typeof name === "string" ? [name] : [],
  );
  const environments = json<{ environments?: Array<{ name?: unknown }> }>(
    await command(ghExecutable, ["api", `repos/${repository}/environments`], "GH_ENVIRONMENT_LIST_FAILED"),
    "GH_ENVIRONMENT_JSON_INVALID",
  );
  const productionEnvironmentExists = environments.environments?.some(({ name }) => name === "production") ?? false;
  let productionReviewerCount = 0;
  let productionPreventSelfReview = false;
  let productionProtectedBranchesOnly = false;
  let productionCustomDeploymentBranchNames: string[] = [];
  let productionSecretNames: string[] = [];
  if (productionEnvironmentExists) {
    const production = json<{
      protection_rules?: Array<{ type?: unknown; reviewers?: unknown[]; prevent_self_review?: unknown }>;
      deployment_branch_policy?: {
        protected_branches?: unknown;
        custom_branch_policies?: unknown;
      } | null;
    }>(
      await command(ghExecutable, ["api", `repos/${repository}/environments/production`], "GH_PRODUCTION_ENVIRONMENT_READ_FAILED"),
      "GH_PRODUCTION_ENVIRONMENT_JSON_INVALID",
    );
    const requiredReviewerRule = production.protection_rules
      ?.find(({ type }) => type === "required_reviewers");
    productionReviewerCount = requiredReviewerRule?.reviewers?.length ?? 0;
    productionPreventSelfReview = requiredReviewerRule?.prevent_self_review === true;
    productionProtectedBranchesOnly = production.deployment_branch_policy?.protected_branches === true;
    if (production.deployment_branch_policy?.custom_branch_policies === true) {
      const branchPolicies = json<{
        branch_policies?: Array<{ name?: unknown; type?: unknown }>;
      }>(
        await command(
          ghExecutable,
          ["api", `repos/${repository}/environments/production/deployment-branch-policies`],
          "GH_PRODUCTION_BRANCH_POLICY_LIST_FAILED",
        ),
        "GH_PRODUCTION_BRANCH_POLICY_JSON_INVALID",
      );
      productionCustomDeploymentBranchNames = branchPolicies.branch_policies?.flatMap(
        ({ name, type }) => typeof name === "string" && type === "branch" ? [name] : [],
      ) ?? [];
    }
    const secrets = json<Array<{ name?: unknown }>>(
      await command(
        ghExecutable,
        ["secret", "list", "--env", "production", "--json", "name"],
        "GH_PRODUCTION_SECRET_LIST_FAILED",
      ),
      "GH_PRODUCTION_SECRET_JSON_INVALID",
      [],
    );
    productionSecretNames = secrets.flatMap(({ name }) => typeof name === "string" ? [name] : []);
  }

  const input: ReleaseReadinessInput = {
    repository,
    defaultBranch,
    localCommitSha,
    remoteDefaultCommitSha: remoteDefaultCommitSha || null,
    dirtyFileCount,
    workflows,
    productionEnvironmentExists,
    productionReviewerCount,
    productionPreventSelfReview,
    productionProtectedBranchesOnly,
    productionCustomDeploymentBranchNames,
    productionSecretNames,
    repositorySecretNames,
  };
  const report = new ReleaseReadinessService().run(input);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
}

main().catch((error: unknown) => {
  const errorType = error instanceof Error && /^[A-Z][A-Z0-9_]{0,99}$/.test(error.name)
    ? error.name
    : "RELEASE_READINESS_AUDIT_FAILED";
  process.stderr.write(`${JSON.stringify({ ok: false, errorType })}\n`);
  process.exitCode = 1;
});
