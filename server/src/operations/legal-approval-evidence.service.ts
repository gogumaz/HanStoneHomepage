import { createHash } from "node:crypto";
import { extname } from "node:path";
import { CURRENT_LEGAL_POLICY_VERSION } from "../common/legal-policy.js";

export const LEGAL_APPROVAL_CONFIRMATION = "I_CONFIRM_THIS_IS_SIGNED_FINAL_LEGAL_APPROVAL";
export const MAX_LEGAL_APPROVAL_BYTES = 25 * 1024 * 1024;
const MIN_LEGAL_APPROVAL_BYTES = 1024;

export type LegalApprovalEvidenceInput = {
  fileName: string;
  contents: Buffer;
  approvedAt: string;
  confirmation: string;
  candidateCommitSha?: string | null;
};

export type LegalApprovalEvidenceReport = {
  ok: true;
  schemaVersion: 1;
  policyVersion: string;
  generatedAt: string;
  approval: {
    approvedAt: string;
    candidateCommitSha: string | null;
    operatorAttestation: "signed-final-original-confirmed";
  };
  document: {
    format: "docx" | "pdf";
    bytes: number;
    sha256: string;
  };
  environment: {
    LEGAL_POLICY_VERSION: string;
    LEGAL_POLICY_APPROVED_AT: string;
    LEGAL_POLICY_APPROVAL_SHA256: string;
  };
  checks: Array<{ name: string; status: "pass"; code: "OK" }>;
};

function approvalError(code: string): Error {
  const error = new Error(code);
  error.name = code;
  return error;
}

function validateFormat(fileName: string, contents: Buffer): "docx" | "pdf" {
  const extension = extname(fileName).toLowerCase();
  if (extension === ".docx") {
    const zipMagic = contents.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    const contentTypes = contents.includes(Buffer.from("[Content_Types].xml", "utf8"));
    const documentXml = contents.includes(Buffer.from("word/document.xml", "utf8"));
    if (!zipMagic || !contentTypes || !documentXml) throw approvalError("LEGAL_APPROVAL_DOCX_INVALID");
    return "docx";
  }
  if (extension === ".pdf") {
    if (!contents.subarray(0, 5).equals(Buffer.from("%PDF-", "ascii"))) {
      throw approvalError("LEGAL_APPROVAL_PDF_INVALID");
    }
    return "pdf";
  }
  throw approvalError("LEGAL_APPROVAL_FORMAT_UNSUPPORTED");
}

function validateApprovedAt(value: string, now: Date): string {
  if (!/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/u.test(value)) {
    throw approvalError("LEGAL_APPROVAL_APPROVED_AT_INVALID");
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) throw approvalError("LEGAL_APPROVAL_APPROVED_AT_INVALID");
  if (milliseconds > now.getTime() + 5 * 60_000) throw approvalError("LEGAL_APPROVAL_APPROVED_AT_IN_FUTURE");
  return new Date(milliseconds).toISOString();
}

export class LegalApprovalEvidenceService {
  constructor(private readonly now: () => Date = () => new Date()) {}

  run(input: LegalApprovalEvidenceInput): LegalApprovalEvidenceReport {
    if (input.confirmation !== LEGAL_APPROVAL_CONFIRMATION) {
      throw approvalError("LEGAL_APPROVAL_SIGNED_FINAL_CONFIRMATION_REQUIRED");
    }
    if (input.contents.byteLength < MIN_LEGAL_APPROVAL_BYTES) {
      throw approvalError("LEGAL_APPROVAL_DOCUMENT_TOO_SMALL");
    }
    if (input.contents.byteLength > MAX_LEGAL_APPROVAL_BYTES) {
      throw approvalError("LEGAL_APPROVAL_DOCUMENT_TOO_LARGE");
    }
    const fileName = input.fileName.trim();
    if (!fileName || fileName.includes("/") || fileName.includes("\\")) {
      throw approvalError("LEGAL_APPROVAL_FILE_NAME_INVALID");
    }
    const format = validateFormat(fileName, input.contents);
    const now = this.now();
    const approvedAt = validateApprovedAt(input.approvedAt.trim(), now);
    const candidateCommitSha = input.candidateCommitSha?.trim().toLowerCase() || null;
    if (candidateCommitSha !== null && !/^[a-f0-9]{40}$/u.test(candidateCommitSha)) {
      throw approvalError("LEGAL_APPROVAL_CANDIDATE_COMMIT_INVALID");
    }
    const sha256 = createHash("sha256").update(input.contents).digest("hex");
    const checks = [
      "signedFinalConfirmation",
      "documentSize",
      "documentFormat",
      "approvalTimestamp",
      "candidateCommit",
      "documentSha256",
    ].map((name) => ({ name, status: "pass" as const, code: "OK" as const }));

    return {
      ok: true,
      schemaVersion: 1,
      policyVersion: CURRENT_LEGAL_POLICY_VERSION,
      generatedAt: now.toISOString(),
      approval: {
        approvedAt,
        candidateCommitSha,
        operatorAttestation: "signed-final-original-confirmed",
      },
      document: {
        format,
        bytes: input.contents.byteLength,
        sha256,
      },
      environment: {
        LEGAL_POLICY_VERSION: CURRENT_LEGAL_POLICY_VERSION,
        LEGAL_POLICY_APPROVED_AT: approvedAt,
        LEGAL_POLICY_APPROVAL_SHA256: sha256,
      },
      checks,
    };
  }
}
