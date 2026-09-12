import "dotenv/config";
import { PaymentOperationsEvidenceService } from "./operations/payment-operations-evidence.service.js";
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
  const preflight = await readReleaseEvidenceFile(
    "preflight", required("PAYMENT_EVIDENCE_PREFLIGHT_REPORT"),
  );
  const capture = await readReleaseEvidenceFile(
    "paymentOperationsCapture", required("PAYMENT_EVIDENCE_CAPTURE_REPORT"),
  );
  const report = new PaymentOperationsEvidenceService().run({
    releaseId: required("PAYMENT_EVIDENCE_RELEASE_ID"),
    preflight: preflight.value,
    capture: capture.value,
    preflightSha256: preflight.sha256,
    captureSha256: capture.sha256,
    maximumAgeHours: integer("PAYMENT_EVIDENCE_MAX_AGE_HOURS", 24),
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
}

main().catch((error: unknown) => {
  const errorType = error instanceof Error && /^[A-Za-z][A-Za-z0-9_]{0,99}$/u.test(error.name)
    ? error.name : "UNKNOWN";
  process.stderr.write(`${JSON.stringify({ ok: false, errorType })}\n`);
  process.exitCode = 1;
});
