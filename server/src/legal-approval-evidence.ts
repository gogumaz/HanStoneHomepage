import "dotenv/config";
import { basename } from "node:path";
import { readFile, stat } from "node:fs/promises";
import {
  LegalApprovalEvidenceService,
  MAX_LEGAL_APPROVAL_BYTES,
} from "./operations/legal-approval-evidence.service.js";

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

async function main(): Promise<void> {
  const path = required("LEGAL_APPROVAL_FILE");
  let fileStat;
  try {
    fileStat = await stat(path);
  } catch {
    throw cliError("LEGAL_APPROVAL_FILE_READ_FAILED");
  }
  if (!fileStat.isFile()) throw cliError("LEGAL_APPROVAL_FILE_NOT_REGULAR");
  if (fileStat.size > MAX_LEGAL_APPROVAL_BYTES) throw cliError("LEGAL_APPROVAL_DOCUMENT_TOO_LARGE");
  let contents: Buffer;
  try {
    contents = await readFile(path);
  } catch {
    throw cliError("LEGAL_APPROVAL_FILE_READ_FAILED");
  }
  const candidateCommitSha = process.env.LEGAL_APPROVAL_CANDIDATE_COMMIT_SHA?.trim();
  const report = new LegalApprovalEvidenceService().run({
    fileName: basename(path),
    contents,
    approvedAt: required("LEGAL_APPROVAL_APPROVED_AT"),
    confirmation: required("LEGAL_APPROVAL_CONFIRMATION"),
    ...(candidateCommitSha ? { candidateCommitSha } : {}),
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main().catch((error: unknown) => {
  const errorType = error instanceof Error && /^[A-Za-z][A-Za-z0-9_]{0,99}$/u.test(error.name)
    ? error.name : "UNKNOWN";
  process.stderr.write(`${JSON.stringify({ ok: false, errorType })}\n`);
  process.exitCode = 1;
});
