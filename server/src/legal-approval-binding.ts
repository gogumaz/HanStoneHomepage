import "dotenv/config";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { parse } from "dotenv";
import { LegalApprovalBindingService } from "./operations/legal-approval-binding.service.js";
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

async function readEnvironment(path: string): Promise<{ value: NodeJS.ProcessEnv; sha256: string }> {
  let contents: Buffer;
  try {
    contents = await readFile(path);
  } catch {
    throw cliError("LEGAL_BINDING_ENVIRONMENT_READ_FAILED");
  }
  if (contents.length === 0 || contents.length > 256 * 1024) throw cliError("LEGAL_BINDING_ENVIRONMENT_SIZE_INVALID");
  const text = contents.toString("utf8");
  if (text.includes("\u0000") || text.includes("\uFFFD")) throw cliError("LEGAL_BINDING_ENVIRONMENT_ENCODING_INVALID");
  return { value: parse(text), sha256: createHash("sha256").update(contents).digest("hex") };
}

async function main(): Promise<void> {
  const environment = await readEnvironment(required("LEGAL_BINDING_ENV_FILE"));
  const approval = await readReleaseEvidenceFile("legalApproval", required("LEGAL_BINDING_APPROVAL_REPORT"));
  const preflight = await readReleaseEvidenceFile("preflight", required("LEGAL_BINDING_PREFLIGHT_REPORT"));
  const report = new LegalApprovalBindingService().run({
    releaseId: required("LEGAL_BINDING_RELEASE_ID"),
    environment: environment.value,
    approvalEvidence: approval.value,
    preflight: preflight.value,
    approvalEvidenceSha256: approval.sha256,
    preflightSha256: preflight.sha256,
    environmentSha256: environment.sha256,
    expectedCommitSha: required("LEGAL_BINDING_EXPECTED_COMMIT_SHA"),
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
