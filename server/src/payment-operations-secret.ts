import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { open, realpath } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { PaymentOperationsEvidenceService } from "./operations/payment-operations-evidence.service.js";
import {
  PAYMENT_OPERATIONS_RELEASE_VARIABLE_NAME,
  PAYMENT_OPERATIONS_SECRET_NAME,
  PaymentOperationsSecretService,
} from "./operations/payment-operations-secret.service.js";
import { readReleaseEvidenceFile } from "./operations/release-evidence-file.js";

const execFileAsync = promisify(execFile);
const ghExecutable = process.platform === "win32" ? "gh.exe" : "gh";
const gitExecutable = process.platform === "win32" ? "git.exe" : "git";
const maxOutputBytes = 2 * 1024 * 1024;
const maxCaptureBytes = 1024 * 1024;

type Options = { apply: boolean; remove: boolean; confirmation: string | null };
type ProtectedCapture = { value: unknown; contents: Buffer; sha256: string };

function cliError(code: string): Error {
  const error = new Error(code);
  error.name = code;
  return error;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw cliError(`${name}_REQUIRED`);
  return value;
}

function integer(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value)) throw cliError(`${name}_INVALID`);
  return value;
}

function parseArguments(argv: string[]): Options {
  let apply = false;
  let remove = false;
  let confirmation: string | null = null;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--apply" && !apply) {
      apply = true;
      continue;
    }
    if (argument === "--remove" && !remove) {
      remove = true;
      continue;
    }
    if (argument === "--confirm" && confirmation === null) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw cliError("PAYMENT_SECRET_ARGUMENT_VALUE_REQUIRED");
      confirmation = value;
      index += 1;
      continue;
    }
    throw cliError("PAYMENT_SECRET_ARGUMENT_INVALID");
  }
  return { apply, remove, confirmation };
}

async function command(executable: string, args: string[], code: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync(executable, args, {
      encoding: "utf8", maxBuffer: maxOutputBytes, windowsHide: true,
    });
    return stdout;
  } catch {
    throw cliError(code);
  }
}

async function stdinCommand(executable: string, args: string[], value: string, code: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, stdio: ["pipe", "ignore", "ignore"] });
    child.once("error", () => reject(cliError(code)));
    child.once("close", (exitCode) => exitCode === 0 ? resolve() : reject(cliError(code)));
    child.stdin.end(value, "utf8");
  });
}

function json<T>(raw: string, code: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw cliError(code);
  }
}

async function resourceState(repository: string): Promise<{
  secretPresent: boolean;
  markerReleaseId: string | null;
}> {
  const [secrets, variables] = await Promise.all([
    command(ghExecutable, [
      "secret", "list", "--env", "production", "--repo", repository, "--json", "name",
    ], "GH_PAYMENT_SECRET_LIST_FAILED"),
    command(ghExecutable, [
      "variable", "list", "--env", "production", "--repo", repository, "--json", "name,value",
    ], "GH_PAYMENT_VARIABLE_LIST_FAILED"),
  ]);
  const secretEntries = json<Array<{ name?: unknown }>>(secrets, "GH_PAYMENT_SECRET_LIST_JSON_INVALID");
  const variableEntries = json<Array<{ name?: unknown; value?: unknown }>>(
    variables, "GH_PAYMENT_VARIABLE_LIST_JSON_INVALID",
  );
  const markers = variableEntries.filter(({ name }) => name === PAYMENT_OPERATIONS_RELEASE_VARIABLE_NAME);
  return {
    secretPresent: secretEntries.some(({ name }) => name === PAYMENT_OPERATIONS_SECRET_NAME),
    markerReleaseId: markers.length === 1 && typeof markers[0]?.value === "string" ? markers[0].value : null,
  };
}

async function protectedCapture(filePath: string): Promise<ProtectedCapture> {
  let resolvedFile: string;
  let handle;
  try {
    resolvedFile = await realpath(path.resolve(filePath));
    handle = await open(resolvedFile, "r");
  } catch {
    throw cliError("PAYMENT_SECRET_CAPTURE_FILE_UNAVAILABLE");
  }
  try {
    const fileStat = await handle.stat();
    if (!fileStat.isFile() || fileStat.size === 0 || fileStat.size > maxCaptureBytes) {
      throw cliError("PAYMENT_SECRET_CAPTURE_FILE_INVALID");
    }

    const repositoryRoot = path.resolve((await command(
      gitExecutable, ["rev-parse", "--show-toplevel"], "PAYMENT_SECRET_GIT_ROOT_READ_FAILED",
    )).trim());
    const relative = path.relative(repositoryRoot, resolvedFile);
    if (relative !== "" && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) {
      try {
        await execFileAsync(gitExecutable, ["check-ignore", "-q", "--", relative], {
          cwd: repositoryRoot, windowsHide: true,
        });
      } catch {
        throw cliError("PAYMENT_SECRET_CAPTURE_FILE_NOT_IGNORED");
      }
    }

    const contents = await handle.readFile();
    const finalStat = await handle.stat();
    if (contents.byteLength === 0 || contents.byteLength > maxCaptureBytes ||
        contents.byteLength !== fileStat.size || finalStat.size !== fileStat.size ||
        finalStat.mtimeMs !== fileStat.mtimeMs) {
      contents.fill(0);
      throw cliError("PAYMENT_SECRET_CAPTURE_FILE_INVALID");
    }
    const text = contents.toString("utf8");
    if (text.includes("\u0000") || text.includes("\uFFFD")) {
      contents.fill(0);
      throw cliError("PAYMENT_SECRET_CAPTURE_FILE_INVALID");
    }
    try {
      return {
        value: JSON.parse(text) as unknown,
        contents,
        sha256: createHash("sha256").update(contents).digest("hex"),
      };
    } catch {
      contents.fill(0);
      throw cliError("PAYMENT_SECRET_CAPTURE_JSON_INVALID");
    }
  } finally {
    await handle.close();
  }
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const repositoryInfo = json<{ nameWithOwner?: unknown; defaultBranchRef?: { name?: unknown } | null }>(
    await command(
      ghExecutable, ["repo", "view", "--json", "nameWithOwner,defaultBranchRef"], "GH_REPOSITORY_READ_FAILED",
    ),
    "GH_REPOSITORY_JSON_INVALID",
  );
  const actor = json<{ login?: unknown }>(
    await command(ghExecutable, ["api", "user"], "GH_AUTHENTICATED_USER_READ_FAILED"),
    "GH_AUTHENTICATED_USER_JSON_INVALID",
  );
  if (typeof repositoryInfo.nameWithOwner !== "string" ||
      typeof repositoryInfo.defaultBranchRef?.name !== "string" || typeof actor.login !== "string") {
    throw cliError("PAYMENT_SECRET_METADATA_INVALID");
  }
  const repository = repositoryInfo.nameWithOwner;
  const releaseId = required("PAYMENT_EVIDENCE_RELEASE_ID");
  const state = await resourceState(repository);
  let capture: ProtectedCapture | null = null;
  try {
    let evidence = null;
    let localCommitSha: string | null = null;
    let remoteDefaultCommitSha: string | null = null;
    if (!options.remove) {
      const preflight = await readReleaseEvidenceFile(
        "preflight", required("PAYMENT_EVIDENCE_PREFLIGHT_REPORT"),
      );
      capture = await protectedCapture(required("PAYMENT_EVIDENCE_CAPTURE_REPORT"));
      evidence = new PaymentOperationsEvidenceService().run({
        releaseId,
        preflight: preflight.value,
        capture: capture.value,
        preflightSha256: preflight.sha256,
        captureSha256: capture.sha256,
        maximumAgeHours: integer("PAYMENT_EVIDENCE_MAX_AGE_HOURS", 24),
      });
      [localCommitSha, remoteDefaultCommitSha] = await Promise.all([
        command(gitExecutable, ["rev-parse", "HEAD"], "PAYMENT_SECRET_GIT_HEAD_READ_FAILED"),
        command(ghExecutable, [
          "api", `repos/${repository}/commits/${encodeURIComponent(repositoryInfo.defaultBranchRef.name)}`,
          "--jq", ".sha",
        ], "PAYMENT_SECRET_REMOTE_HEAD_READ_FAILED"),
      ]).then((values) => values.map((value) => value.trim()) as [string, string]);
    }
    const report = new PaymentOperationsSecretService().plan({
      repository,
      actorLogin: actor.login,
      releaseId,
      localCommitSha,
      remoteDefaultCommitSha,
      action: options.remove ? "remove" : "stage",
      ...state,
      evidence,
      applyRequested: options.apply,
      confirmation: options.confirmation,
    });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.ok) {
      process.exitCode = 1;
      return;
    }
    if (!report.applyAuthorized) return;

    if (report.action === "stage") {
      if (!capture) throw cliError("PAYMENT_SECRET_CAPTURE_MISSING");
      let secretSet = false;
      try {
        await stdinCommand(ghExecutable, [
          "secret", "set", PAYMENT_OPERATIONS_SECRET_NAME,
          "--env", "production", "--repo", repository,
        ], capture.contents.toString("base64"), "GH_PAYMENT_SECRET_SET_FAILED");
        secretSet = true;
        await stdinCommand(ghExecutable, [
          "variable", "set", PAYMENT_OPERATIONS_RELEASE_VARIABLE_NAME,
          "--env", "production", "--repo", repository,
        ], releaseId, "GH_PAYMENT_VARIABLE_SET_FAILED");
      } catch (error) {
        if (secretSet) {
          try {
            await execFileAsync(ghExecutable, [
              "secret", "delete", PAYMENT_OPERATIONS_SECRET_NAME,
              "--env", "production", "--repo", repository,
            ], { windowsHide: true });
          } catch {
            throw cliError("GH_PAYMENT_SECRET_ROLLBACK_FAILED");
          }
        }
        throw error;
      }
    } else {
      if (state.secretPresent) await command(ghExecutable, [
        "secret", "delete", PAYMENT_OPERATIONS_SECRET_NAME,
        "--env", "production", "--repo", repository,
      ], "GH_PAYMENT_SECRET_DELETE_FAILED");
      await command(ghExecutable, [
        "variable", "delete", PAYMENT_OPERATIONS_RELEASE_VARIABLE_NAME,
        "--env", "production", "--repo", repository,
      ], "GH_PAYMENT_VARIABLE_DELETE_FAILED");
    }

    const verified = await resourceState(repository);
    const applied = report.action === "stage"
      ? verified.secretPresent && verified.markerReleaseId === releaseId
      : !verified.secretPresent && verified.markerReleaseId === null;
    if (!applied) throw cliError("GH_PAYMENT_SECRET_VERIFY_FAILED");
    process.stdout.write(`${JSON.stringify({
      applied: true,
      action: report.action,
      releaseId,
      secretPresent: verified.secretPresent,
      markerPresent: verified.markerReleaseId !== null,
    })}\n`);
  } finally {
    capture?.contents.fill(0);
  }
}

main().catch((error: unknown) => {
  const errorType = error instanceof Error && /^[A-Z][A-Z0-9_]{0,99}$/u.test(error.name)
    ? error.name : "PAYMENT_SECRET_CONFIGURATION_FAILED";
  process.stderr.write(`${JSON.stringify({ ok: false, errorType })}\n`);
  process.exitCode = 1;
});
