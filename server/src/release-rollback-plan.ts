import "dotenv/config";
import { readReleaseEvidenceFile } from "./operations/release-evidence-file.js";
import { ReleaseRollbackPlanService } from "./operations/release-rollback-plan.service.js";

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

async function main(): Promise<void> {
  const current = await readReleaseEvidenceFile("acceptance", required("ROLLBACK_CURRENT_ACCEPTANCE_REPORT"));
  const failed = await readReleaseEvidenceFile(
    "deploymentVerification",
    required("ROLLBACK_FAILED_DEPLOYMENT_REPORT"),
  );
  const target = await readReleaseEvidenceFile("closeout", required("ROLLBACK_TARGET_CLOSEOUT_REPORT"));
  const report = new ReleaseRollbackPlanService().run({
    currentAcceptance: current.value,
    failedDeploymentVerification: failed.value,
    targetCloseout: target.value,
    currentAcceptanceSha256: current.sha256,
    failedDeploymentVerificationSha256: failed.sha256,
    targetCloseoutSha256: target.sha256,
    databaseStrategy: required("ROLLBACK_DATABASE_STRATEGY"),
    confirmation: required("ROLLBACK_CONFIRMATION"),
    maximumFailureAgeHours: integer("ROLLBACK_FAILURE_MAX_AGE_HOURS", 24),
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
}

main().catch((error: unknown) => {
  const errorType = error instanceof Error && /^[A-Za-z][A-Za-z0-9_]{0,99}$/.test(error.name)
    ? error.name : "UNKNOWN";
  process.stderr.write(`${JSON.stringify({ ok: false, rollbackAuthorized: false, errorType })}\n`);
  process.exitCode = 1;
});
