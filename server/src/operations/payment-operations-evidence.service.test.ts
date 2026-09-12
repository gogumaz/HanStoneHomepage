import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  PaymentOperationsEvidenceService,
  type PaymentOperationsEvidenceInput,
} from "./payment-operations-evidence.service.js";

const now = new Date("2026-09-12T12:00:00.000Z");
const commitSha = "a".repeat(40);
const paymentKey = "payment_live_01HZX8QWERTY1234567890";
const orderId = "subscription_order_01HZX8QWERTY";
const subscriptionId = "subscription_01HZX8QWERTY";

function validInput(): PaymentOperationsEvidenceInput {
  const approved = {
    data: {
      orderId,
      amount: 1_000,
      method: "카드",
      subscription: {
        id: subscriptionId,
        paidAt: "2026-09-12T11:31:00.000Z",
        startsAt: "2026-09-12T11:31:00.000Z",
        endsAt: "2026-10-12T15:00:00.000Z",
      },
    },
  };
  return {
    releaseId: "release-2026.09.12",
    preflightSha256: "1".repeat(64),
    captureSha256: "2".repeat(64),
    maximumAgeHours: 24,
    preflight: {
      ok: true,
      checkedAt: "2026-09-12T11:00:00.000Z",
      evidenceCommitSha: commitSha,
      checks: [{
        name: "configuration",
        status: "pass",
        detail: "oauth=kakao; tossPayments=configured; legalPolicy=guardian-link-v1",
      }],
    },
    capture: {
      schemaVersion: 1,
      releaseId: "release-2026.09.12",
      commitSha,
      capturedAt: "2026-09-12T11:45:00.000Z",
      mode: "live",
      paymentKey,
      orderId,
      amount: 1_000,
      approvalResponse: approved,
      repeatedApprovalResponse: structuredClone(approved),
      webhookResponse: { data: { received: true, action: "no_change" } },
      refundResponse: { data: {
        subscriptionId,
        orderId,
        paymentStatus: "refunded",
        amount: 1_000,
        refundedAmount: 1_000,
        refundedAt: "2026-09-12T11:44:00.000Z",
        accessRevoked: true,
      } },
      providerPayment: {
        paymentKey,
        orderId,
        totalAmount: 1_000,
        balanceAmount: 0,
        status: "CANCELED",
        customerEmail: "private@example.com",
        cancels: [{
          cancelAmount: 1_000,
          cancelStatus: "DONE",
          canceledAt: "2026-09-12T20:44:00+09:00",
          transactionKey: "private-transaction-key",
        }],
      },
    },
  };
}

describe("PaymentOperationsEvidenceService", () => {
  it("binds a live approval, repeat, webhook, refund, and provider cancellation without leaking identifiers", () => {
    const report = new PaymentOperationsEvidenceService(() => now).run(validInput());

    expect(report).toMatchObject({
      ok: true,
      schemaVersion: 1,
      releaseId: "release-2026.09.12",
      commitSha,
      capturedAt: "2026-09-12T11:45:00.000Z",
      amount: 1_000,
      paymentKeySha256: createHash("sha256").update(paymentKey).digest("hex"),
      orderIdSha256: createHash("sha256").update(orderId).digest("hex"),
      subscriptionIdSha256: createHash("sha256").update(subscriptionId).digest("hex"),
      artifacts: { preflightSha256: "1".repeat(64), captureSha256: "2".repeat(64) },
    });
    expect(report.checks).toHaveLength(12);
    expect(report.checks.every(({ status }) => status === "pass")).toBe(true);
    expect(report.evidenceSha256).toMatch(/^[a-f0-9]{64}$/u);
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain(paymentKey);
    expect(serialized).not.toContain(orderId);
    expect(serialized).not.toContain(subscriptionId);
    expect(serialized).not.toContain("private@example.com");
    expect(serialized).not.toContain("private-transaction-key");
  });

  it("rejects a test capture and a capture for another candidate", () => {
    const input = validInput();
    const capture = input.capture as { mode: string; commitSha: string };
    capture.mode = "test";
    capture.commitSha = "b".repeat(40);
    const report = new PaymentOperationsEvidenceService(() => now).run(input);

    expect(report.checks).toContainEqual({
      name: "productionMode", status: "fail", code: "PAYMENT_EVIDENCE_NOT_LIVE",
    });
    expect(report.checks).toContainEqual({
      name: "candidateCommit", status: "fail", code: "PAYMENT_EVIDENCE_COMMIT_MISMATCH",
    });
  });

  it("rejects a duplicate approval that issued a different subscription", () => {
    const input = validInput();
    const capture = input.capture as { repeatedApprovalResponse: { data: { subscription: { id: string } } } };
    capture.repeatedApprovalResponse.data.subscription.id = "subscription_different_01";
    expect(new PaymentOperationsEvidenceService(() => now).run(input).checks).toContainEqual({
      name: "idempotentApproval", status: "fail", code: "PAYMENT_EVIDENCE_REPEAT_APPROVAL_INVALID",
    });
  });

  it("rejects incomplete refund state and a provider balance that remains", () => {
    const input = validInput();
    const capture = input.capture as {
      refundResponse: { data: { accessRevoked: boolean; refundedAmount: number } };
      providerPayment: { balanceAmount: number; cancels: Array<{ cancelAmount: number }> };
    };
    capture.refundResponse.data.accessRevoked = false;
    capture.refundResponse.data.refundedAmount = 500;
    capture.providerPayment.balanceAmount = 500;
    capture.providerPayment.cancels[0]!.cancelAmount = 500;
    const report = new PaymentOperationsEvidenceService(() => now).run(input);

    expect(report.checks).toContainEqual({
      name: "refund", status: "fail", code: "PAYMENT_EVIDENCE_REFUND_INVALID",
    });
    expect(report.checks).toContainEqual({
      name: "providerCancellation", status: "fail", code: "PAYMENT_EVIDENCE_PROVIDER_CANCELLATION_INVALID",
    });
  });

  it("rejects refund and cancellation timestamps outside the captured operation window", () => {
    const input = validInput();
    const capture = input.capture as {
      refundResponse: { data: { refundedAt: string } };
      providerPayment: { cancels: Array<{ canceledAt: string }> };
    };
    capture.refundResponse.data.refundedAt = "2026-09-12T11:30:00.000Z";
    capture.providerPayment.cancels[0]!.canceledAt = "2026-09-12T11:46:00.000Z";
    const report = new PaymentOperationsEvidenceService(() => now).run(input);

    expect(report.checks).toContainEqual({
      name: "refund", status: "fail", code: "PAYMENT_EVIDENCE_REFUND_INVALID",
    });
    expect(report.checks).toContainEqual({
      name: "providerCancellation", status: "fail", code: "PAYMENT_EVIDENCE_PROVIDER_CANCELLATION_INVALID",
    });
  });

  it("rejects stale, future, and pre-preflight captures", () => {
    const stale = validInput();
    (stale.capture as { capturedAt: string }).capturedAt = "2026-09-10T00:00:00.000Z";
    expect(new PaymentOperationsEvidenceService(() => now).run(stale).checks).toContainEqual({
      name: "captureTimestamp", status: "fail", code: "PAYMENT_EVIDENCE_CAPTURE_TIMESTAMP_INVALID",
    });

    const future = validInput();
    (future.capture as { capturedAt: string }).capturedAt = "2026-09-12T13:00:00.000Z";
    expect(new PaymentOperationsEvidenceService(() => now).run(future).checks).toContainEqual({
      name: "captureTimestamp", status: "fail", code: "PAYMENT_EVIDENCE_CAPTURE_TIMESTAMP_INVALID",
    });
  });

  it.each([
    ["release ID", { releaseId: "../unsafe" }, "PAYMENT_EVIDENCE_RELEASE_ID_INVALID"],
    ["artifact hash", { captureSha256: "invalid" }, "PAYMENT_EVIDENCE_ARTIFACT_SHA256_INVALID"],
    ["maximum age", { maximumAgeHours: 0 }, "PAYMENT_EVIDENCE_MAXIMUM_AGE_INVALID"],
  ])("rejects invalid %s input", (_label, override, errorName) => {
    expect(() => new PaymentOperationsEvidenceService(() => now).run({ ...validInput(), ...override }))
      .toThrowError(expect.objectContaining({ name: errorName }));
  });
});
