import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";

const MAX_FILES = 50_000;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;
const IMMUTABLE_CACHE_CONTROL = "public,max-age=31536000,immutable";
const REVALIDATE_CACHE_CONTROL = "public,max-age=0,must-revalidate";
const CONTENT_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
  [".woff2", "font/woff2"],
]);
const REQUIRED_ENTRYPOINTS = ["index.html", "app.html", "payment/success.html", "payment/fail.html"];

function fail(code) {
  const error = new Error(code);
  error.name = code;
  throw error;
}

function normalizedRelative(root, path) {
  return relative(root, path).split(sep).join("/");
}

async function collectFiles(root) {
  const files = [];
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop();
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const path = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) fail("WEB_RELEASE_SYMBOLIC_LINK_FORBIDDEN");
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile()) files.push(path);
      else fail("WEB_RELEASE_SPECIAL_FILE_FORBIDDEN");
      if (files.length > MAX_FILES) fail("WEB_RELEASE_FILE_LIMIT_EXCEEDED");
    }
  }
  return files;
}

async function main() {
  const [rootArgument, outputArgument] = process.argv.slice(2);
  const commitSha = process.env.WEB_RELEASE_COMMIT_SHA?.trim().toLowerCase();
  if (!rootArgument || !outputArgument || !commitSha || !/^[a-f0-9]{40}$/.test(commitSha)) {
    fail("WEB_RELEASE_ARGUMENTS_INVALID");
  }
  const root = resolve(rootArgument);
  const output = resolve(outputArgument);
  const outputRelative = normalizedRelative(root, output);
  const rootFromCwd = relative(process.cwd(), root);
  if (
    basename(root) !== "dist"
    || isAbsolute(rootFromCwd)
    || rootFromCwd === ".."
    || rootFromCwd.startsWith(`..${sep}`)
    || dirname(output) !== root
    || outputRelative !== "web-deployment-manifest.json"
  ) fail("WEB_RELEASE_PATH_INVALID");
  try {
    await lstat(output);
    fail("WEB_RELEASE_OUTPUT_EXISTS");
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
  }

  const paths = await collectFiles(root);
  const relativePaths = new Set(paths.map((path) => normalizedRelative(root, path)));
  if (REQUIRED_ENTRYPOINTS.some((path) => !relativePaths.has(path))) fail("WEB_RELEASE_ENTRYPOINT_MISSING");

  let totalBytes = 0;
  const files = [];
  for (const path of paths.sort((left, right) => normalizedRelative(root, left).localeCompare(normalizedRelative(root, right)))) {
    const name = normalizedRelative(root, path);
    const extension = extname(name).toLowerCase();
    const contentType = CONTENT_TYPES.get(extension);
    if (!contentType) fail("WEB_RELEASE_CONTENT_TYPE_UNSUPPORTED");
    const immutable = name.startsWith("assets/");
    if (immutable && !/-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/.test(name)) {
      fail("WEB_RELEASE_ASSET_NOT_FINGERPRINTED");
    }
    const contents = await readFile(path);
    totalBytes += contents.byteLength;
    if (totalBytes > MAX_TOTAL_BYTES) fail("WEB_RELEASE_SIZE_LIMIT_EXCEEDED");
    files.push({
      path: name,
      sha256: createHash("sha256").update(contents).digest("hex"),
      bytes: contents.byteLength,
      contentType,
      cacheControl: immutable ? IMMUTABLE_CACHE_CONTROL : REVALIDATE_CACHE_CONTROL,
    });
  }

  const manifest = {
    schemaVersion: 1,
    ok: true,
    commitSha,
    generatedAt: new Date().toISOString(),
    files,
    totals: { files: files.length, bytes: totalBytes },
  };
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ ok: true, fileCount: files.length, totalBytes })}\n`);
}

main().catch((error) => {
  const errorType = error instanceof Error && /^[A-Z][A-Z0-9_]{0,99}$/.test(error.name)
    ? error.name
    : "WEB_RELEASE_MANIFEST_FAILED";
  process.stderr.write(`${JSON.stringify({ ok: false, errorType })}\n`);
  process.exitCode = 1;
});
