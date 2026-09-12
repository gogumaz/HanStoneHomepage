import { createHash } from "node:crypto";

type JsonObject = Record<string, unknown>;
type EvidenceCheck = { name: string; status: "pass" | "fail"; code: string };

export const PAYMENT_OPERATIONS_CHECK_NAMES = [
  "preflight", "candidateCommit", "preflightPaymentConfig", "captureSchema", "productionMode",
  "captureTimestamp", "paymentIdentity", "approval", "idempotentApproval", "webhook", "refund",
  "providerCancellation",
] as const;

export type PaymentOperationsEvidenceInput = {
  releaseId: string;
  preflight: unknown;
  capture: unknown;
  preflightSha256: string;
  captureSha256: string;
  maximumAgeHours: number;
};

export type PaymentOperationsEvidenceReport = {
  ok: boolean;
  schemaVersion: 1;
  releaseId: string;
  commitSha: string | null;
  checkedAt: string;
  capturedAt: string | null;
  paymentKeySha256: string | null;
  orderIdSha256: string | null;
  subscriptionIdSha256: string | null;
  amount: number | null;
  artifacts: { preflightSha256: string; captureSha256: string };
  checks: EvidenceCheck[];
  evidenceSha256: string;
};

function evidenceError(code: string): Error {
  const error = new Error(code);
  error.name = code;
  return error;
}

function object(value: unknown): JsonObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonObject : null;
}

function responseData(value: unknown): JsonObject | null {
  const root = object(value);
  return object(root?.data) ?? root;
}

function check(name: string, passed: boolean, code: string): EvidenceCheck {
  return { name, status: passed ? "pass" : "fail", code: passed ? "OK" : code };
}

function timestamp(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? new Date(milliseconds) : null;
}

function identifier(value: unknown, maximumLength = 200): string | null {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  return candidate.length >= 6 && candidate.length <= maximumLength && /^[A-Za-z0-9_-]+$/u.test(candidate)
    ? candidate : null;
}

function sha256(value: string | null): string | null {
  return value === null ? null : createHash("sha256").update(value, "utf8").digest("hex");
}

export class PaymentOperationsEvidenceService {
  constructor(private readonly now: () => Date = () => new Date()) {}

  run(input: PaymentOperationsEvidenceInput): PaymentOperationsEvidenceReport {
    if (!/^[A-Za-z0-9._-]{1,80}$/u.test(input.releaseId)) {
      throw evidenceError("PAYMENT_EVIDENCE_RELEASE_ID_INVALID");
    }
    if (!/^[a-fA-F0-9]{64}$/u.test(input.preflightSha256) ||
      !/^[a-fA-F0-9]{64}$/u.test(input.captureSha256)) {
      throw evidenceError("PAYMENT_EVIDENCE_ARTIFACT_SHA256_INVALID");
    }
    if (!Number.isInteger(input.maximumAgeHours) || input.maximumAgeHours < 1 || input.maximumAgeHours > 168) {
      throw evidenceError("PAYMENT_EVIDENCE_MAXIMUM_AGE_INVALID");
    }

    const preflight = object(input.preflight);
    const capture = object(input.capture);
    const configurationChecks = Array.isArray(preflight?.checks)
      ? preflight.checks.map(object).filter((entry): entry is JsonObject => entry?.name === "configuration")
      : [];
    const configuration = configurationChecks[0];
    const commitSha = typeof preflight?.evidenceCommitSha === "string" &&
      /^[a-fA-F0-9]{40}$/u.test(preflight.evidenceCommitSha)
      ? preflight.evidenceCommitSha.toLowerCase() : null;
    const captureCommitSha = typeof capture?.commitSha === "string" ? capture.commitSha.toLowerCase() : null;
    const capturedAtDate = timestamp(capture?.capturedAt);
    const preflightAtDate = timestamp(preflight?.checkedAt);
    const now = this.now();
    const captureAgeMs = capturedAtDate ? now.getTime() - capturedAtDate.getTime() : Number.POSITIVE_INFINITY;
    const captureTimeValid = capturedAtDate !== null && captureAgeMs >= 0 &&
      captureAgeMs <= input.maximumAgeHours * 60 * 60_000 &&
      preflightAtDate !== null && capturedAtDate.getTime() >= preflightAtDate.getTime();

    const paymentKey = identifier(capture?.paymentKey);
    const orderId = identifier(capture?.orderId, 64);
    const amount = typeof capture?.amount === "number" && Number.isSafeInteger(capture.amount) &&
      capture.amount > 0 && capture.amount <= 100_000_000 ? capture.amount : null;
    const approval = responseData(capture?.approvalResponse);
    const repeatedApproval = responseData(capture?.repeatedApprovalResponse);
    const webhook = responseData(capture?.webhookResponse);
    const refund = responseData(capture?.refundResponse);
    const provider = object(capture?.providerPayment);
    const approvalSubscription = object(approval?.subscription);
    const repeatedSubscription = object(repeatedApproval?.subscription);
    const subscriptionId = identifier(approvalSubscription?.id, 100);
    const paidAt = timestamp(approvalSubscription?.paidAt);
    const refundedAt = timestamp(refund?.refundedAt);
    const cancels = Array.isArray(provider?.cancels)
      ? provider.cancels.map(object).filter((entry): entry is JsonObject => entry !== null) : [];
    const canceledAtDates = cancels.map((entry) => timestamp(entry.canceledAt));
    const canceledAmount = cancels.reduce((sum, entry) => (
      typeof entry.cancelAmount === "number" && Number.isSafeInteger(entry.cancelAmount)
        ? sum + entry.cancelAmount : Number.NaN
    ), 0);
    const providerCancellationValid = paymentKey !== null && orderId !== null && amount !== null &&
      provider?.paymentKey === paymentKey && provider?.orderId === orderId && provider?.totalAmount === amount &&
      provider?.balanceAmount === 0 && provider?.status === "CANCELED" && cancels.length > 0 &&
      Number.isSafeInteger(canceledAmount) && canceledAmount === amount &&
      cancels.every((entry) => entry.cancelStatus === "DONE") &&
      canceledAtDates.every((value) => value !== null && paidAt !== null && capturedAtDate !== null &&
        value.getTime() >= paidAt.getTime() && value.getTime() <= capturedAtDate.getTime());

    const checks = [
      check("preflight", preflight?.ok === true, "PAYMENT_EVIDENCE_PREFLIGHT_NOT_SUCCESSFUL"),
      check("candidateCommit", commitSha !== null && captureCommitSha === commitSha,
        "PAYMENT_EVIDENCE_COMMIT_MISMATCH"),
      check("preflightPaymentConfig", configurationChecks.length === 1 && configuration?.status === "pass" &&
        typeof configuration.detail === "string" && configuration.detail.includes("tossPayments=configured"),
      "PAYMENT_EVIDENCE_TOSS_NOT_CONFIGURED"),
      check("captureSchema", capture?.schemaVersion === 1 && capture?.releaseId === input.releaseId,
        "PAYMENT_EVIDENCE_CAPTURE_SCHEMA_INVALID"),
      check("productionMode", capture?.mode === "live", "PAYMENT_EVIDENCE_NOT_LIVE"),
      check("captureTimestamp", captureTimeValid, "PAYMENT_EVIDENCE_CAPTURE_TIMESTAMP_INVALID"),
      check("paymentIdentity", paymentKey !== null && orderId !== null && amount !== null,
        "PAYMENT_EVIDENCE_IDENTITY_INVALID"),
      check("approval", orderId !== null && amount !== null && subscriptionId !== null && paidAt !== null &&
        approval?.orderId === orderId && approval?.amount === amount &&
        typeof approval?.method === "string" && approval.method.length > 0 && capturedAtDate !== null &&
        paidAt.getTime() <= capturedAtDate.getTime(),
      "PAYMENT_EVIDENCE_APPROVAL_INVALID"),
      check("idempotentApproval", subscriptionId !== null && repeatedApproval?.orderId === orderId &&
        repeatedApproval?.amount === amount && repeatedSubscription?.id === subscriptionId &&
        repeatedSubscription?.paidAt === approvalSubscription?.paidAt,
      "PAYMENT_EVIDENCE_REPEAT_APPROVAL_INVALID"),
      check("webhook", webhook?.received === true && webhook?.action === "no_change",
        "PAYMENT_EVIDENCE_WEBHOOK_INVALID"),
      check("refund", subscriptionId !== null && amount !== null && refund?.subscriptionId === subscriptionId &&
        refund?.orderId === orderId && refund?.paymentStatus === "refunded" && refund?.amount === amount &&
        refund?.refundedAmount === amount && refund?.accessRevoked === true && refundedAt !== null &&
        paidAt !== null && capturedAtDate !== null && refundedAt.getTime() >= paidAt.getTime() &&
        refundedAt.getTime() <= capturedAtDate.getTime(),
      "PAYMENT_EVIDENCE_REFUND_INVALID"),
      check("providerCancellation", providerCancellationValid, "PAYMENT_EVIDENCE_PROVIDER_CANCELLATION_INVALID"),
    ];
    const checkedAt = now.toISOString();
    const artifacts = {
      preflightSha256: input.preflightSha256.toLowerCase(),
      captureSha256: input.captureSha256.toLowerCase(),
    };
    const reportBase = {
      schemaVersion: 1 as const,
      releaseId: input.releaseId,
      commitSha,
      checkedAt,
      capturedAt: capturedAtDate?.toISOString() ?? null,
      paymentKeySha256: sha256(paymentKey),
      orderIdSha256: sha256(orderId),
      subscriptionIdSha256: sha256(subscriptionId),
      amount,
      artifacts,
      checks,
    };
    const evidenceSha256 = createHash("sha256").update(JSON.stringify({
      ...reportBase,
      checks: checks.map(({ name, status }) => ({ name, status })),
    }), "utf8").digest("hex");
    return { ok: checks.every(({ status }) => status === "pass"), ...reportBase, evidenceSha256 };
  }
}
