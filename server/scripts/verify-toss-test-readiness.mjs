import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { Script, createContext } from "node:vm";
import { parse } from "dotenv";

const workspaceRoot = resolve(import.meta.dirname, "../..");
const CLIENT_KEY = /^test_gck_[A-Za-z0-9_-]{8,}$/;
const SECRET_KEY = /^test_gsk_[A-Za-z0-9_-]{8,}$/;
const BROWSER_SECRET = /(?:test|live)_(?:g)?sk_[A-Za-z0-9_-]{8,}/;

function check(name, passed, code) {
  return { name, status: passed ? "pass" : "fail", code: passed ? "OK" : code };
}

function workspaceFile(argument, fallback) {
  const path = resolve(argument || fallback);
  const fromRoot = relative(workspaceRoot, path);
  if (isAbsolute(fromRoot) || fromRoot === ".." || fromRoot.startsWith(`..${sep}`)) {
    const error = new Error("TOSS_TEST_READINESS_PATH_INVALID");
    error.name = "TOSS_TEST_READINESS_PATH_INVALID";
    throw error;
  }
  return path;
}

async function optionalFile(path) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

function browserPaymentConfig(source) {
  if (source === null) return null;
  try {
    const sandbox = { window: {} };
    new Script(source, { filename: "browser-payment-config.js" })
      .runInContext(createContext(sandbox), { timeout: 500 });
    const appConfig = sandbox.window.APP_CONFIG;
    return appConfig && typeof appConfig === "object" && !Array.isArray(appConfig)
      ? appConfig.tossPayments ?? null : null;
  } catch {
    return null;
  }
}

async function main() {
  const [configArgument, environmentArgument] = process.argv.slice(2);
  const configPath = workspaceFile(configArgument, resolve(workspaceRoot, "config.js"));
  const environmentPaths = environmentArgument
    ? [workspaceFile(environmentArgument, resolve(workspaceRoot, "server/.env"))]
    : [resolve(workspaceRoot, "server/.env"), resolve(workspaceRoot, ".env")];
  const [configSource, ...environmentSources] = await Promise.all([
    optionalFile(configPath),
    ...environmentPaths.map((path) => optionalFile(path)),
  ]);
  const toss = browserPaymentConfig(configSource);
  const environments = environmentSources
    .filter((source) => source !== null)
    .map((source) => parse(source));
  const clientKey = typeof toss?.clientKey === "string" ? toss.clientKey.trim() : "";
  const mode = typeof toss?.mode === "string" ? toss.mode.trim() : "";
  const processSecretKey = process.env.TOSS_PAYMENTS_SECRET_KEY?.trim() ?? "";
  const secretKey = processSecretKey || environments
    .map((environment) => environment.TOSS_PAYMENTS_SECRET_KEY?.trim() ?? "")
    .find(Boolean) || "";
  const serverEnvironmentConfigured = Boolean(processSecretKey) || environmentSources.some((source) => source !== null);
  const checks = [
    check("browserConfig", configSource !== null && toss !== null, "TOSS_BROWSER_CONFIG_MISSING"),
    check("testMode", mode === "test", "TOSS_BROWSER_TEST_MODE_REQUIRED"),
    check("widgetClientKey", CLIENT_KEY.test(clientKey), "TOSS_TEST_WIDGET_CLIENT_KEY_INVALID"),
    check("browserSecretIsolation", configSource !== null && !BROWSER_SECRET.test(configSource), "TOSS_SECRET_EXPOSED_TO_BROWSER"),
    check("serverEnvironment", serverEnvironmentConfigured, "TOSS_SERVER_ENVIRONMENT_MISSING"),
    check("widgetSecretKey", SECRET_KEY.test(secretKey), "TOSS_TEST_WIDGET_SECRET_KEY_INVALID"),
  ];
  const report = {
    ok: checks.every(({ status }) => status === "pass"),
    checkedAt: new Date().toISOString(),
    mode: "test",
    checks,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
}

main().catch((error) => {
  const errorType = error instanceof Error && /^[A-Za-z][A-Za-z0-9_]{0,99}$/.test(error.name)
    ? error.name : "TOSS_TEST_READINESS_FAILED";
  process.stderr.write(`${JSON.stringify({ ok: false, errorType })}\n`);
  process.exitCode = 1;
});
