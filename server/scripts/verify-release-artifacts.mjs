import { readFile, readdir } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";

const MAX_FILES = 50_000;
const MAX_TEXT_FILE_BYTES = 10 * 1024 * 1024;
const forbiddenSuffixes = [
  ".map",
  ".ts",
  ".tsx",
  ".d.ts",
  ".pem",
  ".key",
  ".p12",
  ".pfx",
  ".tgz",
];
const forbiddenNames = new Set([".env", ".env.local", ".npmrc"]);
const profiles = {
  api: [
    "main.js",
    "account-mail-worker.js",
    "inquiry-notification-worker.js",
    "video-scan-worker.js",
    "video-cleanup-worker.js",
    "hls-transcode-worker.js",
  ],
  web: [
    "index.html",
    "app.html",
    "payment/success.html",
    "payment/fail.html",
  ],
};

function fail(code) {
  const error = new Error(code);
  error.name = code;
  throw error;
}

function parseArguments(argv) {
  if (argv.length !== 3 || argv[0] !== "--profile" || !(argv[1] in profiles)) {
    fail("ARTIFACT_VERIFIER_ARGUMENTS_INVALID");
  }
  return { profile: argv[1], directory: argv[2] };
}

function normalizePath(path) {
  return path.split(sep).join("/");
}

async function collectFiles(root) {
  const files = [];
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop();
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const path = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) fail("ARTIFACT_SYMBOLIC_LINK_FORBIDDEN");
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile()) files.push(path);
      else fail("ARTIFACT_SPECIAL_FILE_FORBIDDEN");
      if (files.length > MAX_FILES) fail("ARTIFACT_FILE_LIMIT_EXCEEDED");
    }
  }
  return files;
}

async function main() {
  const { profile, directory } = parseArguments(process.argv.slice(2));
  const root = resolve(process.cwd(), directory);
  const rootRelative = relative(process.cwd(), root);
  if (
    !directory.trim()
    || isAbsolute(rootRelative)
    || rootRelative === ".."
    || rootRelative.startsWith(`..${sep}`)
    || basename(root) !== "dist"
  ) {
    fail("ARTIFACT_ROOT_INVALID");
  }

  const files = await collectFiles(root);
  const inventory = new Set(files.map((file) => normalizePath(relative(root, file))));
  const requiredFiles = profiles[profile];
  if (requiredFiles.some((file) => !inventory.has(file))) fail("ARTIFACT_ENTRYPOINT_MISSING");

  let textFiles = 0;
  for (const file of files) {
    const name = basename(file).toLowerCase();
    const normalized = normalizePath(relative(root, file)).toLowerCase();
    if (
      forbiddenNames.has(name)
      || forbiddenSuffixes.some((suffix) => normalized.endsWith(suffix))
      || normalized.endsWith(".test.js")
      || normalized.endsWith(".spec.js")
    ) {
      fail("ARTIFACT_FORBIDDEN_FILE_FOUND");
    }
    if (!normalized.endsWith(".js") && !normalized.endsWith(".css")) continue;
    const contents = await readFile(file);
    if (contents.byteLength > MAX_TEXT_FILE_BYTES) fail("ARTIFACT_TEXT_FILE_TOO_LARGE");
    textFiles += 1;
    if (contents.includes("sourceMappingURL=")) fail("ARTIFACT_SOURCE_MAP_REFERENCE_FOUND");
  }

  process.stdout.write(`${JSON.stringify({
    ok: true,
    profile,
    fileCount: files.length,
    checkedTextFileCount: textFiles,
  })}\n`);
}

main().catch((error) => {
  const errorType = error instanceof Error && /^[A-Z][A-Z0-9_]{0,99}$/.test(error.name)
    ? error.name
    : "ARTIFACT_VERIFICATION_FAILED";
  process.stderr.write(`${JSON.stringify({ ok: false, errorType })}\n`);
  process.exitCode = 1;
});
