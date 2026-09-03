import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  ROLLBACK_REHEARSAL_CONFIRMATION,
  RollbackRehearsalCoordinatorService,
  type RollbackRehearsalCoordinatorRun,
} from "./operations/rollback-rehearsal-coordinator.service.js";

const execFileAsync = promisify(execFile);
const gh = process.platform === "win32" ? "gh.exe" : "gh";
const git = process.platform === "win32" ? "git.exe" : "git";

function cliError(code: string): Error {
  const error = new Error(code);
  error.name = code;
  return error;
}

async function command(executable: string, args: string[], code: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync(executable, args, {
      encoding: "utf8", maxBuffer: 2 * 1024 * 1024, windowsHide: true,
    });
    return stdout;
  } catch {
    throw cliError(code);
  }
}

function json<T>(raw: string, code: string): T {
  try { return JSON.parse(raw) as T; } catch { throw cliError(code); }
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw cliError(`${name}_REQUIRED`);
  return value;
}

function runId(name: string): number {
  const value = Number(required(name));
  if (!Number.isSafeInteger(value) || value < 1) throw cliError(`${name}_INVALID`);
  return value;
}

function options(argv: string[]): { apply: boolean; confirmation: string | null } {
  let apply = false;
  let confirmation: string | null = null;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--apply") { apply = true; continue; }
    if (argv[index] === "--confirm" && argv[index + 1] && !argv[index + 1]!.startsWith("--")) {
      confirmation = argv[index + 1]!;
      index += 1;
      continue;
    }
    throw cliError("ROLLBACK_COORDINATOR_ARGUMENT_INVALID");
  }
  return { apply, confirmation };
}

async function artifactNames(repository: string, id: number): Promise<string[]> {
  const response = json<{ artifacts?: Array<{ name?: unknown }> }>(await command(
    gh, ["api", `repos/${repository}/actions/runs/${id}/artifacts?per_page=100`],
    "GH_ROLLBACK_COORDINATOR_ARTIFACT_LIST_FAILED",
  ), "GH_ROLLBACK_COORDINATOR_ARTIFACT_JSON_INVALID");
  return response.artifacts?.flatMap(({ name }) => typeof name === "string" ? [name] : []) ?? [];
}

async function sourceRun(repository: string, id: number): Promise<RollbackRehearsalCoordinatorRun> {
  const run = json<Omit<RollbackRehearsalCoordinatorRun, "artifactNames">>(await command(
    gh,
    ["run", "view", String(id), "--repo", repository,
      "--json", "databaseId,workflowName,displayTitle,headSha,status,conclusion"],
    "GH_ROLLBACK_COORDINATOR_RUN_READ_FAILED",
  ), "GH_ROLLBACK_COORDINATOR_RUN_JSON_INVALID");
  return { ...run, artifactNames: await artifactNames(repository, id) };
}

async function main(): Promise<void> {
  const option = options(process.argv.slice(2));
  const repositoryInfo = json<{ nameWithOwner?: unknown; defaultBranchRef?: { name?: unknown } | null }>(
    await command(gh, ["repo", "view", "--json", "nameWithOwner,defaultBranchRef"], "GH_REPOSITORY_READ_FAILED"),
    "GH_REPOSITORY_JSON_INVALID",
  );
  const actor = json<{ login?: unknown }>(
    await command(gh, ["api", "user"], "GH_AUTHENTICATED_USER_READ_FAILED"),
    "GH_AUTHENTICATED_USER_JSON_INVALID",
  );
  if (typeof repositoryInfo.nameWithOwner !== "string" || typeof repositoryInfo.defaultBranchRef?.name !== "string"
      || typeof actor.login !== "string") throw cliError("ROLLBACK_COORDINATOR_METADATA_INVALID");
  const repository = repositoryInfo.nameWithOwner;
  const branch = repositoryInfo.defaultBranchRef.name;
  const currentAcceptanceRunId = runId("ROLLBACK_REHEARSAL_CURRENT_ACCEPTANCE_RUN_ID");
  const targetCloseoutRunId = runId("ROLLBACK_REHEARSAL_TARGET_CLOSEOUT_RUN_ID");
  const [localCommitSha, remoteDefaultCommitSha, dirty, secretsRaw, workflowsRaw, currentRun, targetRun] =
    await Promise.all([
      command(git, ["rev-parse", "HEAD"], "GIT_HEAD_READ_FAILED"),
      command(gh, ["api", `repos/${repository}/commits/${encodeURIComponent(branch)}`, "--jq", ".sha"],
        "GH_DEFAULT_COMMIT_READ_FAILED"),
      command(git, ["status", "--porcelain", "--untracked-files=all"], "GIT_STATUS_READ_FAILED"),
      command(gh, ["secret", "list", "--repo", repository, "--json", "name"], "GH_SECRET_LIST_FAILED"),
      command(gh, ["workflow", "list", "--repo", repository, "--all", "--json", "name,state"],
        "GH_WORKFLOW_LIST_FAILED"),
      sourceRun(repository, currentAcceptanceRunId),
      sourceRun(repository, targetCloseoutRunId),
    ]);
  const secrets = json<Array<{ name?: unknown }>>(secretsRaw, "GH_SECRET_LIST_JSON_INVALID");
  const workflows = json<Array<{ name?: unknown; state?: unknown }>>(workflowsRaw, "GH_WORKFLOW_LIST_JSON_INVALID");
  const workflowActive = workflows.some(({ name, state }) =>
    name === "Rollback rehearsal verification" && state === "active");
  const rehearsalRaw = workflowActive ? await command(
    gh,
    ["run", "list", "--repo", repository, "--workflow", "rollback-rehearsal.yml",
      "--branch", branch, "--limit", "30",
      "--json", "databaseId,workflowName,displayTitle,headSha,status,conclusion"],
    "GH_ROLLBACK_COORDINATOR_RUN_LIST_FAILED",
  ) : "[]";
  const rehearsalRuns = json<Array<Omit<RollbackRehearsalCoordinatorRun, "artifactNames">>>(
    rehearsalRaw, "GH_ROLLBACK_COORDINATOR_RUN_LIST_JSON_INVALID",
  ).map((run) => ({ ...run, artifactNames: [] }));
  const report = new RollbackRehearsalCoordinatorService().plan({
    repository,
    actorLogin: actor.login,
    defaultBranch: branch,
    localCommitSha: localCommitSha.trim(),
    remoteDefaultCommitSha: remoteDefaultCommitSha.trim(),
    dirtyFileCount: dirty.split(/\r?\n/u).filter(Boolean).length,
    workflowActive,
    repositorySecretNames: secrets.flatMap(({ name }) => typeof name === "string" ? [name] : []),
    drillId: required("ROLLBACK_REHEARSAL_DRILL_ID"),
    currentReleaseId: required("ROLLBACK_REHEARSAL_CURRENT_RELEASE_ID"),
    currentAcceptanceRunId,
    targetReleaseId: required("ROLLBACK_REHEARSAL_TARGET_RELEASE_ID"),
    targetCloseoutRunId,
    runs: [currentRun, targetRun, ...rehearsalRuns],
    applyRequested: option.apply,
    confirmation: option.confirmation,
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) { process.exitCode = 1; return; }
  if (!report.applyAuthorized || !report.action || !report.drillId) return;
  await command(gh, [
    "workflow", "run", report.action.workflow, "--repo", repository, "--ref", branch,
    "--field", `confirmation=${ROLLBACK_REHEARSAL_CONFIRMATION}`,
    "--field", `drill_id=${report.drillId}`,
    "--field", `candidate_commit_sha=${report.candidateCommitSha}`,
    "--field", `current_release_id=${required("ROLLBACK_REHEARSAL_CURRENT_RELEASE_ID")}`,
    "--field", `current_acceptance_run_id=${currentAcceptanceRunId}`,
    "--field", `target_release_id=${required("ROLLBACK_REHEARSAL_TARGET_RELEASE_ID")}`,
    "--field", `target_closeout_run_id=${targetCloseoutRunId}`,
  ], "GH_ROLLBACK_COORDINATOR_DISPATCH_FAILED");
  process.stdout.write(`${JSON.stringify({ dispatched: true, drillId: report.drillId })}\n`);
}

main().catch((error: unknown) => {
  const errorType = error instanceof Error && /^[A-Z][A-Z0-9_]{0,119}$/u.test(error.name)
    ? error.name : "ROLLBACK_REHEARSAL_COORDINATION_FAILED";
  process.stderr.write(`${JSON.stringify({ ok: false, errorType })}\n`);
  process.exitCode = 1;
});
