import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  StagingEvidenceCoordinatorService,
  type StagingEvidenceRun,
} from "./operations/staging-evidence-coordinator.service.js";

const execFileAsync = promisify(execFile);
const ghExecutable = process.platform === "win32" ? "gh.exe" : "gh";
const gitExecutable = process.platform === "win32" ? "git.exe" : "git";
const maxOutputBytes = 2 * 1024 * 1024;

function cliError(code: string): Error {
  const error = new Error(code);
  error.name = code;
  return error;
}

async function command(executable: string, args: string[], code: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync(executable, args, {
      encoding: "utf8",
      maxBuffer: maxOutputBytes,
      windowsHide: true,
    });
    return stdout;
  } catch {
    throw cliError(code);
  }
}

function json<T>(raw: string, code: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw cliError(code);
  }
}

function parseArguments(argv: string[]): { apply: boolean; confirmation: string | null } {
  let apply = false;
  let confirmation: string | null = null;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--apply") {
      apply = true;
      continue;
    }
    if (argument === "--confirm") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw cliError("STAGING_EVIDENCE_ARGUMENT_VALUE_REQUIRED");
      confirmation = value;
      index += 1;
      continue;
    }
    throw cliError("STAGING_EVIDENCE_ARGUMENT_INVALID");
  }
  return { apply, confirmation };
}

async function listRuns(repository: string, workflowFile: string, branch: string): Promise<StagingEvidenceRun[]> {
  const raw = await command(ghExecutable, [
    "run", "list",
    "--repo", repository,
    "--workflow", workflowFile,
    "--branch", branch,
    "--event", "workflow_dispatch",
    "--limit", "30",
    "--json", "databaseId,workflowName,headSha,status,conclusion,createdAt",
  ], "GH_STAGING_EVIDENCE_RUN_LIST_FAILED");
  return json<StagingEvidenceRun[]>(raw, "GH_STAGING_EVIDENCE_RUN_JSON_INVALID");
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const repositoryInfo = json<{
    nameWithOwner?: unknown;
    defaultBranchRef?: { name?: unknown } | null;
  }>(
    await command(
      ghExecutable,
      ["repo", "view", "--json", "nameWithOwner,defaultBranchRef"],
      "GH_REPOSITORY_READ_FAILED",
    ),
    "GH_REPOSITORY_JSON_INVALID",
  );
  const actor = json<{ login?: unknown }>(
    await command(ghExecutable, ["api", "user"], "GH_AUTHENTICATED_USER_READ_FAILED"),
    "GH_AUTHENTICATED_USER_JSON_INVALID",
  );
  if (typeof repositoryInfo.nameWithOwner !== "string"
      || typeof repositoryInfo.defaultBranchRef?.name !== "string"
      || typeof actor.login !== "string") {
    throw cliError("STAGING_EVIDENCE_METADATA_INVALID");
  }
  const repository = repositoryInfo.nameWithOwner;
  const defaultBranch = repositoryInfo.defaultBranchRef.name;
  const remoteDefaultCommitSha = (await command(
    ghExecutable,
    ["api", `repos/${repository}/commits/${encodeURIComponent(defaultBranch)}`, "--jq", ".sha"],
    "GH_DEFAULT_COMMIT_READ_FAILED",
  )).trim();
  const localCommitSha = (await command(gitExecutable, ["rev-parse", "HEAD"], "GIT_HEAD_READ_FAILED")).trim();
  const dirtyFiles = (await command(
    gitExecutable,
    ["status", "--porcelain", "--untracked-files=all"],
    "GIT_STATUS_READ_FAILED",
  )).split(/\r?\n/u).filter(Boolean);
  const repositorySecrets = json<Array<{ name?: unknown }>>(
    await command(
      ghExecutable,
      ["secret", "list", "--repo", repository, "--json", "name"],
      "GH_REPOSITORY_SECRET_LIST_FAILED",
    ),
    "GH_REPOSITORY_SECRET_LIST_JSON_INVALID",
  );
  const workflowFiles = ["staging-read-only-load.yml", "staging-worker-soak.yml"];
  const runs = (await Promise.all(workflowFiles.map((file) => listRuns(repository, file, defaultBranch)))).flat();
  const report = new StagingEvidenceCoordinatorService().plan({
    repository,
    actorLogin: actor.login,
    defaultBranch,
    localCommitSha,
    remoteDefaultCommitSha,
    dirtyFileCount: dirtyFiles.length,
    repositorySecretNames: repositorySecrets.flatMap(({ name }) => typeof name === "string" ? [name] : []),
    runs,
    applyRequested: options.apply,
    confirmation: options.confirmation,
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) {
    process.exitCode = 1;
    return;
  }
  if (!report.applyAuthorized) return;

  const evidenceId = `staging-${report.candidateCommitSha.slice(0, 12)}-${Date.now()}`;
  for (const action of report.actions) {
    await command(ghExecutable, [
      "workflow", "run", action.file,
      "--repo", repository,
      "--ref", defaultBranch,
      "--field", `evidence_id=${evidenceId}`,
    ], "GH_STAGING_EVIDENCE_DISPATCH_FAILED");
  }
  process.stdout.write(`${JSON.stringify({
    dispatched: true,
    evidenceId,
    candidateCommitSha: report.candidateCommitSha,
    workflows: report.actions.map(({ workflow }) => workflow),
    next: "Re-run this command without --apply to obtain run IDs and completion status.",
  })}\n`);
}

main().catch((error: unknown) => {
  const errorType = error instanceof Error && /^[A-Z][A-Z0-9_]{0,99}$/u.test(error.name)
    ? error.name
    : "STAGING_EVIDENCE_COORDINATION_FAILED";
  process.stderr.write(`${JSON.stringify({ ok: false, errorType })}\n`);
  process.exitCode = 1;
});
