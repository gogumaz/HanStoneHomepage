import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { SOLO_RELEASE_CONFIRMATION } from "./common/release-approval-policy.js";
import {
  ReleaseAcceptanceCoordinatorService,
  type ReleaseAcceptanceCoordinatorRun,
} from "./operations/release-acceptance-coordinator.service.js";

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
      if (!value || value.startsWith("--")) throw cliError("RELEASE_ACCEPTANCE_ARGUMENT_VALUE_REQUIRED");
      confirmation = value;
      index += 1;
      continue;
    }
    throw cliError("RELEASE_ACCEPTANCE_ARGUMENT_INVALID");
  }
  return { apply, confirmation };
}

type GhRun = Omit<ReleaseAcceptanceCoordinatorRun, "artifactNames">;

async function workflowRuns(repository: string, workflow: string, branch: string): Promise<GhRun[]> {
  return json<GhRun[]>(await command(ghExecutable, [
    "run", "list", "--repo", repository, "--workflow", workflow, "--branch", branch,
    "--limit", "30", "--json", "databaseId,workflowName,displayTitle,headSha,status,conclusion,createdAt",
  ], "GH_RELEASE_ACCEPTANCE_RUN_LIST_FAILED"), "GH_RELEASE_ACCEPTANCE_RUN_JSON_INVALID");
}

async function artifactNames(repository: string, runId: number): Promise<string[]> {
  const response = json<{ artifacts?: Array<{ name?: unknown }> }>(await command(
    ghExecutable,
    ["api", `repos/${repository}/actions/runs/${runId}/artifacts?per_page=100`],
    "GH_RELEASE_ACCEPTANCE_ARTIFACT_LIST_FAILED",
  ), "GH_RELEASE_ACCEPTANCE_ARTIFACT_JSON_INVALID");
  return response.artifacts?.flatMap(({ name }) => typeof name === "string" ? [name] : []) ?? [];
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const repositoryInfo = json<{ nameWithOwner?: unknown; defaultBranchRef?: { name?: unknown } | null }>(
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
    throw cliError("RELEASE_ACCEPTANCE_METADATA_INVALID");
  }
  const repository = repositoryInfo.nameWithOwner;
  const defaultBranch = repositoryInfo.defaultBranchRef.name;
  const localCommitSha = (await command(gitExecutable, ["rev-parse", "HEAD"], "GIT_HEAD_READ_FAILED")).trim();
  const remoteDefaultCommitSha = (await command(
    ghExecutable,
    ["api", `repos/${repository}/commits/${encodeURIComponent(defaultBranch)}`, "--jq", ".sha"],
    "GH_DEFAULT_COMMIT_READ_FAILED",
  )).trim();
  const dirtyFileCount = (await command(
    gitExecutable,
    ["status", "--porcelain", "--untracked-files=all"],
    "GIT_STATUS_READ_FAILED",
  )).split(/\r?\n/u).filter(Boolean).length;
  const productionSecrets = json<Array<{ name?: unknown }>>(await command(
    ghExecutable,
    ["secret", "list", "--repo", repository, "--env", "production", "--json", "name"],
    "GH_PRODUCTION_SECRET_LIST_FAILED",
  ), "GH_PRODUCTION_SECRET_LIST_JSON_INVALID");
  const workflowFiles = [
    "ci.yml",
    "staging-read-only-load.yml",
    "staging-worker-soak.yml",
    "release-candidate-acceptance.yml",
  ];
  const listedRuns = (await Promise.all(
    workflowFiles.map((file) => workflowRuns(repository, file, defaultBranch)),
  )).flat().filter(({ headSha }) => headSha.toLowerCase() === localCommitSha.toLowerCase());
  const runs: ReleaseAcceptanceCoordinatorRun[] = await Promise.all(listedRuns.map(async (run) => ({
    ...run,
    artifactNames: run.status === "completed" ? await artifactNames(repository, run.databaseId) : [],
  })));
  const report = new ReleaseAcceptanceCoordinatorService().plan({
    repository,
    actorLogin: actor.login,
    defaultBranch,
    localCommitSha,
    remoteDefaultCommitSha,
    dirtyFileCount,
    productionSecretNames: productionSecrets.flatMap(({ name }) => typeof name === "string" ? [name] : []),
    releaseId: process.env.RELEASE_ID?.trim() || null,
    imageReference: process.env.RELEASE_IMAGE_REFERENCE?.trim() || null,
    registryHost: process.env.RELEASE_REGISTRY_HOST?.trim() || "ghcr.io",
    backupCreatedAt: process.env.RECOVERY_BACKUP_CREATED_AT?.trim() || null,
    restoreStartedAt: process.env.RECOVERY_RESTORE_STARTED_AT?.trim() || null,
    runs,
    applyRequested: options.apply,
    confirmation: options.confirmation,
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) {
    process.exitCode = 1;
    return;
  }
  if (!report.applyAuthorized || report.action === null) return;

  const ciRunId = report.evidence.find(({ kind }) => kind === "ci")?.runId;
  const loadRunId = report.evidence.find(({ kind }) => kind === "readOnlyLoad")?.runId;
  const soakRunId = report.evidence.find(({ kind }) => kind === "workerSoak")?.runId;
  const releaseId = process.env.RELEASE_ID?.trim();
  const imageReference = process.env.RELEASE_IMAGE_REFERENCE?.trim();
  const backupCreatedAt = process.env.RECOVERY_BACKUP_CREATED_AT?.trim();
  const restoreStartedAt = process.env.RECOVERY_RESTORE_STARTED_AT?.trim();
  if (!ciRunId || !loadRunId || !soakRunId || !releaseId || !imageReference
      || !backupCreatedAt || !restoreStartedAt) {
    throw cliError("RELEASE_ACCEPTANCE_DISPATCH_INPUT_MISSING");
  }
  await command(ghExecutable, [
    "workflow", "run", report.action.file,
    "--repo", repository,
    "--ref", defaultBranch,
    "--field", `solo_release_confirmation=${SOLO_RELEASE_CONFIRMATION}`,
    "--field", `release_id=${releaseId}`,
    "--field", `candidate_commit_sha=${report.candidateCommitSha}`,
    "--field", `image_reference=${imageReference}`,
    "--field", `registry_host=${process.env.RELEASE_REGISTRY_HOST?.trim() || "ghcr.io"}`,
    "--field", `load_test_run_id=${loadRunId}`,
    "--field", `worker_soak_run_id=${soakRunId}`,
    "--field", `supply_chain_run_id=${ciRunId}`,
    "--field", `backup_created_at=${backupCreatedAt}`,
    "--field", `restore_started_at=${restoreStartedAt}`,
  ], "GH_RELEASE_ACCEPTANCE_DISPATCH_FAILED");
  process.stdout.write(`${JSON.stringify({
    dispatched: true,
    releaseId,
    candidateCommitSha: report.candidateCommitSha,
    evidenceRunIds: { ci: ciRunId, readOnlyLoad: loadRunId, workerSoak: soakRunId },
  })}\n`);
}

main().catch((error: unknown) => {
  const errorType = error instanceof Error && /^[A-Z][A-Z0-9_]{0,99}$/u.test(error.name)
    ? error.name
    : "RELEASE_ACCEPTANCE_COORDINATION_FAILED";
  process.stderr.write(`${JSON.stringify({ ok: false, errorType })}\n`);
  process.exitCode = 1;
});
