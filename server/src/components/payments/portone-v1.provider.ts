import {
  type CancelPaymentInput,
  PaymentComponentError,
  type PaymentProvider,
  type PaymentRecord,
  type PaymentStatus,
} from "./payment-provider.js";

type PortOneEnvelope<T> = { code?: number; message?: string; response?: T };
type PortOnePayment = {
  imp_uid?: string;
  merchant_uid?: string;
  status?: string;
  amount?: number;
  pay_method?: string;
  paid_at?: number;
  cancelled_at?: number;
  cancel_amount?: number;
};

export type PortOneV1Options = {
  apiKey: string | null;
  apiSecret: string | null;
  apiBaseUrl?: string;
  fetch?: typeof fetch;
};

const PAYMENT_STATUSES = new Set<PaymentStatus>(["ready", "paid", "cancelled", "failed"]);

export class PortOneV1PaymentProvider implements PaymentProvider {
  readonly providerId = "portone-v1";
  private readonly apiBaseUrl: string;
  private readonly requestFetch: typeof fetch;

  constructor(private readonly options: PortOneV1Options) {
    this.apiBaseUrl = (options.apiBaseUrl ?? "https://api.iamport.kr").replace(/\/$/, "");
    this.requestFetch = options.fetch ?? fetch;
  }

  async verifyConnection(signal?: AbortSignal): Promise<void> {
    await this.getAccessToken(signal);
  }

  async getPayment(paymentId: string): Promise<PaymentRecord> {
    const accessToken = await this.getAccessToken();
    const payment = await this.request<PortOnePayment>(
      `/payments/${encodeURIComponent(paymentId)}`,
      { headers: { Authorization: accessToken } },
    );
    return this.parsePayment(payment);
  }

  async cancelPayment(input: CancelPaymentInput): Promise<PaymentRecord> {
    const accessToken = await this.getAccessToken();
    const payment = await this.request<PortOnePayment>("/payments/cancel", {
      method: "POST",
      headers: { Authorization: accessToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        imp_uid: input.paymentId,
        amount: input.amount,
        checksum: input.checksum,
        reason: input.reason,
      }),
    });
    return this.parsePayment(payment);
  }

  private async getAccessToken(signal?: AbortSignal): Promise<string> {
    if (!this.options.apiKey || !this.options.apiSecret) {
      throw new PaymentComponentError("NOT_CONFIGURED", "Payment provider credentials are missing.", false);
    }
    const token = await this.request<{ access_token?: string }>("/users/getToken", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imp_key: this.options.apiKey, imp_secret: this.options.apiSecret }),
      ...(signal ? { signal } : {}),
    });
    if (!token.access_token) {
      throw new PaymentComponentError("INVALID_RESPONSE", "Payment provider token response is invalid.", false);
    }
    return token.access_token;
  }

  private parsePayment(payment: PortOnePayment): PaymentRecord {
    const status = payment.status as PaymentStatus;
    const paidAt = Number(payment.paid_at ?? 0);
    const cancelledAt = Number(payment.cancelled_at ?? 0);
    const cancelAmount = Number(payment.cancel_amount ?? 0);
    if (
      !payment.imp_uid
      || !payment.merchant_uid
      || !PAYMENT_STATUSES.has(status)
      || !Number.isFinite(Number(payment.amount))
      || !Number.isFinite(cancelAmount)
      || cancelAmount < 0
    ) {
      throw new PaymentComponentError("INVALID_RESPONSE", "Payment provider response is invalid.", false);
    }
    return {
      provider: this.providerId,
      paymentId: payment.imp_uid,
      orderId: payment.merchant_uid,
      status,
      amount: Number(payment.amount),
      method: typeof payment.pay_method === "string" ? payment.pay_method : null,
      paidAt: paidAt > 0 ? new Date(paidAt * 1000) : null,
      cancelledAt: cancelledAt > 0 ? new Date(cancelledAt * 1000) : null,
      cancelAmount,
    };
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    try {
      const response = await this.requestFetch(`${this.apiBaseUrl}${path}`, init);
      const payload = await response.json() as PortOneEnvelope<T>;
      if (!response.ok || payload.code !== 0 || !payload.response) {
        throw new PaymentComponentError("PROVIDER_ERROR", "Payment provider request failed.", response.status >= 500);
      }
      return payload.response;
    } catch (error) {
      if (error instanceof PaymentComponentError) throw error;
      throw new PaymentComponentError("PROVIDER_ERROR", "Payment provider request failed.", true);
    }
  }
}
