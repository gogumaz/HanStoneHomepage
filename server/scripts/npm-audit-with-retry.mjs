import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const TRANSIENT_FAILURE = /(?:\b(?:EAI_AGAIN|ECONNRESET|ECONNREFUSED|ENETUNREACH|ETIMEDOUT|ERR_SOCKET_TIMEOUT)\b|(?:network|request) timeout|50[234] (?:Service Unavailable|Bad Gateway|Gateway Timeout)|audit endpoint returned an error)/iu;
const AUDIT_REPORT = /(?:# npm audit report|\d+ vulnerabilities? \()/iu;
const OUTPUT_LIMIT = 256 * 1024;

function readPositiveInteger(name, fallback, maximum) {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(`${name} must be an integer between 1 and ${maximum}.`);
  }
  return parsed;
}

function appendOutput(current, chunk) {
  const next = current + chunk;
  return next.length <= OUTPUT_LIMIT ? next : next.slice(-OUTPUT_LIMIT);
}

function runAudit(cwd) {
  const windows = process.platform === "win32";
  const command = windows ? (process.env.ComSpec || "cmd.exe") : "npm";
  const args = windows
    ? ["/d", "/s", "/c", "npm audit --omit=dev --audit-level=high"]
    : ["audit", "--omit=dev", "--audit-level=high"];
  return new Promise((resolveResult, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      process.stdout.write(chunk);
      output = appendOutput(output, chunk.toString("utf8"));
    });
    child.stderr.on("data", (chunk) => {
      process.stderr.write(chunk);
      output = appendOutput(output, chunk.toString("utf8"));
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      resolveResult({ code: code ?? 1, output, signal });
    });
  });
}

function isTransientFailure(output) {
  return !AUDIT_REPORT.test(output) && TRANSIENT_FAILURE.test(output);
}

async function main() {
  const cwd = resolve(process.argv[2] ?? ".");
  const maxAttempts = readPositiveInteger("NPM_AUDIT_MAX_ATTEMPTS", 3, 5);
  const retryDelayMs = readPositiveInteger("NPM_AUDIT_RETRY_DELAY_MS", 10_000, 60_000);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await runAudit(cwd);
    if (result.code === 0) return;
    if (!isTransientFailure(result.output) || attempt === maxAttempts) {
      process.exitCode = result.code;
      return;
    }
    process.stderr.write(
      `npm audit network failure; retrying in ${retryDelayMs}ms (${attempt}/${maxAttempts}).\n`,
    );
    await delay(retryDelayMs);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "Unknown npm audit retry failure.";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
