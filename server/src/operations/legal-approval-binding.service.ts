import { createHash } from "node:crypto";
import { CURRENT_LEGAL_POLICY_VERSION } from "../common/legal-policy.js";

type JsonObject = Record<string, unknown>;
type BindingCheck = { name: string; status: "pass" | "fail"; code: string };

export type LegalApprovalBindingInput = {
  releaseId: string;
  environment: NodeJS.ProcessEnv;
  approvalEvidence: unknown;
  preflight: unknown;
  approvalEvidenceSha256: string;
  preflightSha256: string;
  environmentSha256: string;
  expectedCommitSha: string;
};

export type LegalApprovalBindingReport = {
  ok: boolean;
  schemaVersion: 2;
  releaseId: string;
  commitSha: string;
  checkedAt: string;
  policyVersion: string | null;
  approvedAt: string | null;
  documentSha256: string | null;
  artifacts: { approvalEvidenceSha256: string; preflightSha256: string; environmentSha256: string };
  checks: BindingCheck[];
  evidenceSha256: string;
};

const APPROVAL_CHECKS = [
  "signedFinalConfirmation", "documentSize", "documentFormat", "approvalTimestamp", "candidateCommit", "documentSha256",
] as const;

function bindingError(code: string): Error {
  const error = new Error(code);
  error.name = code;
  return error;
}

function object(value: unknown): JsonObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonObject : null;
}

function check(name: string, passed: boolean, code: string): BindingCheck {
  return { name, status: passed ? "pass" : "fail", code: passed ? "OK" : code };
}

function allApprovalChecksPassed(value: unknown): boolean {
  if (!Array.isArray(value) || value.length !== APPROVAL_CHECKS.length) return false;
  const expected = new Set<string>(APPROVAL_CHECKS);
  return value.every((item) => {
    const entry = object(item);
    return typeof entry?.name === "string" && expected.delete(entry.name) && entry.status === "pass" && entry.code === "OK";
  }) && expected.size === 0;
}

function normalizedTimestamp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null;
}

export class LegalApprovalBindingService {
  constructor(private readonly now: () => Date = () => new Date()) {}

  run(input: LegalApprovalBindingInput): LegalApprovalBindingReport {
    if (!/^[A-Za-z0-9._-]{1,80}$/u.test(input.releaseId)) {
      throw bindingError("LEGAL_BINDING_RELEASE_ID_INVALID");
    }
    const hashPattern = /^[a-fA-F0-9]{64}$/u;
    if (!hashPattern.test(input.approvalEvidenceSha256) || !hashPattern.test(input.preflightSha256) ||
      !hashPattern.test(input.environmentSha256)) {
      throw bindingError("LEGAL_BINDING_ARTIFACT_SHA256_INVALID");
    }
    const commitSha = input.expectedCommitSha.trim().toLowerCase();
    if (!/^[a-f0-9]{40}$/u.test(commitSha)) throw bindingError("LEGAL_BINDING_COMMIT_SHA_INVALID");

    const approval = object(input.approvalEvidence);
    const approvalMetadata = object(approval?.approval);
    const document = object(approval?.document);
    const declaredEnvironment = object(approval?.environment);
    const preflight = object(input.preflight);
    const configurationChecks = Array.isArray(preflight?.checks)
      ? preflight.checks.map(object).filter((entry): entry is JsonObject => entry?.name === "configuration") : [];
    const configuration = configurationChecks[0];
    const approvedAt = normalizedTimestamp(approvalMetadata?.approvedAt);
    const environmentApprovedAt = normalizedTimestamp(input.environment.LEGAL_POLICY_APPROVED_AT);
    const documentSha256 = typeof document?.sha256 === "string" && hashPattern.test(document.sha256)
      ? document.sha256.toLowerCase() : null;
    const generatedAt = normalizedTimestamp(approval?.generatedAt);
    const now = this.now();
    const approvalCandidate = approvalMetadata?.candidateCommitSha;
    const candidateValid = approvalCandidate === null || approvalCandidate === commitSha;
    const configurationDetail = typeof configuration?.detail === "string" ? configuration.detail : "";
    const checks = [
      check(
        "approvalEvidence",
        approval?.ok === true && approval?.schemaVersion === 1 && allApprovalChecksPassed(approval?.checks),
        "LEGAL_BINDING_APPROVAL_EVIDENCE_INVALID",
      ),
      check(
        "policyVersion",
        approval?.policyVersion === CURRENT_LEGAL_POLICY_VERSION &&
          input.environment.LEGAL_POLICY_VERSION === CURRENT_LEGAL_POLICY_VERSION,
        "LEGAL_BINDING_POLICY_VERSION_MISMATCH",
      ),
      check("candidateCommit", candidateValid, "LEGAL_BINDING_CANDIDATE_MISMATCH"),
      check(
        "approvalTimestamp",
        approvedAt !== null && approvedAt === environmentApprovedAt &&
          approvedAt === normalizedTimestamp(declaredEnvironment?.LEGAL_POLICY_APPROVED_AT),
        "LEGAL_BINDING_APPROVAL_TIMESTAMP_MISMATCH",
      ),
      check(
        "documentSha256",
        documentSha256 !== null && documentSha256 === input.environment.LEGAL_POLICY_APPROVAL_SHA256?.toLowerCase() &&
          documentSha256 === String(declaredEnvironment?.LEGAL_POLICY_APPROVAL_SHA256 ?? "").toLowerCase(),
        "LEGAL_BINDING_DOCUMENT_SHA256_MISMATCH",
      ),
      check(
        "generatedTimestamp",
        generatedAt !== null && generatedAt <= now.toISOString(),
        "LEGAL_BINDING_GENERATED_TIMESTAMP_INVALID",
      ),
      check(
        "preflight",
        preflight?.ok === true && preflight?.evidenceCommitSha === commitSha && configurationChecks.length === 1 &&
          configuration?.status === "pass" &&
          configurationDetail.includes(`legalPolicy=${CURRENT_LEGAL_POLICY_VERSION}`) &&
          approvedAt !== null && configurationDetail.includes(`legalApprovedAt=${approvedAt}`) &&
          configurationDetail.includes("legalApprovalSha256=verified"),
        "LEGAL_BINDING_PREFLIGHT_MISMATCH",
      ),
    ];
    const checkedAt = now.toISOString();
    const artifacts = {
      approvalEvidenceSha256: input.approvalEvidenceSha256.toLowerCase(),
      preflightSha256: input.preflightSha256.toLowerCase(),
      environmentSha256: input.environmentSha256.toLowerCase(),
    };
    const source = JSON.stringify({
      schemaVersion: 2, releaseId: input.releaseId, commitSha, checkedAt, policyVersion: approval?.policyVersion ?? null,
      approvedAt, documentSha256, artifacts, checks: checks.map(({ name, status }) => ({ name, status })),
    });
    return {
      ok: checks.every(({ status }) => status === "pass"),
      schemaVersion: 2,
      releaseId: input.releaseId,
      commitSha,
      checkedAt,
      policyVersion: typeof approval?.policyVersion === "string" ? approval.policyVersion : null,
      approvedAt,
      documentSha256,
      artifacts,
      checks,
      evidenceSha256: createHash("sha256").update(source, "utf8").digest("hex"),
    };
  }
}
