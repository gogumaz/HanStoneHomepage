import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { RollbackRehearsalEvidenceService } from "./operations/rollback-rehearsal-evidence.service.js";

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

async function artifact(name: string, path: string): Promise<{ value: unknown; sha256: string }> {
  let contents: Buffer;
  try { contents = await readFile(path); } catch { throw cliError(`ROLLBACK_REHEARSAL_${name}_READ_FAILED`); }
  if (contents.byteLength > 1024 * 1024) throw cliError(`ROLLBACK_REHEARSAL_${name}_TOO_LARGE`);
  try {
    return { value: JSON.parse(contents.toString("utf8")), sha256: createHash("sha256").update(contents).digest("hex") };
  } catch {
    throw cliError(`ROLLBACK_REHEARSAL_${name}_JSON_INVALID`);
  }
}

async function main(): Promise<void> {
  const [current, target, verification] = await Promise.all([
    artifact("CURRENT_ACCEPTANCE", required("ROLLBACK_REHEARSAL_CURRENT_ACCEPTANCE_REPORT")),
    artifact("TARGET_CLOSEOUT", required("ROLLBACK_REHEARSAL_TARGET_CLOSEOUT_REPORT")),
    artifact("DEPLOYMENT_VERIFICATION", required("ROLLBACK_REHEARSAL_DEPLOYMENT_REPORT")),
  ]);
  const report = new RollbackRehearsalEvidenceService().create({
    drillId: required("ROLLBACK_REHEARSAL_DRILL_ID"),
    environmentLabel: required("ROLLBACK_REHEARSAL_ENVIRONMENT"),
    apiBaseUrl: required("ROLLBACK_REHEARSAL_API_BASE_URL"),
    webBaseUrl: required("ROLLBACK_REHEARSAL_WEB_BASE_URL"),
    maximumAgeHours: Number(process.env.ROLLBACK_REHEARSAL_MAX_AGE_HOURS?.trim() || "24"),
    currentAcceptance: current.value,
    targetCloseout: target.value,
    deploymentVerification: verification.value,
    sourceSha256: {
      currentAcceptance: current.sha256,
      targetCloseout: target.sha256,
      deploymentVerification: verification.sha256,
    },
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
}

main().catch((error: unknown) => {
  const errorType = error instanceof Error && /^[A-Z][A-Z0-9_]{0,119}$/u.test(error.name)
    ? error.name : "ROLLBACK_REHEARSAL_EVIDENCE_FAILED";
  process.stderr.write(`${JSON.stringify({ ok: false, errorType })}\n`);
  process.exitCode = 1;
});
