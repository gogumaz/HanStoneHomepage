import "dotenv/config";
import { ReleaseCloseoutService } from "./operations/release-closeout.service.js";
import { readReleaseEvidenceFile } from "./operations/release-evidence-file.js";

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
  const acceptance = await readReleaseEvidenceFile("acceptance", required("RELEASE_CLOSEOUT_ACCEPTANCE_REPORT"));
  const deployment = await readReleaseEvidenceFile(
    "deploymentVerification",
    required("RELEASE_CLOSEOUT_DEPLOYMENT_REPORT"),
  );
  const report = new ReleaseCloseoutService().run({
    acceptance: acceptance.value,
    deploymentVerification: deployment.value,
    acceptanceSha256: acceptance.sha256,
    deploymentVerificationSha256: deployment.sha256,
    maximumVerificationDelayHours: integer("RELEASE_CLOSEOUT_MAX_DELAY_HOURS", 24),
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
}

main().catch((error: unknown) => {
  const errorType = error instanceof Error && /^[A-Za-z][A-Za-z0-9_]{0,99}$/.test(error.name)
    ? error.name : "UNKNOWN";
  process.stderr.write(`${JSON.stringify({ ok: false, errorType })}\n`);
  process.exitCode = 1;
});
