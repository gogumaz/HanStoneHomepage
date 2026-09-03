import { describe, expect, it } from "vitest";
import { LegalApprovalBindingService, type LegalApprovalBindingInput } from "./legal-approval-binding.service.js";

const now = new Date("2026-08-31T09:00:00.000Z");
const commitSha = "a".repeat(40);
const documentSha256 = "b".repeat(64);
const approvedAt = "2026-08-31T08:30:00.000Z";

function validInput(): LegalApprovalBindingInput {
  return {
    releaseId: "release-2026.08.31",
    expectedCommitSha: commitSha,
    approvalEvidenceSha256: "1".repeat(64),
    preflightSha256: "2".repeat(64),
    environmentSha256: "3".repeat(64),
    environment: {
      LEGAL_POLICY_VERSION: "guardian-link-v1",
      LEGAL_POLICY_APPROVED_AT: approvedAt,
      LEGAL_POLICY_APPROVAL_SHA256: documentSha256,
      DATABASE_URL: "postgresql://private:password@example.com/app",
    },
    approvalEvidence: {
      ok: true,
      schemaVersion: 1,
      policyVersion: "guardian-link-v1",
      generatedAt: "2026-08-31T08:35:00.000Z",
      approval: {
        approvedAt,
        candidateCommitSha: commitSha,
        operatorAttestation: "signed-final-original-confirmed",
      },
      document: { format: "docx", bytes: 2048, sha256: documentSha256 },
      environment: {
        LEGAL_POLICY_VERSION: "guardian-link-v1",
        LEGAL_POLICY_APPROVED_AT: approvedAt,
        LEGAL_POLICY_APPROVAL_SHA256: documentSha256,
      },
      checks: [
        "signedFinalConfirmation", "documentSize", "documentFormat", "approvalTimestamp", "candidateCommit", "documentSha256",
      ].map((name) => ({ name, status: "pass", code: "OK" })),
      reviewerName: "private reviewer",
    },
    preflight: {
      ok: true,
      checkedAt: "2026-08-31T08:40:00.000Z",
      evidenceCommitSha: commitSha,
      checks: [{
        name: "configuration",
        status: "pass",
        detail: `oauth=none; tossPayments=configured; legalPolicy=guardian-link-v1; legalApprovedAt=${approvedAt}; legalApprovalSha256=verified`,
      }],
    },
  };
}

describe("LegalApprovalBindingService", () => {
  it("binds signed approval metadata to production configuration, preflight, and candidate", () => {
    const report = new LegalApprovalBindingService(() => now).run(validInput());

    expect(report).toMatchObject({
      ok: true,
      schemaVersion: 2,
      releaseId: "release-2026.08.31",
      commitSha,
      policyVersion: "guardian-link-v1",
      approvedAt,
      documentSha256,
      artifacts: {
        approvalEvidenceSha256: "1".repeat(64),
        preflightSha256: "2".repeat(64),
        environmentSha256: "3".repeat(64),
      },
    });
    expect(report.checks).toHaveLength(7);
    expect(report.checks.every(({ status }) => status === "pass")).toBe(true);
    expect(report.evidenceSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify(report)).not.toContain("private reviewer");
    expect(JSON.stringify(report)).not.toContain("password");
  });

  it("accepts a policy-wide approval without a candidate restriction", () => {
    const input = validInput();
    (input.approvalEvidence as { approval: { candidateCommitSha: string | null } }).approval.candidateCommitSha = null;
    expect(new LegalApprovalBindingService(() => now).run(input).ok).toBe(true);
  });

  it("rejects mismatched document metadata, candidate, and preflight", () => {
    const input = validInput();
    input.environment.LEGAL_POLICY_APPROVAL_SHA256 = "c".repeat(64);
    (input.approvalEvidence as { approval: { candidateCommitSha: string } }).approval.candidateCommitSha = "d".repeat(40);
    (input.preflight as { evidenceCommitSha: string }).evidenceCommitSha = "e".repeat(40);
    const report = new LegalApprovalBindingService(() => now).run(input);

    expect(report.ok).toBe(false);
    expect(report.checks).toEqual(expect.arrayContaining([
      { name: "documentSha256", status: "fail", code: "LEGAL_BINDING_DOCUMENT_SHA256_MISMATCH" },
      { name: "candidateCommit", status: "fail", code: "LEGAL_BINDING_CANDIDATE_MISMATCH" },
      { name: "preflight", status: "fail", code: "LEGAL_BINDING_PREFLIGHT_MISMATCH" },
    ]));
  });

  it("cryptographically changes when the approval artifact changes", () => {
    const service = new LegalApprovalBindingService(() => now);
    const first = service.run(validInput());
    const changed = validInput();
    changed.approvalEvidenceSha256 = "3".repeat(64);
    expect(service.run(changed).evidenceSha256).not.toBe(first.evidenceSha256);
  });

  it.each([
    [{ releaseId: "../unsafe" }, "LEGAL_BINDING_RELEASE_ID_INVALID"],
    [{ approvalEvidenceSha256: "bad" }, "LEGAL_BINDING_ARTIFACT_SHA256_INVALID"],
    [{ expectedCommitSha: "main" }, "LEGAL_BINDING_COMMIT_SHA_INVALID"],
  ])("fails closed for invalid immutable input", (override, code) => {
    expect(() => new LegalApprovalBindingService(() => now).run({ ...validInput(), ...override }))
      .toThrowError(expect.objectContaining({ name: code }));
  });
});
