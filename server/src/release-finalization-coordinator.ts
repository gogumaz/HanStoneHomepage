import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { SOLO_RELEASE_CONFIRMATION } from "./common/release-approval-policy.js";
import {
  ReleaseFinalizationCoordinatorService,
  type FinalizationEvidenceRun,
} from "./operations/release-finalization-coordinator.service.js";

const execFileAsync = promisify(execFile);
const ghExecutable = process.platform === "win32" ? "gh.exe" : "gh";
const gitExecutable = process.platform === "win32" ? "git.exe" : "git";
const maxOutputBytes = 2 * 1024 * 1024;

type GhRun = {
  databaseId: number;
  displayTitle: string;
  headSha: string;
  status: string;
  conclusion: string | null;
  createdAt: string;
};

function cliError(code: string): Error {
  const error = new Error(code);
  error.name = code;
  return error;
}

async function command(executable: string, args: string[], code: string, cwd?: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync(executable, args, {
      cwd,
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
      if (!value || value.startsWith("--")) throw cliError("RELEASE_FINALIZATION_ARGUMENT_VALUE_REQUIRED");
      confirmation = value;
      index += 1;
      continue;
    }
    throw cliError("RELEASE_FINALIZATION_ARGUMENT_INVALID");
  }
  return { apply, confirmation };
}

async function workflowRuns(repository: string, workflow: string, branch: string): Promise<GhRun[]> {
  return json<GhRun[]>(await command(ghExecutable, [
    "run", "list", "--repo", repository, "--workflow", workflow, "--branch", branch,
    "--limit", "30", "--json", "databaseId,displayTitle,headSha,status,conclusion,createdAt",
  ], "GH_RELEASE_FINALIZATION_RUN_LIST_FAILED"), "GH_RELEASE_FINALIZATION_RUN_JSON_INVALID");
}

async function findEvidenceFile(directory: string, fileName: string): Promise<string | null> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = await findEvidenceFile(entryPath, fileName);
      if (nested) return nested;
    } else if (entry.isFile() && entry.name === fileName) {
      return entryPath;
    }
  }
  return null;
}

async function evidenceRun(
  repository: string,
  run: GhRun | undefined,
  artifactName: string | null,
  fileName: string,
  temporaryRoot: string,
  relatedFileNames: readonly string[] = [],
): Promise<FinalizationEvidenceRun | null> {
  if (!run || artifactName === null) return null;
  const artifacts = json<{ artifacts?: Array<{
    name?: unknown;
    expired?: unknown;
    created_at?: unknown;
    expires_at?: unknown;
  }> }>(await command(
    ghExecutable,
    ["api", `repos/${repository}/actions/runs/${run.databaseId}/artifacts?per_page=100`],
    "GH_RELEASE_FINALIZATION_ARTIFACT_LIST_FAILED",
  ), "GH_RELEASE_FINALIZATION_ARTIFACT_JSON_INVALID");
  const matches = artifacts.artifacts?.filter(({ name }) => name === artifactName) ?? [];
  const artifact = matches.length === 1 ? matches[0] : undefined;
  const metadata = {
    artifactExpired: typeof artifact?.expired === "boolean" ? artifact.expired : null,
    artifactCreatedAt: typeof artifact?.created_at === "string" ? artifact.created_at : null,
    artifactExpiresAt: typeof artifact?.expires_at === "string" ? artifact.expires_at : null,
  };
  if (!artifact) return {
    runId: run.databaseId,
    artifactPresent: false,
    artifactExpired: null,
    artifactCreatedAt: null,
    artifactExpiresAt: null,
    report: null,
  };
  if (metadata.artifactExpired !== false) return {
    runId: run.databaseId,
    artifactPresent: true,
    ...metadata,
    report: null,
  };
  const downloadDirectory = path.join(temporaryRoot, String(run.databaseId));
  await command(ghExecutable, [
    "run", "download", String(run.databaseId), "--repo", repository,
    "--name", artifactName, "--dir", downloadDirectory,
  ], "GH_RELEASE_FINALIZATION_ARTIFACT_DOWNLOAD_FAILED");
  const evidencePath = await findEvidenceFile(downloadDirectory, fileName);
  if (!evidencePath) return { runId: run.databaseId, artifactPresent: true, ...metadata, report: null };
  let report: unknown = null;
  let reportSha256: string | null = null;
  try {
    const contents = await readFile(evidencePath);
    report = JSON.parse(contents.toString("utf8")) as unknown;
    reportSha256 = createHash("sha256").update(contents).digest("hex");
  } catch {
    report = null;
    reportSha256 = null;
  }
  const relatedReports: Record<string, unknown> = {};
  const relatedSha256: Record<string, string | null> = {};
  for (const relatedFileName of relatedFileNames) {
    const relatedPath = await findEvidenceFile(downloadDirectory, relatedFileName);
    if (!relatedPath) {
      relatedReports[relatedFileName] = null;
      relatedSha256[relatedFileName] = null;
      continue;
    }
    try {
      const contents = await readFile(relatedPath);
      relatedReports[relatedFileName] = JSON.parse(contents.toString("utf8")) as unknown;
      relatedSha256[relatedFileName] = createHash("sha256").update(contents).digest("hex");
    } catch {
      relatedReports[relatedFileName] = null;
      relatedSha256[relatedFileName] = null;
    }
  }
  return {
    runId: run.databaseId,
    artifactPresent: true,
    ...metadata,
    report,
    reportSha256,
    relatedReports,
    relatedSha256,
  };
}

function latest(runs: GhRun[], status: "active" | "success"): GhRun | undefined {
  return runs
    .filter((run) => status === "active"
      ? run.status !== "completed"
      : run.status === "completed" && run.conclusion === "success")
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0];
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
    throw cliError("RELEASE_FINALIZATION_METADATA_INVALID");
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
  const releaseId = process.env.RELEASE_ID?.trim() || null;
  const imageReference = process.env.RELEASE_IMAGE_REFERENCE?.trim() || null;
  const expectedTitles = {
    acceptance: releaseId ? `Release candidate acceptance · ${releaseId}` : null,
    verification: releaseId ? `Production deployment verification · ${releaseId}` : null,
    closeout: releaseId ? `Release closeout · ${releaseId}` : null,
  };
  const [allAcceptanceRuns, allVerificationRuns, allCloseoutRuns] = await Promise.all([
    workflowRuns(repository, "release-candidate-acceptance.yml", defaultBranch),
    workflowRuns(repository, "production-deployment-verification.yml", defaultBranch),
    workflowRuns(repository, "release-closeout.yml", defaultBranch),
  ]);
  const matching = (runs: GhRun[], title: string | null) => title === null ? [] : runs.filter(
    (run) => run.headSha.toLowerCase() === localCommitSha.toLowerCase() && run.displayTitle === title,
  );
  const acceptanceRuns = matching(allAcceptanceRuns, expectedTitles.acceptance);
  const verificationRuns = matching(allVerificationRuns, expectedTitles.verification);
  const closeoutRuns = matching(allCloseoutRuns, expectedTitles.closeout);
  const acceptanceSuccess = latest(acceptanceRuns, "success");
  const verificationSuccess = latest(verificationRuns, "success");
  const closeoutSuccess = latest(closeoutRuns, "success");
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "release-finalization-"));
  try {
    const acceptance = await evidenceRun(
      repository,
      acceptanceSuccess,
      releaseId && acceptanceSuccess ? `release-acceptance-${releaseId}-${acceptanceSuccess.databaseId}` : null,
      "release-acceptance.json",
      temporaryRoot,
      [
        "production-preflight.json",
        "recovery-drill.json",
        "staging-read-only-load-report.json",
        "staging-worker-soak-report.json",
        "staging-worker-controlled-load-report.json",
        "staging-worker-soak-execution.json",
        "staging-evidence-bundle.json",
        "web-deployment-manifest.json",
        "field-validation-report.json",
        "manifest.json",
      ],
    );
    const verification = await evidenceRun(
      repository,
      verificationSuccess,
      verificationSuccess ? `production-deployment-verification-${verificationSuccess.databaseId}` : null,
      "production-deployment-verification.json",
      temporaryRoot,
      ["transport-security-evidence.json", "mail-operations-evidence.json", "legal-approval-binding.json"],
    );
    const closeout = await evidenceRun(
      repository,
      closeoutSuccess,
      releaseId && closeoutSuccess ? `release-closeout-${releaseId}-${closeoutSuccess.databaseId}` : null,
      "release-closeout.json",
      temporaryRoot,
      [
        "release-acceptance.json",
        "production-deployment-verification.json",
        "transport-security-evidence.json",
        "mail-operations-evidence.json",
        "legal-approval-binding.json",
      ],
    );
    const maximumDelayRaw = process.env.RELEASE_CLOSEOUT_MAX_DELAY_HOURS?.trim() || "24";
    const report = new ReleaseFinalizationCoordinatorService().plan({
      repository,
      actorLogin: actor.login,
      defaultBranch,
      localCommitSha,
      remoteDefaultCommitSha,
      dirtyFileCount,
      releaseId,
      imageReference,
      registryHost: process.env.RELEASE_REGISTRY_HOST?.trim() || "ghcr.io",
      productionSecretNames: productionSecrets.flatMap(({ name }) => typeof name === "string" ? [name] : []),
      deploymentConfirmation: process.env.PRODUCTION_DEPLOYMENT_CONFIRMED?.trim() || null,
      maximumVerificationDelayHours: Number(maximumDelayRaw),
      acceptance,
      acceptanceActiveRunId: latest(acceptanceRuns, "active")?.databaseId ?? null,
      verification,
      verificationActiveRunId: latest(verificationRuns, "active")?.databaseId ?? null,
      closeout,
      closeoutActiveRunId: latest(closeoutRuns, "active")?.databaseId ?? null,
      applyRequested: options.apply,
      confirmation: options.confirmation,
    });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.ok) {
      process.exitCode = 1;
      return;
    }
    if (!report.applyAuthorized || report.action === null || !releaseId || !imageReference) return;
    if (report.action.kind === "verifyDeployment") {
      const imageDigest = imageReference.split("@")[1];
      if (!imageDigest) throw cliError("RELEASE_FINALIZATION_IMAGE_DIGEST_MISSING");
      if (!report.acceptanceRunId) throw cliError("RELEASE_FINALIZATION_ACCEPTANCE_RUN_ID_MISSING");
      await command(ghExecutable, [
        "workflow", "run", report.action.workflow, "--repo", repository, "--ref", defaultBranch,
        "--field", `release_id=${releaseId}`,
        "--field", `acceptance_run_id=${report.acceptanceRunId}`,
        "--field", `solo_release_confirmation=${SOLO_RELEASE_CONFIRMATION}`,
        "--field", `expected_commit_sha=${report.candidateCommitSha}`,
        "--field", `expected_image_digest=${imageDigest}`,
        "--field", `expected_web_manifest_sha256=${report.action.webManifestSha256}`,
        "--field", "samples=3",
      ], "GH_RELEASE_FINALIZATION_VERIFICATION_DISPATCH_FAILED");
    } else {
      if (!report.acceptanceRunId || !report.verificationRunId) {
        throw cliError("RELEASE_FINALIZATION_CLOSEOUT_RUN_ID_MISSING");
      }
      await command(ghExecutable, [
        "workflow", "run", report.action.workflow, "--repo", repository, "--ref", defaultBranch,
        "--field", `solo_release_confirmation=${SOLO_RELEASE_CONFIRMATION}`,
        "--field", `release_id=${releaseId}`,
        "--field", `candidate_commit_sha=${report.candidateCommitSha}`,
        "--field", `image_reference=${imageReference}`,
        "--field", `registry_host=${process.env.RELEASE_REGISTRY_HOST?.trim() || "ghcr.io"}`,
        "--field", `acceptance_run_id=${report.acceptanceRunId}`,
        "--field", `deployment_verification_run_id=${report.verificationRunId}`,
        "--field", `maximum_verification_delay_hours=${maximumDelayRaw}`,
      ], "GH_RELEASE_FINALIZATION_CLOSEOUT_DISPATCH_FAILED");
    }
    process.stdout.write(`${JSON.stringify({
      dispatched: true,
      action: report.action.kind,
      releaseId,
      candidateCommitSha: report.candidateCommitSha,
    })}\n`);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  const errorType = error instanceof Error && /^[A-Z][A-Z0-9_]{0,99}$/u.test(error.name)
    ? error.name
    : "RELEASE_FINALIZATION_COORDINATION_FAILED";
  process.stderr.write(`${JSON.stringify({ ok: false, errorType })}\n`);
  process.exitCode = 1;
});
