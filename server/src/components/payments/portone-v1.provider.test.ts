import { describe, expect, it, vi } from "vitest";
import { PaymentComponentError } from "./payment-provider.js";
import { PortOneV1PaymentProvider } from "./portone-v1.provider.js";

describe("PortOneV1PaymentProvider", () => {
  it("maps PortOne credentials and payment data to the reusable contract", async () => {
    const requestFetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 0,
        response: { access_token: "provider-access-token" },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 0,
        response: {
          imp_uid: "imp_component_test",
          merchant_uid: "order-component-test",
          status: "paid",
          amount: 50_000,
          pay_method: "card",
          paid_at: 1_800_000_000,
          cancel_amount: 0,
        },
      }), { status: 200 }));
    const provider = new PortOneV1PaymentProvider({
      apiKey: "api-key",
      apiSecret: "api-secret",
      apiBaseUrl: "https://payments.example.test",
      fetch: requestFetch,
    });

    await expect(provider.getPayment("imp_component_test")).resolves.toMatchObject({
      provider: "portone-v1",
      paymentId: "imp_component_test",
      orderId: "order-component-test",
      status: "paid",
      amount: 50_000,
      method: "card",
      cancelAmount: 0,
    });
    expect(requestFetch).toHaveBeenNthCalledWith(
      2,
      "https://payments.example.test/payments/imp_component_test",
      { headers: { Authorization: "provider-access-token" } },
    );
  });

  it("uses a provider-independent cancellation input", async () => {
    const requestFetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, response: { access_token: "token" } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 0,
        response: {
          imp_uid: "imp_cancel", merchant_uid: "order_cancel", status: "cancelled",
          amount: 10_000, cancel_amount: 10_000, cancelled_at: 1_800_000_100,
        },
      })));
    const provider = new PortOneV1PaymentProvider({
      apiKey: "key", apiSecret: "secret", fetch: requestFetch,
    });

    await provider.cancelPayment({ paymentId: "imp_cancel", amount: 10_000, checksum: 10_000, reason: "customer request" });
    const request = requestFetch.mock.calls[1]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toEqual({
      imp_uid: "imp_cancel", amount: 10_000, checksum: 10_000, reason: "customer request",
    });
  });

  it("returns a portable configuration error without application dependencies", async () => {
    const provider = new PortOneV1PaymentProvider({ apiKey: null, apiSecret: null });
    await expect(provider.getPayment("imp_missing")).rejects.toMatchObject({
      name: "PaymentComponentError",
      code: "NOT_CONFIGURED",
    } satisfies Partial<PaymentComponentError>);
  });

  it("verifies credentials without looking up or changing a payment", async () => {
    const requestFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 0,
      response: { access_token: "preflight-token" },
    }), { status: 200 }));
    const provider = new PortOneV1PaymentProvider({
      apiKey: "key",
      apiSecret: "secret",
      apiBaseUrl: "https://payments.example.test",
      fetch: requestFetch,
    });

    await expect(provider.verifyConnection()).resolves.toBeUndefined();

    expect(requestFetch).toHaveBeenCalledOnce();
    expect(requestFetch).toHaveBeenCalledWith(
      "https://payments.example.test/users/getToken",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
