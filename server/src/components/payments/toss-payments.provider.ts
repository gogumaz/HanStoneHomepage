import { Buffer } from "node:buffer";
import {
  type CancelPaymentInput,
  type ConfirmPaymentInput,
  PaymentComponentError,
  type PaymentProvider,
  type PaymentRecord,
  type PaymentStatus,
} from "./payment-provider.js";

type TossPaymentCancel = {
  cancelAmount?: number;
  canceledAt?: string;
  cancelStatus?: string;
};

type TossPayment = {
  paymentKey?: string;
  orderId?: string;
  status?: string;
  totalAmount?: number;
  method?: string;
  approvedAt?: string | null;
  cancels?: TossPaymentCancel[] | null;
};

export type TossPaymentsOptions = {
  secretKey: string | null;
  apiBaseUrl?: string;
  fetch?: typeof fetch;
};

const STATUS_MAP: Readonly<Record<string, PaymentStatus>> = Object.freeze({
  READY: "ready",
  IN_PROGRESS: "ready",
  WAITING_FOR_DEPOSIT: "ready",
  DONE: "paid",
  PARTIAL_CANCELED: "paid",
  CANCELED: "cancelled",
  ABORTED: "failed",
  EXPIRED: "failed",
});

export class TossPaymentsProvider implements PaymentProvider {
  readonly providerId = "toss-payments";
  private readonly apiBaseUrl: string;
  private readonly requestFetch: typeof fetch;

  constructor(private readonly options: TossPaymentsOptions) {
    this.apiBaseUrl = (options.apiBaseUrl ?? "https://api.tosspayments.com/v1").replace(/\/$/, "");
    this.requestFetch = options.fetch ?? fetch;
  }

  async confirmPayment(input: ConfirmPaymentInput): Promise<PaymentRecord> {
    return this.requestPayment("/payments/confirm", {
      method: "POST",
      headers: this.headers(input.idempotencyKey),
      body: JSON.stringify({
        paymentKey: input.paymentId,
        orderId: input.orderId,
        amount: input.amount,
      }),
    });
  }

  async getPayment(paymentId: string): Promise<PaymentRecord> {
    return this.requestPayment(`/payments/${encodeURIComponent(paymentId)}`, {
      headers: this.headers(),
    });
  }

  async cancelPayment(input: CancelPaymentInput): Promise<PaymentRecord> {
    return this.requestPayment(`/payments/${encodeURIComponent(input.paymentId)}/cancel`, {
      method: "POST",
      headers: this.headers(input.idempotencyKey),
      body: JSON.stringify({
        cancelReason: input.reason,
        cancelAmount: input.amount,
      }),
    });
  }

  private headers(idempotencyKey?: string): Record<string, string> {
    const secretKey = this.options.secretKey?.trim();
    if (!secretKey) {
      throw new PaymentComponentError("NOT_CONFIGURED", "Payment provider credentials are missing.", false);
    }
    return {
      Authorization: `Basic ${Buffer.from(`${secretKey}:`, "utf8").toString("base64")}`,
      "Content-Type": "application/json",
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    };
  }

  private async requestPayment(path: string, init: RequestInit): Promise<PaymentRecord> {
    try {
      const response = await this.requestFetch(`${this.apiBaseUrl}${path}`, init);
      const payload = await response.json().catch(() => null) as TossPayment | null;
      if (!response.ok) {
        throw new PaymentComponentError(
          "PROVIDER_ERROR",
          "Payment provider request failed.",
          response.status === 429 || response.status >= 500,
        );
      }
      return this.parsePayment(payload);
    } catch (error) {
      if (error instanceof PaymentComponentError) throw error;
      throw new PaymentComponentError("PROVIDER_ERROR", "Payment provider request failed.", true);
    }
  }

  private parsePayment(payment: TossPayment | null): PaymentRecord {
    const status = payment?.status ? STATUS_MAP[payment.status] : undefined;
    const amount = Number(payment?.totalAmount);
    const cancels = payment?.cancels ?? [];
    const cancelAmounts = cancels.map((cancel) => Number(cancel.cancelAmount));
    if (
      !payment?.paymentKey
      || !payment.orderId
      || !status
      || !Number.isInteger(amount)
      || amount < 0
      || cancelAmounts.some((cancelAmount) => !Number.isInteger(cancelAmount) || cancelAmount < 0)
    ) {
      throw new PaymentComponentError("INVALID_RESPONSE", "Payment provider response is invalid.", false);
    }

    const completedCancellations = cancels
      .filter((cancel) => cancel.cancelStatus === "DONE" && cancel.canceledAt)
      .map((cancel) => new Date(String(cancel.canceledAt)))
      .filter((date) => !Number.isNaN(date.getTime()))
      .sort((left, right) => right.getTime() - left.getTime());
    const paidAt = payment.approvedAt ? new Date(payment.approvedAt) : null;
    if (paidAt && Number.isNaN(paidAt.getTime())) {
      throw new PaymentComponentError("INVALID_RESPONSE", "Payment provider response is invalid.", false);
    }

    return {
      provider: this.providerId,
      paymentId: payment.paymentKey,
      orderId: payment.orderId,
      status,
      amount,
      method: typeof payment.method === "string" ? payment.method : null,
      paidAt,
      cancelledAt: completedCancellations[0] ?? null,
      cancelAmount: cancelAmounts.reduce((total, cancelAmount) => total + cancelAmount, 0),
    };
  }
}
