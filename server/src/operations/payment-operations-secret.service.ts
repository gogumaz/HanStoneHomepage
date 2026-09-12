import { SOLO_RELEASE_OPERATOR_LOGIN } from "../common/release-approval-policy.js";
import {
  PAYMENT_OPERATIONS_CHECK_NAMES,
  type PaymentOperationsEvidenceReport,
} from "./payment-operations-evidence.service.js";

export const PAYMENT_OPERATIONS_SECRET_NAME = "PRODUCTION_PAYMENT_OPERATIONS_BASE64";
export const PAYMENT_OPERATIONS_RELEASE_VARIABLE_NAME = "PRODUCTION_PAYMENT_OPERATIONS_RELEASE_ID";
export const PAYMENT_OPERATIONS_SECRET_STAGE_CONFIRMATION = "STAGE_PAYMENT_OPERATIONS_EVIDENCE";
export const PAYMENT_OPERATIONS_SECRET_REMOVE_CONFIRMATION = "REMOVE_PAYMENT_OPERATIONS_EVIDENCE";

export type PaymentOperationsSecretAction = "stage" | "remove";

export type PaymentOperationsSecretInput = {
  repository: string;
  actorLogin: string;
  releaseId: string;
  localCommitSha: string | null;
  remoteDefaultCommitSha: string | null;
  action: PaymentOperationsSecretAction;
  secretPresent: boolean;
  markerReleaseId: string | null;
  evidence: PaymentOperationsEvidenceReport | null;
  applyRequested: boolean;
  confirmation: string | null;
};

export type PaymentOperationsSecretReport = {
  ok: boolean;
  mode: "dry-run" | "apply";
  action: PaymentOperationsSecretAction;
  repository: string;
  environment: "production";
  releaseId: string;
  secretName: typeof PAYMENT_OPERATIONS_SECRET_NAME;
  markerVariableName: typeof PAYMENT_OPERATIONS_RELEASE_VARIABLE_NAME;
  evidence: {
    commitSha: string;
    checkedAt: string;
    captureSha256: string;
    evidenceSha256: string;
  } | null;
  checks: Array<{ name: string; status: "pass" | "fail"; code: string }>;
  applyAuthorized: boolean;
};

type LifecycleCheck = PaymentOperationsSecretReport["checks"][number];

function lifecycleError(code: string): Error {
  const error = new Error(code);
  error.name = code;
  return error;
}

function check(name: string, passed: boolean, code: string): LifecycleCheck {
  return { name, status: passed ? "pass" : "fail", code: passed ? "OK" : code };
}

function validRepository(value: string): boolean {
  const parts = value.split("/");
  return parts.length === 2 && parts.every((part) => (
    /^[A-Za-z0-9_.-]{1,100}$/u.test(part) && part !== "." && part !== ".."
  ));
}

function validLogin(value: string): boolean {
  return /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,98}[A-Za-z0-9])?$/u.test(value);
}

function validEvidence(
  evidence: PaymentOperationsEvidenceReport | null,
  releaseId: string,
): evidence is PaymentOperationsEvidenceReport & { commitSha: string } {
  return evidence !== null && evidence.ok === true && evidence.schemaVersion === 1 &&
    evidence.releaseId === releaseId && typeof evidence.commitSha === "string" &&
    /^[a-f0-9]{40}$/u.test(evidence.commitSha) &&
    /^[a-f0-9]{64}$/u.test(evidence.artifacts.captureSha256) &&
    /^[a-f0-9]{64}$/u.test(evidence.evidenceSha256) &&
    evidence.checks.length === PAYMENT_OPERATIONS_CHECK_NAMES.length &&
    evidence.checks.every(({ name, status, code }, index) =>
      name === PAYMENT_OPERATIONS_CHECK_NAMES[index] && status === "pass" && code === "OK");
}

export class PaymentOperationsSecretService {
  plan(input: PaymentOperationsSecretInput): PaymentOperationsSecretReport {
    if (!validRepository(input.repository)) throw lifecycleError("PAYMENT_SECRET_REPOSITORY_INVALID");
    if (!validLogin(input.actorLogin)) throw lifecycleError("PAYMENT_SECRET_ACTOR_INVALID");
    if (!/^[A-Za-z0-9._-]{1,80}$/u.test(input.releaseId)) {
      throw lifecycleError("PAYMENT_SECRET_RELEASE_ID_INVALID");
    }

    const validatedEvidence = validEvidence(input.evidence, input.releaseId) ? input.evidence : null;
    const candidatePublished = input.action === "remove" || (
      validatedEvidence !== null && typeof input.localCommitSha === "string" &&
      typeof input.remoteDefaultCommitSha === "string" &&
      /^[a-fA-F0-9]{40}$/u.test(input.localCommitSha) &&
      /^[a-fA-F0-9]{40}$/u.test(input.remoteDefaultCommitSha) &&
      validatedEvidence.commitSha === input.localCommitSha.toLowerCase() &&
      validatedEvidence.commitSha === input.remoteDefaultCommitSha.toLowerCase()
    );
    const resourceStateValid = input.action === "stage"
      ? !input.secretPresent && input.markerReleaseId === null
      : input.markerReleaseId === input.releaseId && (input.secretPresent || input.markerReleaseId !== null);
    const expectedConfirmation = input.action === "stage"
      ? PAYMENT_OPERATIONS_SECRET_STAGE_CONFIRMATION
      : PAYMENT_OPERATIONS_SECRET_REMOVE_CONFIRMATION;
    const checks = [
      check(
        "soloOperator",
        input.actorLogin.toLowerCase() === SOLO_RELEASE_OPERATOR_LOGIN.toLowerCase(),
        "PAYMENT_SECRET_SOLO_OPERATOR_MISMATCH",
      ),
      check(
        "evidence",
        input.action === "remove" || validatedEvidence !== null,
        "PAYMENT_SECRET_EVIDENCE_INVALID",
      ),
      check("candidatePublished", candidatePublished, "PAYMENT_SECRET_CANDIDATE_NOT_PUBLISHED"),
      check(
        "resourceState",
        resourceStateValid,
        input.action === "stage" ? "PAYMENT_SECRET_ALREADY_STAGED" : "PAYMENT_SECRET_RELEASE_MISMATCH",
      ),
      check(
        "applyConfirmation",
        !input.applyRequested || input.confirmation === expectedConfirmation,
        "PAYMENT_SECRET_CONFIRMATION_REQUIRED",
      ),
    ];
    const ok = checks.every(({ status }) => status === "pass");
    return {
      ok,
      mode: input.applyRequested ? "apply" : "dry-run",
      action: input.action,
      repository: input.repository,
      environment: "production",
      releaseId: input.releaseId,
      secretName: PAYMENT_OPERATIONS_SECRET_NAME,
      markerVariableName: PAYMENT_OPERATIONS_RELEASE_VARIABLE_NAME,
      evidence: input.action === "stage" && validatedEvidence !== null ? {
        commitSha: validatedEvidence.commitSha,
        checkedAt: validatedEvidence.checkedAt,
        captureSha256: validatedEvidence.artifacts.captureSha256,
        evidenceSha256: validatedEvidence.evidenceSha256,
      } : null,
      checks,
      applyAuthorized: input.applyRequested && ok,
    };
  }
}
