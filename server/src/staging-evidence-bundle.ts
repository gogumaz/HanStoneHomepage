import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { StagingEvidenceBundleService } from "./operations/staging-evidence-bundle.service.js";

const MAX_REPORT_BYTES = 1024 * 1024;

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

function positiveInteger(name: string, fallback?: number): number {
  const raw = process.env[name]?.trim();
  if (!raw && fallback !== undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) throw cliError(`${name}_INVALID`);
  return value;
}

async function artifact(name: string, path: string): Promise<{ value: unknown; sha256: string }> {
  let contents: Buffer;
  try {
    contents = await readFile(path);
  } catch {
    throw cliError(`STAGING_BUNDLE_${name}_READ_FAILED`);
  }
  if (contents.byteLength > MAX_REPORT_BYTES) throw cliError(`STAGING_BUNDLE_${name}_TOO_LARGE`);
  try {
    return {
      value: JSON.parse(contents.toString("utf8")),
      sha256: createHash("sha256").update(contents).digest("hex"),
    };
  } catch {
    throw cliError(`STAGING_BUNDLE_${name}_JSON_INVALID`);
  }
}

async function main(): Promise<void> {
  const [readOnlyLoad, workerSoak, controlledLoad, execution] = await Promise.all([
    artifact("LOAD_REPORT", required("STAGING_BUNDLE_LOAD_REPORT")),
    artifact("WORKER_SOAK_REPORT", required("STAGING_BUNDLE_WORKER_SOAK_REPORT")),
    artifact("CONTROLLED_LOAD_REPORT", required("STAGING_BUNDLE_CONTROLLED_LOAD_REPORT")),
    artifact("EXECUTION_REPORT", required("STAGING_BUNDLE_EXECUTION_REPORT")),
  ]);
  const report = new StagingEvidenceBundleService().create({
    releaseId: required("STAGING_BUNDLE_RELEASE_ID"),
    candidateCommitSha: required("STAGING_BUNDLE_COMMIT_SHA"),
    loadTestRunId: positiveInteger("STAGING_BUNDLE_LOAD_RUN_ID"),
    workerSoakRunId: positiveInteger("STAGING_BUNDLE_WORKER_SOAK_RUN_ID"),
    maximumAgeHours: positiveInteger("STAGING_BUNDLE_MAX_AGE_HOURS", 168),
    reports: {
      readOnlyLoad: readOnlyLoad.value,
      workerSoak: workerSoak.value,
      controlledLoad: controlledLoad.value,
      execution: execution.value,
    },
    sourceSha256: {
      readOnlyLoad: readOnlyLoad.sha256,
      workerSoak: workerSoak.sha256,
      controlledLoad: controlledLoad.sha256,
      execution: execution.sha256,
    },
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
}

main().catch((error: unknown) => {
  const errorType = error instanceof Error && /^[A-Z][A-Z0-9_]{0,119}$/u.test(error.name)
    ? error.name
    : "STAGING_EVIDENCE_BUNDLE_FAILED";
  process.stderr.write(`${JSON.stringify({ ok: false, errorType })}\n`);
  process.exitCode = 1;
});
