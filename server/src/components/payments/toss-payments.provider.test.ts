import { Buffer } from "node:buffer";
import { describe, expect, it, vi } from "vitest";
import { PaymentComponentError } from "./payment-provider.js";
import { TossPaymentsProvider } from "./toss-payments.provider.js";

const paidPayment = {
  paymentKey: "payment-key",
  orderId: "order-direct-toss",
  status: "DONE",
  totalAmount: 50_000,
  method: "카드",
  approvedAt: "2026-08-24T12:00:00+09:00",
  cancels: null,
};

describe("TossPaymentsProvider", () => {
  it("retrieves and maps a Toss payment with Basic authorization", async () => {
    const requestFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(paidPayment)));
    const provider = new TossPaymentsProvider({
      secretKey: "test_sk_component",
      apiBaseUrl: "https://payments.example.test/v1",
      fetch: requestFetch,
    });

    await expect(provider.getPayment("payment/key")).resolves.toMatchObject({
      provider: "toss-payments",
      paymentId: "payment-key",
      orderId: "order-direct-toss",
      status: "paid",
      amount: 50_000,
      method: "카드",
      cancelAmount: 0,
    });
    expect(requestFetch).toHaveBeenCalledWith(
      "https://payments.example.test/v1/payments/payment%2Fkey",
      { headers: {
        Authorization: `Basic ${Buffer.from("test_sk_component:").toString("base64")}`,
        "Content-Type": "application/json",
      } },
    );
  });

  it("confirms an authenticated payment with an idempotency key", async () => {
    const requestFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(paidPayment)));
    const provider = new TossPaymentsProvider({ secretKey: "secret", fetch: requestFetch });

    await provider.confirmPayment({
      paymentId: "payment-key",
      orderId: "order-direct-toss",
      amount: 50_000,
      idempotencyKey: "confirm-request-id",
    });

    expect(requestFetch).toHaveBeenCalledWith(
      "https://api.tosspayments.com/v1/payments/confirm",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "Idempotency-Key": "confirm-request-id" }),
        body: JSON.stringify({
          paymentKey: "payment-key",
          orderId: "order-direct-toss",
          amount: 50_000,
        }),
      }),
    );
  });

  it("cancels a payment and maps the cumulative cancellation history", async () => {
    const requestFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ...paidPayment,
      status: "CANCELED",
      cancels: [
        { cancelAmount: 10_000, cancelStatus: "DONE", canceledAt: "2026-08-24T13:00:00+09:00" },
        { cancelAmount: 40_000, cancelStatus: "DONE", canceledAt: "2026-08-24T14:00:00+09:00" },
      ],
    })));
    const provider = new TossPaymentsProvider({ secretKey: "secret", fetch: requestFetch });

    const payment = await provider.cancelPayment({
      paymentId: "payment-key",
      amount: 40_000,
      checksum: 40_000,
      reason: "customer request",
      idempotencyKey: "cancel-request-id",
    });

    expect(payment).toMatchObject({ status: "cancelled", cancelAmount: 50_000 });
    expect(payment.cancelledAt?.toISOString()).toBe("2026-08-24T05:00:00.000Z");
    expect(requestFetch).toHaveBeenCalledWith(
      "https://api.tosspayments.com/v1/payments/payment-key/cancel",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "Idempotency-Key": "cancel-request-id" }),
        body: JSON.stringify({ cancelReason: "customer request", cancelAmount: 40_000 }),
      }),
    );
  });

  it("keeps a partially canceled payment refundable through the portable paid status", async () => {
    const requestFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ...paidPayment,
      status: "PARTIAL_CANCELED",
      cancels: [{ cancelAmount: 10_000, cancelStatus: "DONE", canceledAt: "2026-08-24T13:00:00+09:00" }],
    })));
    const provider = new TossPaymentsProvider({ secretKey: "secret", fetch: requestFetch });

    await expect(provider.getPayment("payment-key")).resolves.toMatchObject({
      status: "paid",
      cancelAmount: 10_000,
    });
  });

  it("returns portable configuration and retryable provider errors", async () => {
    const missing = new TossPaymentsProvider({ secretKey: null });
    await expect(missing.getPayment("payment-key")).rejects.toMatchObject({
      code: "NOT_CONFIGURED",
      retryable: false,
    } satisfies Partial<PaymentComponentError>);

    const unavailable = new TossPaymentsProvider({
      secretKey: "secret",
      fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: "COMMON_ERROR" }), { status: 503 })),
    });
    await expect(unavailable.getPayment("payment-key")).rejects.toMatchObject({
      code: "PROVIDER_ERROR",
      retryable: true,
    } satisfies Partial<PaymentComponentError>);
  });
});
