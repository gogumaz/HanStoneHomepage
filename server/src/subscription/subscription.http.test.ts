import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "../app.module.js";
import { hashSessionToken } from "../auth/session-cookie.js";
import { ApiExceptionFilter } from "../common/api-exception.filter.js";
import { ApiResponseInterceptor } from "../common/api-response.interceptor.js";
import { RequestIdMiddleware } from "../common/request-id.middleware.js";
import { PrismaService } from "../database/prisma.service.js";
import {
  AccountStatus,
  RoleType,
  SubscriptionOrderStatus,
  SubscriptionPaymentStatus,
} from "../generated/prisma/enums.js";
import { PAYMENT_PROVIDER } from "../components/payments/index.js";
import { calculateSubscriptionEnd } from "./subscription.service.js";

type Value = Record<string, any>;

function createStore() {
  const users = [
    {
      id: "student-payment", email: "pay@example.com", displayName: "결제 학생",
      status: AccountStatus.ACTIVE, roles: [{ role: RoleType.STUDENT }],
    },
    {
      id: "operator-payment", email: "operator@example.com", displayName: "결제 운영자",
      status: AccountStatus.ACTIVE, roles: [{ role: RoleType.OPERATOR }],
    },
  ];
  const plans = [
    { id: "subscription-1m", label: "1개월", months: 1, price: 10000, active: true },
    { id: "subscription-6m", label: "6개월", months: 6, price: 50000, active: true },
  ];
  const orders: Value[] = [];
  const subscriptions: Value[] = [];
  const refunds: Value[] = [];

  const prisma = {
    session: {
      findUnique: vi.fn(async ({ where, include }: Value) => {
        const tokenUsers = new Map([
          [hashSessionToken("payment-token"), users[0]],
          [hashSessionToken("operator-payment-token"), users[1]],
        ]);
        const user = tokenUsers.get(where.tokenHash);
        if (!user) return null;
        const session = {
          id: "session-payment", userId: user.id, tokenHash: where.tokenHash,
          expiresAt: new Date(Date.now() + 60_000), revokedAt: null,
        };
        return include ? { ...session, user } : session;
      }),
    },
    subscriptionPlan: {
      findFirst: vi.fn(async ({ where }: Value) =>
        plans.find((plan) => plan.id === where.id && plan.active === where.active) ?? null),
      findMany: vi.fn(async () => plans),
    },
    subscriptionOrder: {
      findFirst: vi.fn(async ({ where }: Value) => orders.find((order) => {
        if (where.id && order.id !== where.id) return false;
        if (where.userId && order.userId !== where.userId) return false;
        if (where.status && order.status !== where.status) return false;
        if (where.expiresAt?.gt && order.expiresAt <= where.expiresAt.gt) return false;
        return true;
      }) ?? null),
      findUnique: vi.fn(async ({ where }: Value) => {
        if (where.id) return orders.find((order) => order.id === where.id) ?? null;
        return orders.find((order) => order.providerPaymentId === where.providerPaymentId) ?? null;
      }),
      findMany: vi.fn(async ({ where, include, take }: Value) => orders
        .filter((order) => {
          if (where?.userId && order.userId !== where.userId) return false;
          if (where?.status && order.status !== where.status) return false;
          if (where?.createdAt?.gte && order.createdAt < where.createdAt.gte) return false;
          if (where?.createdAt?.lt && order.createdAt >= where.createdAt.lt) return false;
          return true;
        })
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map((order) => include?.user
          ? { ...order, user: users.find((user) => user.id === order.userId) }
          : order)
        .slice(0, take ?? orders.length)),
      create: vi.fn(async ({ data }: Value) => {
        const order = {
          provider: "portone-v1", providerPaymentId: null, paymentMethod: null,
          paidAt: null, status: SubscriptionOrderStatus.PENDING,
          refundedAmount: 0, refundedAt: null,
          createdAt: new Date(), updatedAt: new Date(), ...data,
        };
        orders.push(order);
        return order;
      }),
      update: vi.fn(async ({ where, data }: Value) => {
        const order = orders.find((item) => item.id === where.id);
        Object.assign(order ?? {}, data, { updatedAt: new Date() });
        return order;
      }),
      updateMany: vi.fn(async ({ where, data }: Value) => {
        const order = orders.find((item) => item.id === where.id && item.status === where.status);
        if (!order) return { count: 0 };
        Object.assign(order, data, { updatedAt: new Date() });
        return { count: 1 };
      }),
    },
    accountSubscription: {
      findFirst: vi.fn(async ({ where }: Value) => subscriptions.find((subscription) =>
        subscription.userId === where.userId
        && subscription.paymentStatus === where.paymentStatus
        && subscription.startsAt <= where.startsAt.lte
        && subscription.endsAt > where.endsAt.gt) ?? null),
      findUnique: vi.fn(async ({ where }: Value) =>
        subscriptions.find((subscription) => where.orderId
          ? subscription.orderId === where.orderId
          : subscription.id === where.id) ?? null),
      findMany: vi.fn(async ({ where, include }: Value) => subscriptions
        .filter((subscription) => {
          if (where?.userId && subscription.userId !== where.userId) return false;
          if (where?.orderId?.in && !where.orderId.in.includes(subscription.orderId)) return false;
          return true;
        })
        .sort((a, b) => b.paidAt.getTime() - a.paidAt.getTime())
        .map((subscription) => include?.refunds
          ? { ...subscription, refunds: refunds.filter((refund) => refund.subscriptionId === subscription.id) }
          : subscription)),
      create: vi.fn(async ({ data }: Value) => {
        const subscription = {
          id: `subscription-${subscriptions.length + 1}`,
          paymentStatus: SubscriptionPaymentStatus.PAID,
          refundedAmount: 0, refundedAt: null,
          createdAt: new Date(), updatedAt: new Date(), ...data,
        };
        subscriptions.push(subscription);
        return subscription;
      }),
      update: vi.fn(async ({ where, data }: Value) => {
        const subscription = subscriptions.find((item) => item.id === where.id);
        Object.assign(subscription ?? {}, data, { updatedAt: new Date() });
        return subscription;
      }),
    },
    subscriptionRefund: {
      upsert: vi.fn(async ({ where, create }: Value) => {
        const existing = refunds.find((refund) => refund.providerCancellationId === where.providerCancellationId);
        if (existing) return existing;
        const refund = { id: `refund-${refunds.length + 1}`, ...create };
        refunds.push(refund);
        return refund;
      }),
    },
    auditLog: { create: vi.fn(async () => ({ id: "audit-payment" })) },
    isReady: vi.fn(async () => true),
    $transaction: vi.fn(async (input: unknown) => {
      if (typeof input === "function") return (input as (transaction: typeof prisma) => unknown)(prisma);
      return Promise.all(input as Promise<unknown>[]);
    }),
  };
  return { prisma: prisma as unknown as PrismaService, orders, subscriptions, refunds };
}

describe("subscription checkout HTTP API", () => {
  let app: INestApplication;
  let baseUrl: string;
  const store = createStore();
  const providerState = {
    status: "paid",
    cancelAmount: 0,
    cancelledAt: null as Date | null,
  };
  const provider = {
    getPayment: vi.fn(async (paymentId: string) => {
      const order = store.orders.at(-1);
      return {
        paymentId,
        orderId: order?.id ?? "missing",
        amount: paymentId === "imp_wrong_amount" ? 1 : order?.amount ?? 0,
        method: "card",
        paidAt: new Date(Date.now() - 60_000),
        status: providerState.status,
        cancelAmount: providerState.cancelAmount,
        cancelledAt: providerState.cancelledAt,
      };
    }),
    cancelPayment: vi.fn(async ({ paymentId, amount }: { paymentId: string; amount: number }) => {
      const order = store.orders[0];
      providerState.cancelAmount += amount;
      providerState.status = "cancelled";
      providerState.cancelledAt = new Date();
      return {
        paymentId,
        orderId: order?.id ?? "missing",
        status: providerState.status,
        amount: order?.amount ?? 0,
        method: "card",
        paidAt: new Date(Date.now() - 60_000),
        cancelAmount: providerState.cancelAmount,
        cancelledAt: providerState.cancelledAt,
      };
    }),
  };
  const cookie = { cookie: "baduk_session=payment-token", "content-type": "application/json" };
  const operatorCookie = { cookie: "baduk_session=operator-payment-token", "content-type": "application/json" };

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5432/test";
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService).useValue(store.prisma)
      .overrideProvider(PAYMENT_PROVIDER).useValue(provider)
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    const requestId = new RequestIdMiddleware();
    app.use(requestId.use.bind(requestId));
    app.useGlobalFilters(new ApiExceptionFilter());
    app.useGlobalInterceptors(new ApiResponseInterceptor());
    await app.listen(0, "127.0.0.1");
    baseUrl = await app.getUrl();
  });

  afterAll(async () => app.close());

  it("uses the current server plan price and reuses the same pending checkout", async () => {
    const request = () => fetch(`${baseUrl}/api/v1/orders/checkout`, {
      method: "POST",
      headers: cookie,
      body: JSON.stringify({
        items: [{ productType: "account_subscription", planId: "subscription-6m", quantity: 1, amount: 10 }],
      }),
    });
    const first = await request();
    const firstBody = await first.json() as { data: { orderId: string; amount: number } };
    const secondBody = await (await request()).json() as { data: { orderId: string; amount: number } };
    expect(first.status).toBe(201);
    expect(firstBody.data.amount).toBe(50000);
    expect(secondBody.data.orderId).toBe(firstBody.data.orderId);
    expect(store.orders).toHaveLength(1);
  });

  it("rejects a mismatched provider amount without issuing a subscription", async () => {
    const response = await fetch(`${baseUrl}/api/v1/payments/portone/verify`, {
      method: "POST", headers: cookie,
      body: JSON.stringify({ paymentId: "imp_wrong_amount", orderId: store.orders[0]?.id }),
    });
    const body = await response.json() as { error: { code: string } };
    expect(response.status).toBe(409);
    expect(body.error.code).toBe("PAYMENT_AMOUNT_MISMATCH");
    expect(store.subscriptions).toHaveLength(0);
  });

  it("issues one subscription for a paid PortOne payment and returns history", async () => {
    const orderId = store.orders[0]?.id;
    const verify = () => fetch(`${baseUrl}/api/v1/payments/portone/verify`, {
      method: "POST", headers: cookie,
      body: JSON.stringify({ paymentId: "imp_paid_1", orderId }),
    });
    const first = await verify();
    const firstBody = await first.json() as { data: { subscription: { endsAt: string } } };
    const second = await verify();
    const secondBody = await second.json() as { data: { subscription: { endsAt: string } } };
    expect(first.status).toBe(201);
    expect(new Date(firstBody.data.subscription.endsAt).getTime()).toBeGreaterThan(Date.now());
    expect(secondBody.data.subscription.endsAt).toBe(firstBody.data.subscription.endsAt);
    expect(store.subscriptions).toHaveLength(1);

    const subscriptions = await fetch(`${baseUrl}/api/v1/me/subscriptions`, { headers: cookie });
    const subscriptionsBody = await subscriptions.json() as { data: { items: Array<{ active: boolean; amountSnapshot: number }> } };
    expect(subscriptionsBody.data.items).toHaveLength(1);
    expect(subscriptionsBody.data.items[0]).toMatchObject({ active: true, amountSnapshot: 50000 });

    const orders = await fetch(`${baseUrl}/api/v1/me/orders`, { headers: cookie });
    const ordersBody = await orders.json() as { data: { items: Array<{ status: string; paymentId: string }> } };
    expect(ordersBody.data.items[0]).toMatchObject({ status: "paid", paymentId: "imp_paid_1" });

    const duplicateCheckout = await fetch(`${baseUrl}/api/v1/orders/checkout`, {
      method: "POST", headers: cookie,
      body: JSON.stringify({
        items: [{ productType: "account_subscription", planId: "subscription-1m", quantity: 1 }],
      }),
    });
    const duplicateBody = await duplicateCheckout.json() as { error: { code: string } };
    expect(duplicateCheckout.status).toBe(409);
    expect(duplicateBody.error.code).toBe("ACTIVE_SUBSCRIPTION_EXISTS");
  });

  it("allows only operators to inspect mismatches and re-query PortOne", async () => {
    const forbidden = await fetch(`${baseUrl}/api/v1/admin/payments/reconciliation`, { headers: cookie });
    expect(forbidden.status).toBe(403);
    const forbiddenCsv = await fetch(`${baseUrl}/api/v1/admin/payments/reconciliation.csv`, { headers: cookie });
    expect(forbiddenCsv.status).toBe(403);

    const paidOrder = store.orders[0];
    const reconciled = await fetch(`${baseUrl}/api/v1/admin/orders/${paidOrder?.id}/reconcile`, {
      method: "POST",
      headers: operatorCookie,
    });
    const reconciledBody = await reconciled.json() as { data: { orderId: string; action: string } };
    expect(reconciled.status).toBe(201);
    expect(reconciledBody.data).toMatchObject({ orderId: paidOrder?.id, action: "payment_confirmed" });

    store.orders.push({
      id: "sub_expired_pending",
      userId: "student-payment",
      planId: "subscription-1m",
      orderName: "만료된 대기 주문",
      amount: 10000,
      planLabelSnapshot: "1개월",
      monthsSnapshot: 1,
      status: SubscriptionOrderStatus.PENDING,
      provider: "portone-v1",
      providerPaymentId: null,
      paymentMethod: null,
      paidAt: null,
      refundedAmount: 0,
      refundedAt: null,
      expiresAt: new Date(Date.now() - 60_000),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const report = await fetch(`${baseUrl}/api/v1/admin/payments/reconciliation`, {
      headers: operatorCookie,
    });
    const reportBody = await report.json() as {
      data: {
        summary: { total: number; attention: number };
        items: Array<{
          order: { id: string; user: { email: string } };
          reconciliation: { status: string; issues: string[]; canSync: boolean };
        }>;
      };
    };
    expect(report.status).toBe(200);
    expect(report.headers.get("cache-control")).toBe("private, no-store");
    expect(reportBody.data.summary).toMatchObject({ total: 2, attention: 1 });
    expect(reportBody.data.items[0]).toMatchObject({
      order: { id: "sub_expired_pending", user: { email: "pay@example.com" } },
      reconciliation: {
        status: "attention",
        issues: ["expired_pending_order"],
        canSync: false,
      },
    });

    const kstToday = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const filters = new URLSearchParams({
      from: kstToday,
      to: kstToday,
      status: "pending",
      reconciliation: "attention",
      search: "expired",
      page: "1",
      pageSize: "10",
    });
    const filtered = await fetch(`${baseUrl}/api/v1/admin/payments/reconciliation?${filters}`, {
      headers: operatorCookie,
    });
    const filteredBody = await filtered.json() as {
      data: {
        filters: { status: string; reconciliation: string; search: string };
        pagination: { total: number; pageSize: number };
        items: Array<{ order: { id: string } }>;
      };
    };
    expect(filtered.status).toBe(200);
    expect(filteredBody.data.filters).toMatchObject({
      status: "pending",
      reconciliation: "attention",
      search: "expired",
    });
    expect(filteredBody.data.pagination).toMatchObject({ total: 1, pageSize: 10 });
    expect(filteredBody.data.items[0]?.order.id).toBe("sub_expired_pending");

    const csvOrder = store.orders.at(-1);
    if (csvOrder) csvOrder.orderName = '=HYPERLINK("https://invalid.example")';
    const csv = await fetch(`${baseUrl}/api/v1/admin/payments/reconciliation.csv?${filters}`, {
      headers: operatorCookie,
    });
    const csvBytes = new Uint8Array(await csv.arrayBuffer());
    const csvText = new TextDecoder().decode(csvBytes);
    expect(csv.status).toBe(200);
    expect(csv.headers.get("content-type")).toContain("text/csv");
    expect(csv.headers.get("content-disposition")).toContain("payment-reconciliation-");
    expect([...csvBytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(csvText).toContain('"sub_expired_pending"');
    expect(csvText).toContain('"\'=HYPERLINK(""https://invalid.example"")"');
    expect(store.prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "subscription.payments.reconciliation_exported",
        metadata: expect.objectContaining({ exportedCount: 1 }),
      }),
    });

    const invalidRange = await fetch(
      `${baseUrl}/api/v1/admin/payments/reconciliation?from=2026-02-30`,
      { headers: operatorCookie },
    );
    const invalidRangeBody = await invalidRange.json() as { error: { code: string } };
    expect(invalidRange.status).toBe(400);
    expect(invalidRangeBody.error.code).toBe("INVALID_RECONCILIATION_DATE");

    const excessiveRange = await fetch(
      `${baseUrl}/api/v1/admin/payments/reconciliation?from=2025-01-01&to=2026-08-23`,
      { headers: operatorCookie },
    );
    const excessiveRangeBody = await excessiveRange.json() as { error: { code: string } };
    expect(excessiveRange.status).toBe(400);
    expect(excessiveRangeBody.error.code).toBe("RECONCILIATION_RANGE_TOO_LARGE");

    providerState.status = "failed";
    const manualSync = await fetch(`${baseUrl}/api/v1/admin/orders/sub_expired_pending/reconcile`, {
      method: "POST",
      headers: operatorCookie,
      body: JSON.stringify({ paymentId: "imp_manual_failed" }),
    });
    const manualSyncBody = await manualSync.json() as { data: { action: string; paymentId: string } };
    expect(manualSync.status).toBe(201);
    expect(manualSyncBody.data).toMatchObject({ action: "payment_failed", paymentId: "imp_manual_failed" });
    expect(store.orders.at(-1)?.status).toBe(SubscriptionOrderStatus.FAILED);
    store.orders.pop();
  });

  it("re-verifies partial-refund webhooks and handles duplicate delivery idempotently", async () => {
    providerState.status = "paid";
    providerState.cancelAmount = 10000;
    providerState.cancelledAt = new Date();
    const webhook = () => fetch(`${baseUrl}/api/v1/payments/portone/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        imp_uid: "imp_paid_1",
        merchant_uid: store.orders[0]?.id,
        status: "cancelled",
        cancellation_id: "cancel_partial_1",
      }),
    });
    const first = await webhook();
    const firstBody = await first.json() as { data: { action: string } };
    const second = await webhook();
    expect(first.status).toBe(200);
    expect(firstBody.data.action).toBe("partial_refund_synced");
    expect(second.status).toBe(200);
    expect(store.refunds).toHaveLength(1);
    expect(store.subscriptions[0]).toMatchObject({
      paymentStatus: SubscriptionPaymentStatus.PAID,
      refundedAmount: 10000,
    });
  });

  it("allows only an operator to fully refund and immediately revokes subscription access", async () => {
    const subscriptionId = store.subscriptions[0]?.id;
    const requestRefund = (headers: Record<string, string>) => fetch(
      `${baseUrl}/api/v1/admin/subscriptions/${subscriptionId}/refund`,
      {
        method: "POST", headers,
        body: JSON.stringify({ reason: "고객 요청에 따른 전액 환불" }),
      },
    );
    const forbidden = await requestRefund(cookie);
    expect(forbidden.status).toBe(403);

    const refunded = await requestRefund(operatorCookie);
    const refundedBody = await refunded.json() as {
      data: { paymentStatus: string; refundedAmount: number; accessRevoked: boolean };
    };
    expect(refunded.status).toBe(201);
    expect(refundedBody.data).toMatchObject({
      paymentStatus: "refunded",
      refundedAmount: 50000,
      accessRevoked: true,
    });
    expect(provider.cancelPayment).toHaveBeenCalledWith(expect.objectContaining({
      amount: 40000,
      checksum: 40000,
    }));
    expect(store.refunds).toHaveLength(2);

    const repeated = await requestRefund(operatorCookie);
    expect(repeated.status).toBe(201);
    expect(provider.cancelPayment).toHaveBeenCalledTimes(1);

    const subscriptions = await fetch(`${baseUrl}/api/v1/me/subscriptions`, { headers: cookie });
    const body = await subscriptions.json() as {
      data: { items: Array<{ active: boolean; paymentStatus: string; refundedAmount: number }> };
    };
    expect(body.data.items[0]).toMatchObject({
      active: false,
      paymentStatus: "refunded",
      refundedAmount: 50000,
    });
  });

  it("finalizes a paid order from a webhook without a browser callback", async () => {
    providerState.cancelAmount = 0;
    providerState.cancelledAt = null;
    const createCheckout = () => fetch(`${baseUrl}/api/v1/orders/checkout`, {
      method: "POST", headers: cookie,
      body: JSON.stringify({
        items: [{ productType: "account_subscription", planId: "subscription-1m", quantity: 1 }],
      }),
    });
    const sendWebhook = (paymentId: string, orderId: string, status: string) =>
      fetch(`${baseUrl}/api/v1/payments/portone/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        imp_uid: paymentId,
        merchant_uid: orderId,
        status,
      }),
    });

    providerState.status = "failed";
    const failedCheckout = await createCheckout();
    const failedOrder = await failedCheckout.json() as { data: { orderId: string } };
    const failed = await sendWebhook("imp_webhook_failed", failedOrder.data.orderId, "failed");
    const failedBody = await failed.json() as { data: { action: string } };
    expect(failedBody.data.action).toBe("payment_failed");
    expect(store.orders.at(-1)?.status).toBe(SubscriptionOrderStatus.FAILED);

    providerState.status = "paid";
    const checkout = await createCheckout();
    const checkoutBody = await checkout.json() as { data: { orderId: string } };
    const first = await sendWebhook("imp_webhook_paid", checkoutBody.data.orderId, "paid");
    const firstBody = await first.json() as { data: { action: string } };
    const second = await sendWebhook("imp_webhook_paid", checkoutBody.data.orderId, "paid");
    expect(first.status).toBe(200);
    expect(firstBody.data.action).toBe("payment_confirmed");
    expect(second.status).toBe(200);
    expect(store.subscriptions).toHaveLength(2);
    expect(store.subscriptions[1]).toMatchObject({
      orderId: checkoutBody.data.orderId,
      paymentId: "imp_webhook_paid",
      paymentStatus: SubscriptionPaymentStatus.PAID,
    });
  });
});

describe("subscription end calculation", () => {
  it("closes a one-month August 19 purchase at September 20 KST midnight", () => {
    const paidAt = new Date("2026-08-19T06:00:00.000Z");
    expect(calculateSubscriptionEnd(paidAt, 1).toISOString()).toBe("2026-09-19T15:00:00.000Z");
  });

  it("uses the target month end and closes at the following KST midnight", () => {
    const paidAt = new Date("2026-01-31T06:00:00.000Z");
    expect(calculateSubscriptionEnd(paidAt, 1).toISOString()).toBe("2026-02-28T15:00:00.000Z");
  });
});
