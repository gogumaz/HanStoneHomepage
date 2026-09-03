import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import {
  ReleaseGovernanceService,
  type ReleaseGovernanceInput,
} from "./operations/release-governance.service.js";
import { SOLO_RELEASE_OPERATOR_LOGIN } from "./common/release-approval-policy.js";

const execFileAsync = promisify(execFile);
const ghExecutable = process.platform === "win32" ? "gh.exe" : "gh";
const maxOutputBytes = 2 * 1024 * 1024;

function cliError(code: string): Error {
  const error = new Error(code);
  error.name = code;
  return error;
}

async function command(args: string[], code: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync(ghExecutable, args, {
      encoding: "utf8",
      maxBuffer: maxOutputBytes,
      windowsHide: true,
    });
    return stdout;
  } catch {
    throw cliError(code);
  }
}

async function commandWithJsonInput(args: string[], input: unknown, code: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(ghExecutable, args, { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    const collect = (target: Buffer[], chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > maxOutputBytes) {
        child.kill();
        reject(cliError(code));
        return;
      }
      target.push(chunk);
    };
    child.stdout.on("data", (chunk: Buffer) => collect(stdout, chunk));
    child.stderr.on("data", (chunk: Buffer) => collect(stderr, chunk));
    child.once("error", () => reject(cliError(code)));
    child.once("close", (exitCode) => {
      if (exitCode !== 0 || stderr.length > 0) {
        reject(cliError(code));
        return;
      }
      resolve(Buffer.concat(stdout).toString("utf8"));
    });
    child.stdin.end(`${JSON.stringify(input)}\n`, "utf8");
  });
}

function json<T>(raw: string, code: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw cliError(code);
  }
}

function parseArguments(argv: string[]): { solo: boolean; apply: boolean; confirmation: string | null } {
  let solo = false;
  let apply = false;
  let confirmation: string | null = null;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--apply") {
      apply = true;
      continue;
    }
    if (argument === "--solo") {
      solo = true;
      continue;
    }
    if (argument === "--confirm") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw cliError("RELEASE_GOVERNANCE_ARGUMENT_VALUE_REQUIRED");
      confirmation = value;
      index += 1;
      continue;
    }
    throw cliError("RELEASE_GOVERNANCE_ARGUMENT_INVALID");
  }
  if (!solo) throw cliError("RELEASE_GOVERNANCE_SOLO_MODE_REQUIRED");
  return { solo, apply, confirmation };
}

async function branchPolicies(repository: string): Promise<string[]> {
  const response = json<{ branch_policies?: Array<{ name?: unknown; type?: unknown }> }>(
    await command(
      ["api", `repos/${repository}/environments/production/deployment-branch-policies`],
      "GH_PRODUCTION_BRANCH_POLICY_LIST_FAILED",
    ),
    "GH_PRODUCTION_BRANCH_POLICY_JSON_INVALID",
  );
  return response.branch_policies?.flatMap(
    ({ name, type }) => typeof name === "string" && type === "branch" ? [name] : [],
  ) ?? [];
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const repositoryInfo = json<{
    nameWithOwner?: unknown;
    defaultBranchRef?: { name?: unknown } | null;
  }>(
    await command(["repo", "view", "--json", "nameWithOwner,defaultBranchRef"], "GH_REPOSITORY_READ_FAILED"),
    "GH_REPOSITORY_JSON_INVALID",
  );
  const actor = json<{ login?: unknown; id?: unknown }>(
    await command(["api", "user"], "GH_AUTHENTICATED_USER_READ_FAILED"),
    "GH_AUTHENTICATED_USER_JSON_INVALID",
  );
  if (typeof repositoryInfo.nameWithOwner !== "string"
      || typeof repositoryInfo.defaultBranchRef?.name !== "string"
      || typeof actor.login !== "string"
      || typeof actor.id !== "number") {
    throw cliError("RELEASE_GOVERNANCE_METADATA_INVALID");
  }
  const repository = repositoryInfo.nameWithOwner;
  const defaultBranch = repositoryInfo.defaultBranchRef.name;
  const environments = json<{ environments?: Array<{ name?: unknown }> }>(
    await command(["api", `repos/${repository}/environments`], "GH_ENVIRONMENT_LIST_FAILED"),
    "GH_ENVIRONMENT_JSON_INVALID",
  );
  const productionEnvironmentExists = environments.environments?.some(({ name }) => name === "production") ?? false;
  let existingCustomBranchPolicies: string[] = [];
  if (productionEnvironmentExists) {
    const production = json<{
      deployment_branch_policy?: { custom_branch_policies?: unknown } | null;
    }>(
      await command(
        ["api", `repos/${repository}/environments/production`],
        "GH_PRODUCTION_ENVIRONMENT_READ_FAILED",
      ),
      "GH_PRODUCTION_ENVIRONMENT_JSON_INVALID",
    );
    if (production.deployment_branch_policy?.custom_branch_policies === true) {
      existingCustomBranchPolicies = await branchPolicies(repository);
    }
  }

  const input: ReleaseGovernanceInput = {
    repository,
    defaultBranch,
    actor: { login: actor.login, id: actor.id },
    soloOperatorLogin: SOLO_RELEASE_OPERATOR_LOGIN,
    productionEnvironmentExists,
    existingCustomBranchPolicies,
    applyRequested: options.apply,
    confirmation: options.confirmation,
  };
  const report = new ReleaseGovernanceService().plan(input);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) {
    process.exitCode = 1;
    return;
  }
  if (!report.applyAuthorized) return;

  await commandWithJsonInput(
    ["api", "--method", "PUT", `repos/${repository}/environments/production`, "--input", "-"],
    {
      wait_timer: 0,
      prevent_self_review: false,
      reviewers: [],
      deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
    },
    "GH_PRODUCTION_ENVIRONMENT_UPDATE_FAILED",
  );
  const policiesAfterEnvironmentUpdate = await branchPolicies(repository);
  if (!policiesAfterEnvironmentUpdate.includes(defaultBranch)) {
    await commandWithJsonInput(
      [
        "api",
        "--method",
        "POST",
        `repos/${repository}/environments/production/deployment-branch-policies`,
        "--input",
        "-",
      ],
      { name: defaultBranch, type: "branch" },
      "GH_PRODUCTION_BRANCH_POLICY_CREATE_FAILED",
    );
  }

  const production = json<{
    protection_rules?: Array<{
      type?: unknown;
      prevent_self_review?: unknown;
      reviewers?: Array<{ type?: unknown; reviewer?: { id?: unknown } | null }>;
    }>;
    deployment_branch_policy?: { protected_branches?: unknown; custom_branch_policies?: unknown } | null;
  }>(
    await command(["api", `repos/${repository}/environments/production`], "GH_PRODUCTION_ENVIRONMENT_VERIFY_FAILED"),
    "GH_PRODUCTION_ENVIRONMENT_VERIFY_JSON_INVALID",
  );
  const reviewerRule = production.protection_rules?.find(({ type }) => type === "required_reviewers");
  const policies = await branchPolicies(repository);
  const verified = (!reviewerRule || (reviewerRule.reviewers?.length ?? 0) === 0)
    && production.deployment_branch_policy?.protected_branches === false
    && production.deployment_branch_policy.custom_branch_policies === true
    && policies.length === 1
    && policies[0] === defaultBranch;
  if (!verified) throw cliError("GH_PRODUCTION_GOVERNANCE_VERIFY_FAILED");
  process.stdout.write(`${JSON.stringify({ applied: true, verified: true })}\n`);
}

main().catch((error: unknown) => {
  const errorType = error instanceof Error && /^[A-Z][A-Z0-9_]{0,99}$/u.test(error.name)
    ? error.name
    : "RELEASE_GOVERNANCE_CONFIGURATION_FAILED";
  process.stderr.write(`${JSON.stringify({ ok: false, errorType })}\n`);
  process.exitCode = 1;
});
