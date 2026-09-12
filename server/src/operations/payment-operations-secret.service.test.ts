import { describe, expect, it } from "vitest";
import {
  PAYMENT_OPERATIONS_CHECK_NAMES,
  type PaymentOperationsEvidenceReport,
} from "./payment-operations-evidence.service.js";
import {
  PAYMENT_OPERATIONS_RELEASE_VARIABLE_NAME,
  PAYMENT_OPERATIONS_SECRET_NAME,
  PAYMENT_OPERATIONS_SECRET_REMOVE_CONFIRMATION,
  PAYMENT_OPERATIONS_SECRET_STAGE_CONFIRMATION,
  PaymentOperationsSecretService,
  type PaymentOperationsSecretInput,
} from "./payment-operations-secret.service.js";

const releaseId = "release-2026.09.13";

function evidence(): PaymentOperationsEvidenceReport {
  return {
    ok: true,
    schemaVersion: 1,
    releaseId,
    commitSha: "a".repeat(40),
    checkedAt: "2026-09-13T01:00:00.000Z",
    capturedAt: "2026-09-13T00:59:00.000Z",
    paymentKeySha256: "1".repeat(64),
    orderIdSha256: "2".repeat(64),
    subscriptionIdSha256: "3".repeat(64),
    amount: 1_000,
    artifacts: { preflightSha256: "4".repeat(64), captureSha256: "5".repeat(64) },
    checks: PAYMENT_OPERATIONS_CHECK_NAMES.map((name) => ({ name, status: "pass" as const, code: "OK" })),
    evidenceSha256: "6".repeat(64),
  };
}

function validInput(): PaymentOperationsSecretInput {
  return {
    repository: "example/baduk-history",
    actorLogin: "gogumaz",
    releaseId,
    localCommitSha: "a".repeat(40),
    remoteDefaultCommitSha: "a".repeat(40),
    action: "stage",
    secretPresent: false,
    markerReleaseId: null,
    evidence: evidence(),
    applyRequested: false,
    confirmation: null,
  };
}

describe("PaymentOperationsSecretService", () => {
  it("creates a value-free staging plan bound to the validated release evidence", () => {
    const report = new PaymentOperationsSecretService().plan(validInput());

    expect(report).toMatchObject({
      ok: true,
      mode: "dry-run",
      action: "stage",
      releaseId,
      secretName: PAYMENT_OPERATIONS_SECRET_NAME,
      markerVariableName: PAYMENT_OPERATIONS_RELEASE_VARIABLE_NAME,
      evidence: {
        commitSha: "a".repeat(40),
        captureSha256: "5".repeat(64),
        evidenceSha256: "6".repeat(64),
      },
      applyAuthorized: false,
    });
    expect(JSON.stringify(report)).not.toContain("paymentKey");
  });

  it("requires the exact staging confirmation before apply", () => {
    const service = new PaymentOperationsSecretService();
    const rejected = service.plan({ ...validInput(), applyRequested: true });
    const accepted = service.plan({
      ...validInput(), applyRequested: true, confirmation: PAYMENT_OPERATIONS_SECRET_STAGE_CONFIRMATION,
    });

    expect(rejected.applyAuthorized).toBe(false);
    expect(rejected.checks).toContainEqual({
      name: "applyConfirmation", status: "fail", code: "PAYMENT_SECRET_CONFIRMATION_REQUIRED",
    });
    expect(accepted.applyAuthorized).toBe(true);
  });

  it("will not overwrite an existing capture or release marker", () => {
    const report = new PaymentOperationsSecretService().plan({
      ...validInput(), secretPresent: true, markerReleaseId: "release-older",
    });

    expect(report.checks).toContainEqual({
      name: "resourceState", status: "fail", code: "PAYMENT_SECRET_ALREADY_STAGED",
    });
  });

  it("requires evidence for the current published candidate", () => {
    const local = new PaymentOperationsSecretService().plan({
      ...validInput(), localCommitSha: "b".repeat(40),
    });
    const remote = new PaymentOperationsSecretService().plan({
      ...validInput(), remoteDefaultCommitSha: "b".repeat(40),
    });

    expect(local.checks).toContainEqual({
      name: "candidatePublished", status: "fail", code: "PAYMENT_SECRET_CANDIDATE_NOT_PUBLISHED",
    });
    expect(remote.checks).toContainEqual({
      name: "candidatePublished", status: "fail", code: "PAYMENT_SECRET_CANDIDATE_NOT_PUBLISHED",
    });
  });

  it("authorizes removal only for the matching release marker and exact confirmation", () => {
    const service = new PaymentOperationsSecretService();
    const matching = service.plan({
      ...validInput(), action: "remove", secretPresent: true, markerReleaseId: releaseId,
      evidence: null, applyRequested: true, confirmation: PAYMENT_OPERATIONS_SECRET_REMOVE_CONFIRMATION,
    });
    const stale = service.plan({
      ...validInput(), action: "remove", secretPresent: true, markerReleaseId: "release-other", evidence: null,
    });

    expect(matching.ok).toBe(true);
    expect(matching.applyAuthorized).toBe(true);
    expect(matching.evidence).toBeNull();
    expect(stale.checks).toContainEqual({
      name: "resourceState", status: "fail", code: "PAYMENT_SECRET_RELEASE_MISMATCH",
    });
  });

  it("rejects failed evidence and unexpected operators", () => {
    const failedEvidence = evidence();
    failedEvidence.ok = false;
    const reorderedEvidence = evidence();
    reorderedEvidence.checks.reverse();
    const failed = new PaymentOperationsSecretService().plan({ ...validInput(), evidence: failedEvidence });
    const reordered = new PaymentOperationsSecretService().plan({ ...validInput(), evidence: reorderedEvidence });
    const operator = new PaymentOperationsSecretService().plan({ ...validInput(), actorLogin: "another-user" });

    expect(failed.checks).toContainEqual({
      name: "evidence", status: "fail", code: "PAYMENT_SECRET_EVIDENCE_INVALID",
    });
    expect(reordered.checks).toContainEqual({
      name: "evidence", status: "fail", code: "PAYMENT_SECRET_EVIDENCE_INVALID",
    });
    expect(operator.checks).toContainEqual({
      name: "soloOperator", status: "fail", code: "PAYMENT_SECRET_SOLO_OPERATOR_MISMATCH",
    });
  });

  it("rejects malformed repository and release identifiers", () => {
    const service = new PaymentOperationsSecretService();
    expect(() => service.plan({ ...validInput(), repository: "../unsafe" }))
      .toThrowError(expect.objectContaining({ name: "PAYMENT_SECRET_REPOSITORY_INVALID" }));
    expect(() => service.plan({ ...validInput(), releaseId: "../unsafe" }))
      .toThrowError(expect.objectContaining({ name: "PAYMENT_SECRET_RELEASE_ID_INVALID" }));
  });
});
