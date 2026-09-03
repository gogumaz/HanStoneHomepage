import { execFile, spawn } from "node:child_process";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { SOLO_RELEASE_OPERATOR_LOGIN } from "./common/release-approval-policy.js";
import {
  RELEASE_SECRET_NAMES,
  ReleaseSecretSetupService,
  type ReleaseSecretName,
} from "./operations/release-secret-setup.service.js";
import {
  REQUIRED_PRODUCTION_SECRETS,
  REQUIRED_REPOSITORY_SECRETS,
} from "./operations/release-readiness.service.js";

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

async function secretCommand(args: string[], value: string, code: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(ghExecutable, args, { windowsHide: true, stdio: ["pipe", "ignore", "ignore"] });
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
      if (!value || value.startsWith("--")) throw cliError("RELEASE_SECRET_ARGUMENT_VALUE_REQUIRED");
      confirmation = value;
      index += 1;
      continue;
    }
    throw cliError("RELEASE_SECRET_ARGUMENT_INVALID");
  }
  return { apply, confirmation };
}

async function protectedPreflightFileValue(filePath: string | undefined): Promise<string | undefined> {
  if (!filePath) return undefined;
  let resolvedFile: string;
  let fileStat;
  try {
    resolvedFile = await realpath(path.resolve(filePath));
    fileStat = await stat(resolvedFile);
  } catch {
    throw cliError("RELEASE_SECRET_PREFLIGHT_FILE_UNAVAILABLE");
  }
  if (!fileStat.isFile() || fileStat.size === 0 || fileStat.size > 256 * 1024) {
    throw cliError("RELEASE_SECRET_PREFLIGHT_FILE_INVALID");
  }

  const repositoryRoot = path.resolve((await command(
    gitExecutable,
    ["rev-parse", "--show-toplevel"],
    "RELEASE_SECRET_GIT_ROOT_READ_FAILED",
  )).trim());
  const relative = path.relative(repositoryRoot, resolvedFile);
  if (relative !== "" && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) {
    try {
      await execFileAsync(gitExecutable, ["check-ignore", "-q", "--", relative], {
        cwd: repositoryRoot,
        windowsHide: true,
      });
    } catch {
      throw cliError("RELEASE_SECRET_PREFLIGHT_FILE_NOT_IGNORED");
    }
  }
  return (await readFile(resolvedFile)).toString("base64");
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const repositoryInfo = json<{ nameWithOwner?: unknown }>(
    await command(ghExecutable, ["repo", "view", "--json", "nameWithOwner"], "GH_REPOSITORY_READ_FAILED"),
    "GH_REPOSITORY_JSON_INVALID",
  );
  const actor = json<{ login?: unknown }>(
    await command(ghExecutable, ["api", "user"], "GH_AUTHENTICATED_USER_READ_FAILED"),
    "GH_AUTHENTICATED_USER_JSON_INVALID",
  );
  if (typeof repositoryInfo.nameWithOwner !== "string" || typeof actor.login !== "string") {
    throw cliError("RELEASE_SECRET_METADATA_INVALID");
  }

  const values: Partial<Record<ReleaseSecretName, string>> = {};
  for (const name of RELEASE_SECRET_NAMES) {
    if (name === "PRODUCTION_PREFLIGHT_ENV_FILE_BASE64") continue;
    const value = process.env[name];
    if (value) values[name] = value;
  }
  const preflightValue = await protectedPreflightFileValue(process.env.PRODUCTION_PREFLIGHT_ENV_FILE);
  if (preflightValue) values.PRODUCTION_PREFLIGHT_ENV_FILE_BASE64 = preflightValue;

  const report = new ReleaseSecretSetupService().plan({
    repository: repositoryInfo.nameWithOwner,
    actorLogin: actor.login,
    values,
    applyRequested: options.apply,
    confirmation: options.confirmation,
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) {
    process.exitCode = 1;
    return;
  }
  if (!report.applyAuthorized) return;

  for (const name of REQUIRED_REPOSITORY_SECRETS) {
    await secretCommand(
      ["secret", "set", name, "--repo", repositoryInfo.nameWithOwner],
      values[name] ?? "",
      "GH_REPOSITORY_SECRET_SET_FAILED",
    );
  }
  for (const name of REQUIRED_PRODUCTION_SECRETS) {
    await secretCommand(
      ["secret", "set", name, "--env", "production", "--repo", repositoryInfo.nameWithOwner],
      values[name] ?? "",
      "GH_PRODUCTION_SECRET_SET_FAILED",
    );
  }

  const repositorySecrets = json<Array<{ name?: unknown }>>(
    await command(
      ghExecutable,
      ["secret", "list", "--repo", repositoryInfo.nameWithOwner, "--json", "name"],
      "GH_REPOSITORY_SECRET_VERIFY_FAILED",
    ),
    "GH_REPOSITORY_SECRET_VERIFY_JSON_INVALID",
  );
  const productionSecrets = json<Array<{ name?: unknown }>>(
    await command(
      ghExecutable,
      ["secret", "list", "--env", "production", "--repo", repositoryInfo.nameWithOwner, "--json", "name"],
      "GH_PRODUCTION_SECRET_VERIFY_FAILED",
    ),
    "GH_PRODUCTION_SECRET_VERIFY_JSON_INVALID",
  );
  const repositoryNames = new Set(repositorySecrets.flatMap(({ name }) => typeof name === "string" ? [name] : []));
  const productionNames = new Set(productionSecrets.flatMap(({ name }) => typeof name === "string" ? [name] : []));
  const verified = REQUIRED_REPOSITORY_SECRETS.every((name) => repositoryNames.has(name))
    && REQUIRED_PRODUCTION_SECRETS.every((name) => productionNames.has(name));
  if (!verified) throw cliError("GH_RELEASE_SECRET_VERIFY_FAILED");
  process.stdout.write(`${JSON.stringify({
    applied: true,
    verified: true,
    operator: SOLO_RELEASE_OPERATOR_LOGIN,
    repositorySecretCount: REQUIRED_REPOSITORY_SECRETS.length,
    productionSecretCount: REQUIRED_PRODUCTION_SECRETS.length,
  })}\n`);
}

main().catch((error: unknown) => {
  const errorType = error instanceof Error && /^[A-Z][A-Z0-9_]{0,99}$/u.test(error.name)
    ? error.name
    : "RELEASE_SECRET_CONFIGURATION_FAILED";
  process.stderr.write(`${JSON.stringify({ ok: false, errorType })}\n`);
  process.exitCode = 1;
});
