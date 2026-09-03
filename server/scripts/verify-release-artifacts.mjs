import { readFile, readdir } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import { createContext, Script } from "node:vm";

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
    "config.js",
    "payment/success.html",
    "payment/fail.html",
  ],
};
const publicConfigKeys = new Set([
  "apiBaseUrl",
  "oauthEnabled",
  "oauthProviders",
  "boardApiEnabled",
  "lectureApiEnabled",
  "demoRoleSwitcher",
  "paymentProvider",
  "tossPayments",
]);
const oauthProviders = new Set(["naver", "kakao", "google"]);

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

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateWebConfig(source) {
  const sandbox = { window: {} };
  try {
    new Script(source, { filename: "config.js" }).runInContext(createContext(sandbox), { timeout: 100 });
  } catch {
    fail("ARTIFACT_WEB_CONFIG_INVALID");
  }
  const config = sandbox.window.APP_CONFIG;
  if (!isRecord(config)) {
    fail("ARTIFACT_WEB_CONFIG_INVALID");
  }
  if (/(?:test|live)_gsk_[A-Za-z0-9_-]+|-----BEGIN [A-Z ]*PRIVATE KEY-----/i.test(source)) {
    fail("ARTIFACT_WEB_CONFIG_SECRET_FOUND");
  }
  const forbiddenKey = /(?:secret|password|private.?key|access.?token|authorization)/i;
  const pending = [config];
  while (pending.length) {
    const value = pending.pop();
    for (const [key, child] of Object.entries(value)) {
      if (forbiddenKey.test(key)) fail("ARTIFACT_WEB_CONFIG_SECRET_FOUND");
      if (isRecord(child)) pending.push(child);
    }
  }
  if (Object.keys(config).some((key) => !publicConfigKeys.has(key))) {
    fail("ARTIFACT_WEB_CONFIG_INVALID");
  }
  const apiBaseUrl = config.apiBaseUrl;
  const apiUrlAllowed = typeof apiBaseUrl === "string" && (
    apiBaseUrl.startsWith("/")
    || /^https:\/\/[A-Za-z0-9.-]+(?::\d+)?(?:\/|$)/.test(apiBaseUrl)
    || /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(?:\/|$)/.test(apiBaseUrl)
  );
  if (
    !apiUrlAllowed
    || typeof config.oauthEnabled !== "boolean"
    || !Array.isArray(config.oauthProviders)
    || config.oauthProviders.some((provider) => !oauthProviders.has(provider))
    || typeof config.boardApiEnabled !== "boolean"
    || typeof config.lectureApiEnabled !== "boolean"
    || typeof config.demoRoleSwitcher !== "boolean"
    || config.paymentProvider !== "toss-payments"
    || !isRecord(config.tossPayments)
  ) fail("ARTIFACT_WEB_CONFIG_INVALID");

  const toss = config.tossPayments;
  const clientKey = toss.clientKey;
  if (
    (toss.mode !== "test" && toss.mode !== "live")
    || typeof clientKey !== "string"
    || (clientKey !== "" && !clientKey.startsWith(`${toss.mode}_gck_`))
    || typeof toss.paymentMethodVariantKey !== "string"
    || typeof toss.agreementVariantKey !== "string"
  ) fail("ARTIFACT_WEB_CONFIG_INVALID");

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
  if (profile === "web") {
    const configSource = await readFile(resolve(root, "config.js"), "utf8");
    if (Buffer.byteLength(configSource) > MAX_TEXT_FILE_BYTES) fail("ARTIFACT_TEXT_FILE_TOO_LARGE");
    validateWebConfig(configSource);
  }

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
    ...(profile === "web" ? { webConfigValidated: true } : {}),
  })}\n`);
}

main().catch((error) => {
  const errorType = error instanceof Error && /^[A-Z][A-Z0-9_]{0,99}$/.test(error.name)
    ? error.name
    : "ARTIFACT_VERIFICATION_FAILED";
  process.stderr.write(`${JSON.stringify({ ok: false, errorType })}\n`);
  process.exitCode = 1;
});
