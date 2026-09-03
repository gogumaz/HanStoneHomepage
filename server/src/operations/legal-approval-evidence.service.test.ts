import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  LEGAL_APPROVAL_CONFIRMATION,
  LegalApprovalEvidenceService,
  MAX_LEGAL_APPROVAL_BYTES,
  type LegalApprovalEvidenceInput,
} from "./legal-approval-evidence.service.js";

const now = new Date("2026-08-31T09:00:00.000Z");

function docxContents(): Buffer {
  return Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.from("[Content_Types].xml word/document.xml signed approval ", "utf8"),
    Buffer.alloc(1200, 0x31),
  ]);
}

function validInput(): LegalApprovalEvidenceInput {
  return {
    fileName: "legal-approval-signed.docx",
    contents: docxContents(),
    approvedAt: "2026-08-31T17:30:00+09:00",
    confirmation: LEGAL_APPROVAL_CONFIRMATION,
    candidateCommitSha: "A".repeat(40),
  };
}

describe("LegalApprovalEvidenceService", () => {
  it("binds a confirmed signed DOCX to normalized deployment metadata", () => {
    const input = validInput();
    const report = new LegalApprovalEvidenceService(() => now).run(input);
    const sha256 = createHash("sha256").update(input.contents).digest("hex");

    expect(report).toMatchObject({
      ok: true,
      schemaVersion: 1,
      policyVersion: "guardian-link-v1",
      generatedAt: now.toISOString(),
      approval: {
        approvedAt: "2026-08-31T08:30:00.000Z",
        candidateCommitSha: "a".repeat(40),
        operatorAttestation: "signed-final-original-confirmed",
      },
      document: {
        format: "docx",
        bytes: input.contents.byteLength,
        sha256,
      },
      environment: {
        LEGAL_POLICY_VERSION: "guardian-link-v1",
        LEGAL_POLICY_APPROVED_AT: "2026-08-31T08:30:00.000Z",
        LEGAL_POLICY_APPROVAL_SHA256: sha256,
      },
    });
    expect(report.checks).toHaveLength(6);
    expect(report.checks.every(({ status, code }) => status === "pass" && code === "OK")).toBe(true);
    expect(JSON.stringify(report)).not.toContain("legal-approval-signed.docx");
    expect(JSON.stringify(report)).not.toContain("Home Page");
  });

  it("accepts a final PDF without requiring a candidate commit", () => {
    const report = new LegalApprovalEvidenceService(() => now).run({
      ...validInput(),
      fileName: "legal-approval-signed.pdf",
      contents: Buffer.concat([Buffer.from("%PDF-1.7\n", "ascii"), Buffer.alloc(1200, 0x32)]),
      candidateCommitSha: null,
    });

    expect(report.document.format).toBe("pdf");
    expect(report.approval.candidateCommitSha).toBeNull();
  });

  it("fails closed without the exact signed-final operator attestation", () => {
    expect(() => new LegalApprovalEvidenceService(() => now).run({
      ...validInput(), confirmation: "yes",
    })).toThrowError(expect.objectContaining({
      name: "LEGAL_APPROVAL_SIGNED_FINAL_CONFIRMATION_REQUIRED",
    }));
  });

  it.each([
    ["unsupported format", { fileName: "approval.txt" }, "LEGAL_APPROVAL_FORMAT_UNSUPPORTED"],
    ["invalid DOCX", { contents: Buffer.alloc(1200, 0x31) }, "LEGAL_APPROVAL_DOCX_INVALID"],
    ["future approval", { approvedAt: "2026-09-01T00:00:00.000Z" }, "LEGAL_APPROVAL_APPROVED_AT_IN_FUTURE"],
    ["timestamp without zone", { approvedAt: "2026-08-31T08:30:00" }, "LEGAL_APPROVAL_APPROVED_AT_INVALID"],
    ["invalid candidate", { candidateCommitSha: "main" }, "LEGAL_APPROVAL_CANDIDATE_COMMIT_INVALID"],
    ["path-like name", { fileName: "private/approval.docx" }, "LEGAL_APPROVAL_FILE_NAME_INVALID"],
  ])("rejects %s", (_label, override, code) => {
    expect(() => new LegalApprovalEvidenceService(() => now).run({
      ...validInput(), ...override,
    })).toThrowError(expect.objectContaining({ name: code }));
  });

  it("rejects documents outside the bounded evidence size", () => {
    expect(() => new LegalApprovalEvidenceService(() => now).run({
      ...validInput(), contents: Buffer.alloc(100),
    })).toThrowError(expect.objectContaining({ name: "LEGAL_APPROVAL_DOCUMENT_TOO_SMALL" }));
    expect(() => new LegalApprovalEvidenceService(() => now).run({
      ...validInput(), contents: Buffer.alloc(MAX_LEGAL_APPROVAL_BYTES + 1),
    })).toThrowError(expect.objectContaining({ name: "LEGAL_APPROVAL_DOCUMENT_TOO_LARGE" }));
  });
});
