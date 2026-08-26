import { HttpStatus, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AuthService } from "../auth/auth.service.js";
import { SessionAuthGuard } from "../auth/session-auth.guard.js";
import { RolesGuard } from "../auth/roles.guard.js";
import { ApiError } from "../common/api-error.js";
import { ApiExceptionFilter } from "../common/api-exception.filter.js";
import { ApiResponseInterceptor } from "../common/api-response.interceptor.js";
import { RequestIdMiddleware } from "../common/request-id.middleware.js";
import { PAYMENT_PROVIDER } from "../components/payments/index.js";
import { PrismaService } from "../database/prisma.service.js";
import { StoreOrderStatus } from "../generated/prisma/enums.js";
import { StoreController } from "./store.controller.js";
import { StoreService } from "./store.service.js";

type Value = Record<string, any>;

function createStore() {
  const products = [
    { id: "workbook-prehistory", name: "선사·고조선 편 워크북", price: 18_000, active: true, requiresShipping: true, stockQuantity: 100, sortOrder: 10 },
    { id: "teacher-package", name: "교사용 수업 패키지", price: 25_000, active: true, requiresShipping: false, stockQuantity: null, sortOrder: 20 },
  ];
  const orders: Value[] = [];
  const cartItems: Value[] = [];
  const prisma = {
    storeProduct: {
      findMany: vi.fn(async ({ where }: Value) => {
        const ids = where?.id?.in as string[] | undefined;
        return products.filter((product) => product.active && (!ids || ids.includes(product.id)));
      }),
      findFirst: vi.fn(async ({ where }: Value) => products.find((product) => (
        product.id === where.id && (!where.active || product.active)
      )) ?? null),
      updateMany: vi.fn(async ({ where, data }: Value) => {
        const product = products.find((item) => item.id === where.id && (!where.active || item.active));
        if (!product || (where.stockQuantity?.gte !== undefined
          && (product.stockQuantity === null || product.stockQuantity < where.stockQuantity.gte))
          || (where.stockQuantity?.not === null && product.stockQuantity === null)) return { count: 0 };
        if (data.stockQuantity?.decrement) product.stockQuantity! -= data.stockQuantity.decrement;
        if (data.stockQuantity?.increment) product.stockQuantity! += data.stockQuantity.increment;
        return { count: 1 };
      }),
    },
    storeCartItem: {
      findMany: vi.fn(async ({ where, include }: Value) => cartItems
        .filter((item) => item.userId === where.userId)
        .map((item) => include?.product
          ? { ...item, product: products.find((product) => product.id === item.productId) }
          : item)),
      findUnique: vi.fn(async ({ where }: Value) => {
        const key = where.userId_productId;
        return cartItems.find((item) => item.userId === key.userId && item.productId === key.productId) ?? null;
      }),
      count: vi.fn(async ({ where }: Value) => cartItems.filter((item) => item.userId === where.userId).length),
      upsert: vi.fn(async ({ where, create, update }: Value) => {
        const key = where.userId_productId;
        const item = cartItems.find((value) => value.userId === key.userId && value.productId === key.productId);
        if (item) Object.assign(item, update, { updatedAt: new Date() });
        else cartItems.push({ ...create, createdAt: new Date(), updatedAt: new Date() });
        return item ?? cartItems.at(-1);
      }),
      deleteMany: vi.fn(async ({ where }: Value) => {
        const ids = Array.isArray(where.productId?.in) ? where.productId.in : [where.productId];
        const before = cartItems.length;
        for (let index = cartItems.length - 1; index >= 0; index -= 1) {
          if (cartItems[index]!.userId === where.userId && ids.includes(cartItems[index]!.productId)) cartItems.splice(index, 1);
        }
        return { count: before - cartItems.length };
      }),
    },
    storeOrder: {
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
      findMany: vi.fn(async ({ where, include }: Value) => orders
        .filter((order) => (!where?.userId || order.userId === where.userId)
          && (!where?.status || order.status === where.status)
          && (!where?.expiresAt?.lte || order.expiresAt <= where.expiresAt.lte)
          && (where?.inventoryReleasedAt !== null || order.inventoryReleasedAt === null)
          && (!where?.inventoryReservedAt?.not || order.inventoryReservedAt !== null))
        .map((order) => include?.user ? { ...order, user: {
          id: order.userId, email: "store@example.com", displayName: "교재 구매자",
        } } : order)),
      create: vi.fn(async ({ data }: Value) => {
        const order = {
          ...data,
          status: StoreOrderStatus.PENDING,
          provider: "toss-payments",
          providerPaymentId: null,
          paymentMethod: null,
          paidAt: null,
          refundedAmount: 0,
          refundedAt: null,
          recipientName: data.recipientName ?? null,
          recipientPhone: data.recipientPhone ?? null,
          postalCode: data.postalCode ?? null,
          addressLine1: data.addressLine1 ?? null,
          addressLine2: data.addressLine2 ?? null,
          inventoryReservedAt: data.inventoryReservedAt ?? null,
          inventoryReleasedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          items: data.items.create.map((item: Value, index: number) => ({ id: `item-${index + 1}`, ...item })),
        };
        orders.push(order);
        return order;
      }),
      updateMany: vi.fn(async ({ where, data }: Value) => {
        const order = orders.find((item) => item.id === where.id && item.status === where.status);
        if (!order) return { count: 0 };
        Object.assign(order, data, { updatedAt: new Date() });
        return { count: 1 };
      }),
      update: vi.fn(async ({ where, data }: Value) => {
        const order = orders.find((item) => item.id === where.id);
        Object.assign(order ?? {}, data, { updatedAt: new Date() });
        return order;
      }),
    },
    auditLog: { create: vi.fn(async () => ({ id: "audit-store" })) },
    $transaction: vi.fn(async (callback: (transaction: unknown) => unknown) => callback(prisma)),
  };
  return { prisma: prisma as unknown as PrismaService, orders, cartItems };
}

describe("store order and Toss confirmation HTTP API", () => {
  let app: INestApplication;
  let baseUrl: string;
  const store = createStore();
  const providerPayments = new Map<string, Value>();
  const provider = {
    providerId: "toss-payments",
    confirmPayment: vi.fn(async (input: { paymentId: string; orderId: string; amount: number }) => {
      const payment = {
        provider: "toss-payments", paymentId: input.paymentId, orderId: input.orderId,
        amount: input.amount, status: "paid" as const, method: "카드",
        paidAt: new Date("2026-08-24T05:00:00.000Z"), cancelledAt: null, cancelAmount: 0,
      };
      providerPayments.set(input.paymentId, payment);
      return payment;
    }),
    getPayment: vi.fn(async (paymentId: string) => providerPayments.get(paymentId)),
    cancelPayment: vi.fn(async (input: { paymentId: string; amount: number }) => {
      const payment = providerPayments.get(input.paymentId)!;
      const canceled = {
        ...payment,
        status: "cancelled" as const,
        cancelAmount: payment.amount,
        cancelledAt: new Date("2026-08-24T06:00:00.000Z"),
      };
      providerPayments.set(input.paymentId, canceled);
      return canceled;
    }),
  };
  const user = {
    id: "00000000-0000-4000-8000-000000000501",
    email: "store@example.com",
    emailVerified: true,
    displayName: "교재 구매자",
    roles: ["operator"],
  };
  const authService = {
    getConfig: () => ({ sessionCookieName: "baduk_session" }),
    authenticate: vi.fn(async (token: string | null) => {
      if (token !== "store-token") throw new ApiError("AUTH_REQUIRED", "로그인이 필요합니다.", HttpStatus.UNAUTHORIZED);
      return user;
    }),
  };
  const headers = { cookie: "baduk_session=store-token", "content-type": "application/json" };
  const shipping = {
    recipientName: "홍길동",
    recipientPhone: "010-1234-5678",
    postalCode: "04524",
    addressLine1: "서울특별시 중구 세종대로 110",
    addressLine2: "3층",
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [StoreController],
      providers: [
        StoreService,
        SessionAuthGuard,
        RolesGuard,
        { provide: PrismaService, useValue: store.prisma },
        { provide: PAYMENT_PROVIDER, useValue: provider },
        { provide: AuthService, useValue: authService },
      ],
    }).compile();
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

  it("lists active store products without authentication", async () => {
    const response = await fetch(`${baseUrl}/api/v1/store/products`);
    expect(response.status).toBe(200);
    const body = await response.json() as Value;
    expect(body.data.items).toEqual([
      { id: "workbook-prehistory", name: "선사·고조선 편 워크북", price: 18_000, requiresShipping: true, availableQuantity: 100, stockStatus: "available" },
      { id: "teacher-package", name: "교사용 수업 패키지", price: 25_000, requiresShipping: false, availableQuantity: null, stockStatus: "unlimited" },
    ]);
  });

  it("stores exact cart quantities and removes cart items", async () => {
    const save = await fetch(`${baseUrl}/api/v1/cart/items`, {
      method: "POST",
      headers,
      body: JSON.stringify({ productId: "workbook-prehistory", quantity: 2 }),
    });
    expect(save.status).toBe(201);
    expect(await save.json()).toMatchObject({ data: {
      amount: 36_000,
      items: [{ productId: "workbook-prehistory", quantity: 2, amount: 36_000 }],
    } });
    const remove = await fetch(`${baseUrl}/api/v1/cart/items/workbook-prehistory`, {
      method: "DELETE",
      headers,
    });
    expect(remove.status).toBe(200);
    expect(await remove.json()).toMatchObject({ data: { amount: 0, items: [] } });
  });

  it("requires shipping information for physical products", async () => {
    const response = await fetch(`${baseUrl}/api/v1/store/orders/checkout`, {
      method: "POST",
      headers,
      body: JSON.stringify({ items: [{ productId: "workbook-prehistory", quantity: 1 }] }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "STORE_SHIPPING_REQUIRED" } });
  });

  it("uses the server product price and reuses an equivalent pending order", async () => {
    const checkout = () => fetch(`${baseUrl}/api/v1/store/orders/checkout`, {
      method: "POST",
      headers,
      body: JSON.stringify({ items: [{ productId: "workbook-prehistory", quantity: 2, price: 1 }], shipping }),
    });
    const first = await checkout();
    const second = await checkout();
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const firstBody = await first.json() as Value;
    const secondBody = await second.json() as Value;
    expect(firstBody.data).toMatchObject({
      amount: 36_000,
      customerKey: user.id,
      customerEmail: user.email,
      shipping,
    });
    expect(secondBody.data.orderId).toBe(firstBody.data.orderId);
    expect(store.orders).toHaveLength(1);
    expect((store.prisma as any).storeProduct.updateMany).toHaveBeenCalledTimes(1);
  });

  it("rejects a changed browser amount before calling Toss Payments", async () => {
    const order = store.orders[0]!;
    const response = await fetch(`${baseUrl}/api/v1/payments/toss/confirm`, {
      method: "POST",
      headers,
      body: JSON.stringify({ paymentKey: "payment-key-wrong", orderId: order.id, amount: 1 }),
    });
    expect(response.status).toBe(409);
    expect(provider.confirmPayment).not.toHaveBeenCalled();
  });

  it("confirms once with the stable request id and returns the paid order on retry", async () => {
    const order = store.orders[0]!;
    const request = () => fetch(`${baseUrl}/api/v1/payments/toss/confirm`, {
      method: "POST",
      headers: { ...headers, "x-request-id": "store_confirm_test_1234" },
      body: JSON.stringify({ paymentKey: "payment-key-paid", orderId: order.id, amount: 36_000 }),
    });
    const first = await request();
    const second = await request();
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(await first.json()).toMatchObject({ data: {
      status: "paid",
      paymentId: "payment-key-paid",
      amount: 36_000,
    } });
    expect(provider.confirmPayment).toHaveBeenCalledOnce();
    expect(provider.confirmPayment).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: "store_confirm_test_1234",
    }));
  });

  it("recovers a paid order from a duplicated Toss webhook by re-querying the provider", async () => {
    const checkout = await fetch(`${baseUrl}/api/v1/store/orders/checkout`, {
      method: "POST",
      headers,
      body: JSON.stringify({ items: [{ productId: "teacher-package", quantity: 1 }] }),
    });
    const checkoutBody = await checkout.json() as Value;
    const orderId = checkoutBody.data.orderId as string;
    providerPayments.set("payment-key-webhook", {
      provider: "toss-payments", paymentId: "payment-key-webhook", orderId,
      amount: 25_000, status: "paid", method: "카드",
      paidAt: new Date("2026-08-24T05:30:00.000Z"), cancelledAt: null, cancelAmount: 0,
    });
    const webhook = () => fetch(`${baseUrl}/api/v1/payments/toss/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        eventType: "PAYMENT_STATUS_CHANGED",
        data: { paymentKey: "payment-key-webhook", orderId, status: "DONE" },
      }),
    });

    expect(await (await webhook()).json()).toMatchObject({ data: { action: "payment_confirmed" } });
    expect(await (await webhook()).json()).toMatchObject({ data: { action: "no_change" } });
    expect(store.orders.find((order) => order.id === orderId)).toMatchObject({
      status: StoreOrderStatus.PAID,
      providerPaymentId: "payment-key-webhook",
    });
  });

  it("allows an operator to refund a paid store order once", async () => {
    const order = store.orders[0]!;
    const refund = () => fetch(`${baseUrl}/api/v1/admin/store-orders/${order.id}/refund`, {
      method: "POST",
      headers: { ...headers, "x-request-id": "store_refund_test_1234" },
      body: JSON.stringify({ reason: "구매자 환불 요청" }),
    });
    expect(await (await refund()).json()).toMatchObject({ data: {
      status: "canceled",
      refundedAmount: 36_000,
    } });
    expect(await (await refund()).json()).toMatchObject({ data: { status: "canceled" } });
    expect(provider.cancelPayment).toHaveBeenCalledOnce();
    expect(provider.cancelPayment).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: `store-refund:${order.id}`,
    }));
  });

  it("returns reserved inventory when a pending order expires", async () => {
    const checkout = await fetch(`${baseUrl}/api/v1/store/orders/checkout`, {
      method: "POST",
      headers,
      body: JSON.stringify({ items: [{ productId: "workbook-prehistory", quantity: 1 }], shipping }),
    });
    const checkoutBody = await checkout.json() as Value;
    const order = store.orders.find((item) => item.id === checkoutBody.data.orderId)!;
    order.expiresAt = new Date(Date.now() - 1_000);
    const response = await fetch(`${baseUrl}/api/v1/payments/toss/confirm`, {
      method: "POST",
      headers,
      body: JSON.stringify({ paymentKey: "payment-key-expired", orderId: order.id, amount: order.amount }),
    });
    expect(response.status).toBe(409);
    expect(order).toMatchObject({ status: StoreOrderStatus.FAILED });
    expect(order.inventoryReleasedAt).toBeInstanceOf(Date);
  });
});
