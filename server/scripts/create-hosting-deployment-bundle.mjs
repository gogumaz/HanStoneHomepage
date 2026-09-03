import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { spawnSync } from "node:child_process";

const HASH = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const MAX_FILES = 50_000;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;
const REQUIRED_WEB_FILES = [
  "index.html",
  "app.html",
  "config.js",
  "payment/success.html",
  "payment/fail.html",
];
const DEPLOYMENT_FILES = [
  "docs/UZDREAM_PHPS_HOSTING_TEST_MANUAL.md",
  "deploy/README.md",
  "deploy/HOSTING_BOOTSTRAP.md",
  "deploy/HOSTING_BUNDLE.md",
  "deploy/HOSTING_INSTALL.md",
  "deploy/HOSTING_READINESS.md",
  "deploy/HOSTING_VERIFY.md",
  "deploy/bootstrap-static-host.sh",
  "deploy/check-host-readiness.sh",
  "deploy/install-hosting-release.py",
  "deploy/verify-hosting-release.py",
  "deploy/compose.production.yaml",
  "deploy/production.env.example",
  "deploy/clamav/Dockerfile",
  "deploy/nginx/README.md",
  "deploy/nginx/conf.d/hanstone-cache-map.conf",
  "deploy/nginx/sites-available/hanstone-bootstrap.conf",
  "deploy/nginx/sites-available/hanstone.conf",
  "deploy/nginx/snippets/hanstone-api-proxy.conf",
  "deploy/nginx/snippets/hanstone-security-headers.conf",
];
const FORBIDDEN_NAMES = new Set([
  ".env",
  ".env.local",
  ".npmrc",
  "id_rsa",
  "id_ed25519",
]);
const FORBIDDEN_SUFFIXES = [".pem", ".key", ".p12", ".pfx"];
const SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/u,
  /\bAKIA[A-Z0-9]{16}\b/u,
  /\b(?:live|test)_gsk_[A-Za-z0-9_-]{20,}\b/u,
];

function fail(code) {
  const error = new Error(code);
  error.name = code;
  throw error;
}

function usage() {
  process.stdout.write(`Usage:\n  npm run bundle:hosting -- [--output artifacts/name.tgz]\n\n`);
  process.stdout.write(`Creates a production deployment bundle only from a clean Git candidate.\n`);
  process.stdout.write(`A valid default bundle for the current commit is reused without overwriting it.\n`);
  process.stdout.write(`A custom output must be a new .tgz file below the project's artifacts directory.\n`);
}

function parseArguments(argv) {
  let output = null;
  let projectRoot = process.cwd();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "-h" || argument === "--help") return { help: true };
    if (argument === "--output" || argument === "--project-root") {
      const value = argv[index + 1];
      if (!value) fail("HOSTING_BUNDLE_ARGUMENTS_INVALID");
      if (argument === "--output") output = value;
      else projectRoot = value;
      index += 1;
      continue;
    }
    fail("HOSTING_BUNDLE_ARGUMENTS_INVALID");
  }
  return { help: false, output, projectRoot: resolve(projectRoot) };
}

function normalizedRelative(root, path) {
  return relative(root, path).split(sep).join("/");
}

function inside(root, path) {
  const candidate = relative(root, path);
  return candidate !== "" && !isAbsolute(candidate) && candidate !== ".." && !candidate.startsWith(`..${sep}`);
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.error || result.status !== 0) fail("HOSTING_BUNDLE_COMMAND_FAILED");
  return result.stdout.trim();
}

async function pathExists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

async function collectFiles(root) {
  const files = [];
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop();
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const path = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) fail("HOSTING_BUNDLE_SYMBOLIC_LINK_FORBIDDEN");
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile()) files.push(path);
      else fail("HOSTING_BUNDLE_SPECIAL_FILE_FORBIDDEN");
      if (files.length > MAX_FILES) fail("HOSTING_BUNDLE_FILE_LIMIT_EXCEEDED");
    }
  }
  return files;
}

async function sha256File(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

function validateSafeName(name) {
  const segments = name.split("/");
  if (!name || name.startsWith("/") || name.includes("\\") || segments.some(segment => !segment || segment === "." || segment === "..")) {
    fail("HOSTING_BUNDLE_PATH_INVALID");
  }
  const filename = segments.at(-1).toLowerCase();
  if (FORBIDDEN_NAMES.has(filename) || FORBIDDEN_SUFFIXES.some(suffix => filename.endsWith(suffix))) {
    fail("HOSTING_BUNDLE_SECRET_FILE_FORBIDDEN");
  }
}

async function validateTextSecrets(path, name) {
  if (name === "deploy/production.env.example") return;
  const bytes = await readFile(path);
  if (bytes.includes(0)) return;
  const source = bytes.toString("utf8");
  if (SECRET_PATTERNS.some(pattern => pattern.test(source))) fail("HOSTING_BUNDLE_SECRET_VALUE_FORBIDDEN");
}

function validateWebManifestShape(manifest, commitSha) {
  if (
    manifest?.schemaVersion !== 1
    || manifest?.ok !== true
    || manifest?.commitSha !== commitSha
    || !Array.isArray(manifest?.files)
    || !Number.isInteger(manifest?.totals?.files)
    || !Number.isInteger(manifest?.totals?.bytes)
  ) fail("HOSTING_BUNDLE_WEB_MANIFEST_INVALID");
}

async function verifyWebRelease(projectRoot, commitSha) {
  const webRoot = resolve(projectRoot, "dist");
  const manifestPath = resolve(webRoot, "web-deployment-manifest.json");
  if (!await pathExists(manifestPath)) fail("HOSTING_BUNDLE_WEB_MANIFEST_MISSING");

  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch {
    fail("HOSTING_BUNDLE_WEB_MANIFEST_INVALID");
  }
  validateWebManifestShape(manifest, commitSha);

  const paths = await collectFiles(webRoot);
  const actualNames = new Set(paths.map(path => normalizedRelative(webRoot, path)));
  if (REQUIRED_WEB_FILES.some(name => !actualNames.has(name))) fail("HOSTING_BUNDLE_WEB_ENTRYPOINT_MISSING");

  const listedNames = new Set();
  let totalBytes = 0;
  for (const entry of manifest.files) {
    if (
      !entry || typeof entry !== "object"
      || typeof entry.path !== "string"
      || typeof entry.sha256 !== "string" || !HASH.test(entry.sha256)
      || !Number.isInteger(entry.bytes) || entry.bytes < 0
      || typeof entry.contentType !== "string"
      || typeof entry.cacheControl !== "string"
    ) fail("HOSTING_BUNDLE_WEB_MANIFEST_INVALID");
    validateSafeName(entry.path);
    if (listedNames.has(entry.path)) fail("HOSTING_BUNDLE_WEB_MANIFEST_INVALID");
    listedNames.add(entry.path);
    const path = resolve(webRoot, ...entry.path.split("/"));
    if (!inside(webRoot, path) || !actualNames.has(entry.path)) fail("HOSTING_BUNDLE_WEB_FILE_MISSING");
    const contents = await readFile(path);
    if (contents.byteLength !== entry.bytes || await sha256File(path) !== entry.sha256) {
      fail("HOSTING_BUNDLE_WEB_FILE_MISMATCH");
    }
    totalBytes += contents.byteLength;
    if (totalBytes > MAX_TOTAL_BYTES) fail("HOSTING_BUNDLE_SIZE_LIMIT_EXCEEDED");
  }
  if (
    manifest.totals.files !== listedNames.size
    || manifest.totals.bytes !== totalBytes
    || [...actualNames].some(name => name !== "web-deployment-manifest.json" && !listedNames.has(name))
  ) fail("HOSTING_BUNDLE_WEB_MANIFEST_INVALID");

  return {
    webRoot,
    manifestPath,
    manifestSha256: await sha256File(manifestPath),
    files: paths,
  };
}

async function copyCheckedFile(source, destination, logicalName) {
  validateSafeName(logicalName);
  if (!await pathExists(source)) fail("HOSTING_BUNDLE_DEPLOYMENT_FILE_MISSING");
  const metadata = await lstat(source);
  if (!metadata.isFile() || metadata.isSymbolicLink()) fail("HOSTING_BUNDLE_DEPLOYMENT_FILE_INVALID");
  await validateTextSecrets(source, logicalName);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(source, destination);
  if (logicalName.endsWith(".sh")) await chmod(destination, 0o755);
}

async function reuseExistingBundle(projectRoot, output, checksumOutput, commitSha, webRelease) {
  try {
    const checksumParts = (await readFile(checksumOutput, "utf8")).trim().split(/\s+/u);
    const archiveSha256 = await sha256File(output);
    if (
      checksumParts.length !== 2
      || !HASH.test(checksumParts[0])
      || checksumParts[0] !== archiveSha256
      || checksumParts[1] !== basename(output)
    ) fail("HOSTING_BUNDLE_EXISTING_INVALID");

    let manifest;
    try {
      manifest = JSON.parse(run(
        "tar",
        ["-xOzf", output, "hanstone-hosting/DEPLOYMENT_BUNDLE_MANIFEST.json"],
        projectRoot,
      ));
    } catch {
      fail("HOSTING_BUNDLE_EXISTING_INVALID");
    }
    if (
      manifest?.schemaVersion !== 1
      || manifest?.kind !== "hanstone-hosting-deployment-bundle"
      || manifest?.ok !== true
      || manifest?.commitSha !== commitSha
      || manifest?.webDeploymentManifestSha256 !== webRelease.manifestSha256
      || manifest?.containsSecrets !== false
      || !Array.isArray(manifest?.files)
      || !Number.isInteger(manifest?.totals?.files)
      || !Number.isInteger(manifest?.totals?.bytes)
      || manifest.totals.files !== manifest.files.length
    ) fail("HOSTING_BUNDLE_EXISTING_INVALID");

    process.stdout.write(`${JSON.stringify({
      ok: true,
      reused: true,
      commitSha,
      output: normalizedRelative(projectRoot, output),
      checksumOutput: normalizedRelative(projectRoot, checksumOutput),
      archiveSha256,
      webDeploymentManifestSha256: webRelease.manifestSha256,
      fileCount: manifest.totals.files,
      totalBytes: manifest.totals.bytes,
    })}\n`);
  } catch (error) {
    if (error instanceof Error && error.name === "HOSTING_BUNDLE_EXISTING_INVALID") throw error;
    fail("HOSTING_BUNDLE_EXISTING_INVALID");
  }
}

async function createBundle() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    usage();
    return;
  }

  const projectRoot = options.projectRoot;
  const commitSha = run("git", ["rev-parse", "--verify", "HEAD"], projectRoot).toLowerCase();
  if (!COMMIT.test(commitSha)) fail("HOSTING_BUNDLE_COMMIT_INVALID");
  if (run("git", ["status", "--porcelain=v1", "--untracked-files=all"], projectRoot)) {
    fail("HOSTING_BUNDLE_GIT_DIRTY");
  }

  const artifactsRoot = resolve(projectRoot, "artifacts");
  const output = options.output
    ? resolve(projectRoot, options.output)
    : resolve(artifactsRoot, `hanstone-hosting-${commitSha.slice(0, 12)}.tgz`);
  if (!inside(artifactsRoot, output) || !basename(output).endsWith(".tgz")) {
    fail("HOSTING_BUNDLE_OUTPUT_PATH_INVALID");
  }
  const checksumOutput = `${output}.sha256`;
  const outputExists = await pathExists(output);
  const checksumExists = await pathExists(checksumOutput);
  if (outputExists || checksumExists) {
    if (options.output) fail("HOSTING_BUNDLE_OUTPUT_EXISTS");
    if (!outputExists || !checksumExists) fail("HOSTING_BUNDLE_EXISTING_INVALID");
    const webRelease = await verifyWebRelease(projectRoot, commitSha);
    await reuseExistingBundle(projectRoot, output, checksumOutput, commitSha, webRelease);
    return;
  }

  const webRelease = await verifyWebRelease(projectRoot, commitSha);
  const stagingRoot = await mkdtemp(join(tmpdir(), "hanstone-hosting-bundle-"));
  const payloadRoot = resolve(stagingRoot, "hanstone-hosting");
  let outputCreated = false;
  let checksumCreated = false;
  try {
    for (const source of webRelease.files) {
      const relativeName = normalizedRelative(webRelease.webRoot, source);
      await copyCheckedFile(source, resolve(payloadRoot, "web", ...relativeName.split("/")), `web/${relativeName}`);
    }
    for (const name of DEPLOYMENT_FILES) {
      await copyCheckedFile(resolve(projectRoot, ...name.split("/")), resolve(payloadRoot, ...name.split("/")), name);
    }

    const payloadFiles = await collectFiles(payloadRoot);
    let totalBytes = 0;
    const files = [];
    for (const path of payloadFiles.sort((left, right) => normalizedRelative(payloadRoot, left).localeCompare(normalizedRelative(payloadRoot, right)))) {
      const name = normalizedRelative(payloadRoot, path);
      const contents = await readFile(path);
      totalBytes += contents.byteLength;
      if (totalBytes > MAX_TOTAL_BYTES) fail("HOSTING_BUNDLE_SIZE_LIMIT_EXCEEDED");
      files.push({ path: name, bytes: contents.byteLength, sha256: await sha256File(path) });
    }

    const manifest = {
      schemaVersion: 1,
      kind: "hanstone-hosting-deployment-bundle",
      ok: true,
      commitSha,
      generatedAt: new Date().toISOString(),
      webDeploymentManifestSha256: webRelease.manifestSha256,
      containsSecrets: false,
      files,
      totals: { files: files.length, bytes: totalBytes },
    };
    await writeFile(
      resolve(payloadRoot, "DEPLOYMENT_BUNDLE_MANIFEST.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      { flag: "wx", mode: 0o600 },
    );

    await mkdir(dirname(output), { recursive: true });
    run("tar", ["-czf", output, "-C", stagingRoot, "hanstone-hosting"], projectRoot);
    outputCreated = true;
    const archiveSha256 = await sha256File(output);
    await writeFile(checksumOutput, `${archiveSha256}  ${basename(output)}\n`, { flag: "wx", mode: 0o600 });
    checksumCreated = true;
    process.stdout.write(`${JSON.stringify({
      ok: true,
      commitSha,
      output: normalizedRelative(projectRoot, output),
      checksumOutput: normalizedRelative(projectRoot, checksumOutput),
      archiveSha256,
      webDeploymentManifestSha256: webRelease.manifestSha256,
      fileCount: files.length,
      totalBytes,
    })}\n`);
  } catch (error) {
    if (checksumCreated || await pathExists(checksumOutput)) await rm(checksumOutput, { force: true });
    if (outputCreated || await pathExists(output)) await rm(output, { force: true });
    throw error;
  } finally {
    await rm(stagingRoot, { recursive: true, force: true });
  }
}

createBundle().catch(error => {
  const errorType = error instanceof Error && /^[A-Z][A-Z0-9_]{0,99}$/.test(error.name)
    ? error.name
    : "HOSTING_BUNDLE_FAILED";
  process.stderr.write(`${JSON.stringify({ ok: false, errorType })}\n`);
  process.exitCode = 1;
});
