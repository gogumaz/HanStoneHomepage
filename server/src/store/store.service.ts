import { randomUUID } from "node:crypto";
import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import type { CurrentUser } from "../auth/auth.types.js";
import { ApiError } from "../common/api-error.js";
import {
  PAYMENT_PROVIDER,
  PaymentComponentError,
  type PaymentProvider,
  type PaymentRecord,
} from "../components/payments/index.js";
import { PrismaService } from "../database/prisma.service.js";
import { StoreOrderStatus } from "../generated/prisma/enums.js";

const ORDER_TTL_MS = 30 * 60 * 1000;
const INVENTORY_EXPIRY_GRACE_MS = 5 * 60 * 1000;
const MAX_ITEMS = 10;
const MAX_QUANTITY = 10;
const MAX_ORDER_AMOUNT = 10_000_000;

type CheckoutItem = { productId: string; quantity: number };
type ShippingInput = {
  recipientName: string;
  recipientPhone: string;
  postalCode: string;
  addressLine1: string;
  addressLine2: string | null;
};
type CheckoutInput = { items: CheckoutItem[] | null; fromCart: boolean; shipping: ShippingInput | null };
type ConfirmInput = { paymentId: string; orderId: string; amount: number };
type WebhookInput = { paymentId: string; orderId: string };

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function validateItems(items: unknown): CheckoutItem[] {
  if (!Array.isArray(items) || items.length < 1 || items.length > MAX_ITEMS) {
    throw new ApiError("INVALID_STORE_CHECKOUT", `상품은 1개 이상 ${MAX_ITEMS}개 이하로 주문할 수 있습니다.`, HttpStatus.BAD_REQUEST);
  }
  const result = items.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new ApiError("INVALID_STORE_CHECKOUT", "교재 주문 정보를 확인해 주세요.", HttpStatus.BAD_REQUEST);
    }
    const item = value as Record<string, unknown>;
    const productId = readString(item.productId);
    const quantity = item.quantity;
    if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(productId) || !Number.isInteger(quantity)
      || Number(quantity) < 1 || Number(quantity) > MAX_QUANTITY) {
      throw new ApiError("INVALID_STORE_CHECKOUT", "상품과 수량을 확인해 주세요.", HttpStatus.BAD_REQUEST);
    }
    return { productId, quantity: Number(quantity) };
  });
  if (new Set(result.map((item) => item.productId)).size !== result.length) {
    throw new ApiError("DUPLICATE_STORE_PRODUCT", "같은 상품은 한 번만 입력해 주세요.", HttpStatus.BAD_REQUEST);
  }
  return result.sort((left, right) => left.productId.localeCompare(right.productId));
}

function validateShipping(value: unknown): ShippingInput | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError("INVALID_STORE_SHIPPING", "배송 정보를 확인해 주세요.", HttpStatus.BAD_REQUEST);
  }
  const data = value as Record<string, unknown>;
  const recipientName = readString(data.recipientName);
  const recipientPhone = readString(data.recipientPhone).replaceAll(" ", "");
  const postalCode = readString(data.postalCode);
  const addressLine1 = readString(data.addressLine1);
  const addressLine2 = readString(data.addressLine2) || null;
  if (recipientName.length < 2 || recipientName.length > 50
    || !/^\d[\d-]{7,19}$/.test(recipientPhone)
    || !/^\d{5}$/.test(postalCode)
    || addressLine1.length < 5 || addressLine1.length > 200
    || (addressLine2?.length ?? 0) > 200) {
    throw new ApiError("INVALID_STORE_SHIPPING", "받는 분, 연락처, 우편번호와 주소를 정확히 입력해 주세요.", HttpStatus.BAD_REQUEST);
  }
  return { recipientName, recipientPhone, postalCode, addressLine1, addressLine2 };
}

function validateCheckout(body: unknown): CheckoutInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ApiError("INVALID_STORE_CHECKOUT", "교재 주문 정보를 확인해 주세요.", HttpStatus.BAD_REQUEST);
  }
  const data = body as Record<string, unknown>;
  const fromCart = data.fromCart === true;
  if (fromCart && data.items !== undefined) {
    throw new ApiError("INVALID_STORE_CHECKOUT", "장바구니 주문에는 상품 목록을 함께 보낼 수 없습니다.", HttpStatus.BAD_REQUEST);
  }
  return {
    items: fromCart ? null : validateItems(data.items),
    fromCart,
    shipping: validateShipping(data.shipping),
  };
}

function validateCartItem(body: unknown): CheckoutItem {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ApiError("INVALID_STORE_CART_ITEM", "장바구니 상품 정보를 확인해 주세요.", HttpStatus.BAD_REQUEST);
  }
  return validateItems([body])[0]!;
}

function validateConfirmation(body: unknown): ConfirmInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ApiError("INVALID_TOSS_PAYMENT", "결제 승인 정보를 확인해 주세요.", HttpStatus.BAD_REQUEST);
  }
  const data = body as Record<string, unknown>;
  const paymentId = readString(data.paymentKey ?? data.paymentId);
  const orderId = readString(data.orderId);
  const amount = data.amount;
  if (!paymentId || paymentId.length > 200 || !/^store_[a-f0-9]{32}$/.test(orderId)
    || !Number.isInteger(amount) || Number(amount) < 1 || Number(amount) > MAX_ORDER_AMOUNT) {
    throw new ApiError("INVALID_TOSS_PAYMENT", "결제 승인 정보가 올바르지 않습니다.", HttpStatus.BAD_REQUEST);
  }
  return { paymentId, orderId, amount: Number(amount) };
}

function validateWebhook(body: unknown): WebhookInput | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ApiError("INVALID_TOSS_WEBHOOK", "토스페이먼츠 웹훅 정보를 확인해 주세요.", HttpStatus.BAD_REQUEST);
  }
  const envelope = body as Record<string, unknown>;
  if (envelope.eventType !== "PAYMENT_STATUS_CHANGED") return null;
  const data = envelope.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new ApiError("INVALID_TOSS_WEBHOOK", "토스페이먼츠 웹훅 정보를 확인해 주세요.", HttpStatus.BAD_REQUEST);
  }
  const record = data as Record<string, unknown>;
  const paymentId = readString(record.paymentKey);
  const orderId = readString(record.orderId);
  if (!paymentId || paymentId.length > 200 || !/^store_[a-f0-9]{32}$/.test(orderId)) {
    throw new ApiError("INVALID_TOSS_WEBHOOK", "토스페이먼츠 웹훅 정보가 올바르지 않습니다.", HttpStatus.BAD_REQUEST);
  }
  return { paymentId, orderId };
}

function validateRefund(body: unknown): string {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ApiError("INVALID_STORE_REFUND", "환불 사유를 입력해 주세요.", HttpStatus.BAD_REQUEST);
  }
  const reason = readString((body as Record<string, unknown>).reason);
  if (reason.length < 5 || reason.length > 200) {
    throw new ApiError("INVALID_STORE_REFUND_REASON", "환불 사유는 5자 이상 200자 이하로 입력해 주세요.", HttpStatus.BAD_REQUEST);
  }
  return reason;
}

@Injectable()
export class StoreService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(PAYMENT_PROVIDER) private readonly paymentProvider: PaymentProvider,
  ) {}

  async listProducts() {
    await this.releaseExpiredReservations();
    const items = await this.prisma.storeProduct.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    });
    return { items: items.map((product) => this.productView(product)) };
  }

  async listCart(user: CurrentUser) {
    const items = await this.prisma.storeCartItem.findMany({
      where: { userId: user.id },
      include: { product: true },
      orderBy: { createdAt: "asc" },
    });
    const activeItems = items.filter((item) => item.product.active);
    return {
      items: activeItems.map((item) => ({
        productId: item.product.id,
        name: item.product.name,
        unitPrice: item.product.price,
        requiresShipping: item.product.requiresShipping,
        availableQuantity: item.product.stockQuantity,
        stockStatus: item.product.stockQuantity === null
          ? "unlimited"
          : item.product.stockQuantity === 0 ? "out_of_stock" : item.product.stockQuantity <= 5 ? "low_stock" : "available",
        quantity: item.quantity,
        amount: item.product.price * item.quantity,
      })),
      amount: activeItems.reduce((total, item) => total + item.product.price * item.quantity, 0),
    };
  }

  async setCartItem(user: CurrentUser, body: unknown) {
    const input = validateCartItem(body);
    const [product, existingItem, itemCount] = await Promise.all([
      this.prisma.storeProduct.findFirst({ where: { id: input.productId, active: true } }),
      this.prisma.storeCartItem.findUnique({
        where: { userId_productId: { userId: user.id, productId: input.productId } },
      }),
      this.prisma.storeCartItem.count({ where: { userId: user.id } }),
    ]);
    if (!product) {
      throw new ApiError("STORE_PRODUCT_NOT_FOUND", "판매 중인 교재 상품을 찾을 수 없습니다.", HttpStatus.NOT_FOUND);
    }
    if (!existingItem && itemCount >= MAX_ITEMS) {
      throw new ApiError("STORE_CART_LIMIT_EXCEEDED", `장바구니에는 상품을 ${MAX_ITEMS}개까지 담을 수 있습니다.`, HttpStatus.BAD_REQUEST);
    }
    await this.prisma.storeCartItem.upsert({
      where: { userId_productId: { userId: user.id, productId: product.id } },
      create: { userId: user.id, productId: product.id, quantity: input.quantity },
      update: { quantity: input.quantity },
    });
    return this.listCart(user);
  }

  async removeCartItem(user: CurrentUser, productId: string) {
    if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(productId)) {
      throw new ApiError("INVALID_STORE_PRODUCT", "상품 정보를 확인해 주세요.", HttpStatus.BAD_REQUEST);
    }
    await this.prisma.storeCartItem.deleteMany({ where: { userId: user.id, productId } });
    return this.listCart(user);
  }

  async createCheckout(user: CurrentUser, body: unknown, requestId?: string) {
    await this.releaseExpiredReservations(requestId);
    const request = validateCheckout(body);
    let input = request.items;
    if (request.fromCart) {
      const cartItems = await this.prisma.storeCartItem.findMany({ where: { userId: user.id } });
      input = validateItems(cartItems.map((item) => ({ productId: item.productId, quantity: item.quantity })));
    }
    if (!input) {
      throw new ApiError("INVALID_STORE_CHECKOUT", "주문 상품을 확인해 주세요.", HttpStatus.BAD_REQUEST);
    }
    const now = new Date();
    const [products, pendingOrder] = await Promise.all([
      this.prisma.storeProduct.findMany({
        where: { id: { in: input.map((item) => item.productId) }, active: true },
      }),
      this.prisma.storeOrder.findFirst({
        where: { userId: user.id, status: StoreOrderStatus.PENDING, expiresAt: { gt: now } },
        include: { items: true },
        orderBy: { createdAt: "desc" },
      }),
    ]);
    if (products.length !== input.length) {
      throw new ApiError("STORE_PRODUCT_NOT_FOUND", "판매 중인 교재 상품을 찾을 수 없습니다.", HttpStatus.NOT_FOUND);
    }
    const requiresShipping = products.some((product) => product.requiresShipping);
    if (requiresShipping && !request.shipping) {
      throw new ApiError("STORE_SHIPPING_REQUIRED", "실물 상품 주문에는 배송 정보가 필요합니다.", HttpStatus.BAD_REQUEST);
    }

    if (pendingOrder) {
      const pendingItems = pendingOrder.items
        .map((item) => ({ productId: item.productId, quantity: item.quantity }))
        .sort((left, right) => left.productId.localeCompare(right.productId));
      const sameShipping = pendingOrder.recipientName === (request.shipping?.recipientName ?? null)
        && pendingOrder.recipientPhone === (request.shipping?.recipientPhone ?? null)
        && pendingOrder.postalCode === (request.shipping?.postalCode ?? null)
        && pendingOrder.addressLine1 === (request.shipping?.addressLine1 ?? null)
        && pendingOrder.addressLine2 === (request.shipping?.addressLine2 ?? null);
      if (JSON.stringify(pendingItems) === JSON.stringify(input) && sameShipping) {
        return this.checkoutView(pendingOrder, user);
      }
      throw new ApiError("PENDING_STORE_ORDER_EXISTS", "진행 중인 교재 주문을 먼저 완료해 주세요.", HttpStatus.CONFLICT);
    }

    const productById = new Map(products.map((product) => [product.id, product]));
    const snapshots = input.map((item) => {
      const product = productById.get(item.productId)!;
      return {
        productId: product.id,
        quantity: item.quantity,
        unitPriceSnapshot: product.price,
        nameSnapshot: product.name,
        lineAmount: product.price * item.quantity,
      };
    });
    const amount = snapshots.reduce((total, item) => total + item.lineAmount, 0);
    if (!Number.isSafeInteger(amount) || amount < 1 || amount > MAX_ORDER_AMOUNT) {
      throw new ApiError("STORE_ORDER_AMOUNT_INVALID", "주문 가능 금액을 초과했습니다.", HttpStatus.BAD_REQUEST);
    }
    const orderName = snapshots.length === 1
      ? snapshots[0]!.nameSnapshot
      : `${snapshots[0]!.nameSnapshot} 외 ${snapshots.length - 1}건`;

    const order = await this.prisma.$transaction(async (transaction) => {
      const finiteInventory = snapshots.filter((item) => productById.get(item.productId)!.stockQuantity !== null);
      for (const item of finiteInventory) {
        const reserved = await transaction.storeProduct.updateMany({
          where: { id: item.productId, active: true, stockQuantity: { gte: item.quantity } },
          data: { stockQuantity: { decrement: item.quantity } },
        });
        if (reserved.count !== 1) {
          throw new ApiError("STORE_PRODUCT_OUT_OF_STOCK", `${item.nameSnapshot}의 재고가 부족합니다.`, HttpStatus.CONFLICT);
        }
      }
      const created = await transaction.storeOrder.create({
        data: {
          id: `store_${randomUUID().replaceAll("-", "")}`,
          userId: user.id,
          orderName,
          amount,
          recipientName: request.shipping?.recipientName ?? null,
          recipientPhone: request.shipping?.recipientPhone ?? null,
          postalCode: request.shipping?.postalCode ?? null,
          addressLine1: request.shipping?.addressLine1 ?? null,
          addressLine2: request.shipping?.addressLine2 ?? null,
          inventoryReservedAt: finiteInventory.length ? now : null,
          expiresAt: new Date(now.getTime() + ORDER_TTL_MS),
          items: { create: snapshots },
        },
        include: { items: true },
      });
      await transaction.auditLog.create({
        data: {
          actorId: user.id,
          action: "store.order.created",
          resourceType: "StoreOrder",
          resourceId: created.id,
          requestId: requestId ?? null,
          metadata: { amount, items: input, requiresShipping },
        },
      });
      return created;
    });
    return this.checkoutView(order, user);
  }

  async confirmPayment(user: CurrentUser, body: unknown, requestId?: string) {
    const input = validateConfirmation(body);
    const order = await this.prisma.storeOrder.findFirst({
      where: { id: input.orderId, userId: user.id },
      include: { items: true },
    });
    if (!order) {
      throw new ApiError("STORE_ORDER_NOT_FOUND", "교재 주문을 찾을 수 없습니다.", HttpStatus.NOT_FOUND);
    }
    if (order.status === StoreOrderStatus.PAID) {
      if (order.providerPaymentId !== input.paymentId) {
        throw new ApiError("PAYMENT_ORDER_MISMATCH", "결제 주문번호가 일치하지 않습니다.", HttpStatus.CONFLICT);
      }
      return this.orderView(order);
    }
    if (order.status !== StoreOrderStatus.PENDING) {
      throw new ApiError("STORE_ORDER_NOT_PAYABLE", "결제할 수 없는 교재 주문입니다.", HttpStatus.CONFLICT);
    }
    if (order.expiresAt <= new Date()) {
      await this.releaseOrderReservation(order, requestId, "expired");
      throw new ApiError("STORE_ORDER_EXPIRED", "주문 시간이 만료되었습니다. 다시 주문해 주세요.", HttpStatus.CONFLICT);
    }
    if (input.amount !== order.amount) {
      throw new ApiError("PAYMENT_AMOUNT_MISMATCH", "결제 금액이 주문 금액과 일치하지 않습니다.", HttpStatus.CONFLICT);
    }
    if (!this.paymentProvider.confirmPayment) {
      throw new ApiError("PAYMENT_CONFIRMATION_NOT_SUPPORTED", "결제 승인 공급자를 사용할 수 없습니다.", HttpStatus.SERVICE_UNAVAILABLE);
    }

    let payment: PaymentRecord;
    try {
      payment = await this.paymentProvider.confirmPayment({
        paymentId: input.paymentId,
        orderId: order.id,
        amount: order.amount,
        ...(requestId ? { idempotencyKey: requestId } : {}),
      });
    } catch (error) {
      this.throwPaymentProviderError(error);
    }
    this.assertPayment(order, payment, input.paymentId);

    const usedPayment = await this.prisma.storeOrder.findUnique({
      where: { providerPaymentId: payment.paymentId },
    });
    if (usedPayment && usedPayment.id !== order.id) {
      throw new ApiError("PAYMENT_ALREADY_USED", "이미 처리된 결제입니다.", HttpStatus.CONFLICT);
    }

    const updated = await this.prisma.$transaction(async (transaction) => {
      const claimed = await transaction.storeOrder.updateMany({
        where: { id: order.id, status: StoreOrderStatus.PENDING },
        data: {
          status: StoreOrderStatus.PAID,
          providerPaymentId: payment.paymentId,
          paymentMethod: payment.method,
          paidAt: payment.paidAt,
        },
      });
      const current = await transaction.storeOrder.findUnique({
        where: { id: order.id },
        include: { items: true },
      });
      if (!current || current.status !== StoreOrderStatus.PAID
        || current.providerPaymentId !== payment.paymentId) {
        throw new ApiError("PAYMENT_STATE_CONFLICT", "결제 처리 상태를 다시 확인해 주세요.", HttpStatus.CONFLICT);
      }
      if (claimed.count > 0) {
        await transaction.storeCartItem.deleteMany({
          where: { userId: user.id, productId: { in: current.items.map((item) => item.productId) } },
        });
        await transaction.auditLog.create({
          data: {
            actorId: user.id,
            action: "store.payment.confirmed",
            resourceType: "StoreOrder",
            resourceId: order.id,
            requestId: requestId ?? null,
            metadata: { paymentId: payment.paymentId, amount: payment.amount },
          },
        });
      }
      return current;
    });
    return this.orderView(updated);
  }

  async listOrders(user: CurrentUser) {
    const items = await this.prisma.storeOrder.findMany({
      where: { userId: user.id },
      include: { items: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return { items: items.map((order) => this.orderView(order)) };
  }

  async syncWebhook(body: unknown, requestId?: string) {
    const input = validateWebhook(body);
    if (!input) return { received: true, action: "ignored_event" };
    const order = await this.prisma.storeOrder.findUnique({
      where: { id: input.orderId },
      include: { items: true },
    });
    if (!order) return { received: true, action: "ignored_unknown_order" };

    const payment = await this.getProviderPayment(input.paymentId);
    this.assertPaymentIdentity(order, payment, input.paymentId);
    let status = order.status;
    let action = "no_change";
    if (payment.status === "paid") {
      status = StoreOrderStatus.PAID;
      action = order.status === StoreOrderStatus.PAID ? "no_change" : "payment_confirmed";
    } else if (payment.status === "cancelled") {
      status = StoreOrderStatus.CANCELED;
      action = order.status === StoreOrderStatus.CANCELED ? "no_change" : "payment_canceled";
    } else if (payment.status === "failed" && order.status === StoreOrderStatus.PENDING) {
      status = StoreOrderStatus.FAILED;
      action = "payment_failed";
    }
    if (action === "no_change") return { received: true, action };

    await this.prisma.$transaction(async (transaction) => {
      await transaction.storeOrder.update({
        where: { id: order.id },
        data: {
          status,
          providerPaymentId: payment.paymentId,
          paymentMethod: payment.method,
          paidAt: payment.paidAt,
          refundedAmount: payment.cancelAmount,
          refundedAt: payment.cancelledAt,
        },
      });
      if (status === StoreOrderStatus.PAID) {
        await transaction.storeCartItem.deleteMany({
          where: { userId: order.userId, productId: { in: order.items.map((item) => item.productId) } },
        });
      } else if (order.status === StoreOrderStatus.PENDING && order.inventoryReservedAt && !order.inventoryReleasedAt) {
        for (const item of order.items) {
          await transaction.storeProduct.updateMany({
            where: { id: item.productId, stockQuantity: { not: null } },
            data: { stockQuantity: { increment: item.quantity } },
          });
        }
        await transaction.storeOrder.update({
          where: { id: order.id },
          data: { inventoryReleasedAt: new Date() },
        });
      }
      await transaction.auditLog.create({
        data: {
          actorId: null,
          action: `store.webhook.${action}`,
          resourceType: "StoreOrder",
          resourceId: order.id,
          requestId: requestId ?? null,
          metadata: { paymentId: payment.paymentId, status: payment.status, cancelAmount: payment.cancelAmount },
        },
      });
    });
    return { received: true, action };
  }

  async listAdminOrders() {
    const items = await this.prisma.storeOrder.findMany({
      include: { items: true, user: { select: { id: true, email: true, displayName: true } } },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return { items: items.map((order) => ({ ...this.orderView(order), user: order.user })) };
  }

  async refundOrder(actor: CurrentUser, orderId: string, body: unknown, requestId?: string) {
    const reason = validateRefund(body);
    const order = await this.prisma.storeOrder.findUnique({
      where: { id: orderId },
      include: { items: true },
    });
    if (!order) throw new ApiError("STORE_ORDER_NOT_FOUND", "교재 주문을 찾을 수 없습니다.", HttpStatus.NOT_FOUND);
    if (order.status === StoreOrderStatus.CANCELED && order.refundedAmount >= order.amount) {
      return this.orderView(order);
    }
    if (order.status !== StoreOrderStatus.PAID || !order.providerPaymentId) {
      throw new ApiError("STORE_ORDER_NOT_REFUNDABLE", "환불할 수 없는 교재 주문입니다.", HttpStatus.CONFLICT);
    }

    let payment = await this.getProviderPayment(order.providerPaymentId);
    this.assertPaymentIdentity(order, payment, order.providerPaymentId);
    const cancelAmount = order.amount - payment.cancelAmount;
    if (cancelAmount > 0) {
      if (payment.status !== "paid") {
        throw new ApiError("STORE_ORDER_NOT_REFUNDABLE", "환불 가능한 결제 상태가 아닙니다.", HttpStatus.CONFLICT);
      }
      try {
        payment = await this.paymentProvider.cancelPayment({
          paymentId: order.providerPaymentId,
          amount: cancelAmount,
          checksum: cancelAmount,
          reason,
          idempotencyKey: `store-refund:${order.id}`,
        });
      } catch (error) {
        this.throwPaymentProviderError(error);
      }
      this.assertPaymentIdentity(order, payment, order.providerPaymentId);
    }
    if (payment.cancelAmount < order.amount) {
      throw new ApiError("STORE_REFUND_INCOMPLETE", "전액 환불 결과를 확인하지 못했습니다.", HttpStatus.BAD_GATEWAY);
    }

    const updated = await this.prisma.$transaction(async (transaction) => {
      const value = await transaction.storeOrder.update({
        where: { id: order.id },
        data: {
          status: StoreOrderStatus.CANCELED,
          refundedAmount: payment.cancelAmount,
          refundedAt: payment.cancelledAt ?? new Date(),
        },
        include: { items: true },
      });
      await transaction.auditLog.create({
        data: {
          actorId: actor.id,
          action: "store.payment.refunded",
          resourceType: "StoreOrder",
          resourceId: order.id,
          requestId: requestId ?? null,
          metadata: { paymentId: payment.paymentId, amount: payment.cancelAmount, reason },
        },
      });
      return value;
    });
    return this.orderView(updated);
  }

  private async getProviderPayment(paymentId: string): Promise<PaymentRecord> {
    try {
      return await this.paymentProvider.getPayment(paymentId);
    } catch (error) {
      this.throwPaymentProviderError(error);
    }
  }

  private assertPaymentIdentity(order: { id: string; amount: number }, payment: PaymentRecord, paymentId: string) {
    if (payment.paymentId !== paymentId || payment.orderId !== order.id) {
      throw new ApiError("PAYMENT_ORDER_MISMATCH", "결제 주문번호가 일치하지 않습니다.", HttpStatus.CONFLICT);
    }
    if (!Number.isInteger(payment.amount) || payment.amount !== order.amount) {
      throw new ApiError("PAYMENT_AMOUNT_MISMATCH", "결제 금액이 주문 금액과 일치하지 않습니다.", HttpStatus.CONFLICT);
    }
  }

  private assertPayment(order: { id: string; amount: number }, payment: PaymentRecord, paymentId: string) {
    this.assertPaymentIdentity(order, payment, paymentId);
    if (payment.status !== "paid" || !payment.paidAt) {
      throw new ApiError("PAYMENT_NOT_PAID", "결제가 완료되지 않았습니다.", HttpStatus.CONFLICT);
    }
  }

  private throwPaymentProviderError(error: unknown): never {
    if (error instanceof PaymentComponentError && error.code === "NOT_CONFIGURED") {
      throw new ApiError("PAYMENT_PROVIDER_NOT_CONFIGURED", "토스페이먼츠 서버 설정이 완료되지 않았습니다.", HttpStatus.SERVICE_UNAVAILABLE);
    }
    throw new ApiError("PAYMENT_PROVIDER_ERROR", "토스페이먼츠에서 결제 정보를 확인하지 못했습니다.", HttpStatus.BAD_GATEWAY);
  }

  private async releaseExpiredReservations(requestId?: string) {
    const now = new Date();
    const cutoff = new Date(now.getTime() - INVENTORY_EXPIRY_GRACE_MS);
    const orders = await this.prisma.storeOrder.findMany({
      where: {
        status: StoreOrderStatus.PENDING,
        expiresAt: { lte: cutoff },
        inventoryReservedAt: { not: null },
        inventoryReleasedAt: null,
      },
      include: { items: true },
      orderBy: { expiresAt: "asc" },
      take: 100,
    });
    for (const order of orders) await this.releaseOrderReservation(order, requestId, "expired_cleanup");
  }

  private async releaseOrderReservation(order: {
    id: string;
    userId: string;
    inventoryReservedAt: Date | null;
    inventoryReleasedAt: Date | null;
    items: Array<{ productId: string; quantity: number }>;
  }, requestId: string | undefined, reason: string) {
    await this.prisma.$transaction(async (transaction) => {
      const released = await transaction.storeOrder.updateMany({
        where: {
          id: order.id,
          status: StoreOrderStatus.PENDING,
          inventoryReleasedAt: null,
        },
        data: { status: StoreOrderStatus.FAILED, inventoryReleasedAt: new Date() },
      });
      if (!released.count) return;
      if (order.inventoryReservedAt) {
        for (const item of order.items) {
          await transaction.storeProduct.updateMany({
            where: { id: item.productId, stockQuantity: { not: null } },
            data: { stockQuantity: { increment: item.quantity } },
          });
        }
      }
      await transaction.auditLog.create({
        data: {
          actorId: null,
          action: "store.inventory.released",
          resourceType: "StoreOrder",
          resourceId: order.id,
          requestId: requestId ?? null,
          metadata: { reason },
        },
      });
    });
  }

  private productView(product: {
    id: string;
    name: string;
    price: number;
    requiresShipping: boolean;
    stockQuantity: number | null;
  }) {
    return {
      id: product.id,
      name: product.name,
      price: product.price,
      requiresShipping: product.requiresShipping,
      availableQuantity: product.stockQuantity,
      stockStatus: product.stockQuantity === null
        ? "unlimited"
        : product.stockQuantity === 0 ? "out_of_stock" : product.stockQuantity <= 5 ? "low_stock" : "available",
    };
  }

  private checkoutView(order: Parameters<StoreService["orderView"]>[0], user: CurrentUser) {
    return {
      ...this.orderView(order),
      customerKey: user.id,
      customerEmail: user.email,
      customerName: user.displayName,
    };
  }

  private orderView(order: {
    id: string;
    orderName: string;
    amount: number;
    status: StoreOrderStatus;
    provider: string;
    providerPaymentId: string | null;
    paymentMethod: string | null;
    paidAt: Date | null;
    refundedAmount: number;
    refundedAt: Date | null;
    recipientName: string | null;
    recipientPhone: string | null;
    postalCode: string | null;
    addressLine1: string | null;
    addressLine2: string | null;
    inventoryReservedAt: Date | null;
    inventoryReleasedAt: Date | null;
    expiresAt: Date;
    createdAt: Date;
    items: Array<{
      productId: string;
      quantity: number;
      unitPriceSnapshot: number;
      nameSnapshot: string;
      lineAmount: number;
    }>;
  }) {
    return {
      orderId: order.id,
      orderName: order.orderName,
      amount: order.amount,
      status: order.status.toLowerCase(),
      provider: order.provider,
      paymentId: order.providerPaymentId,
      paymentMethod: order.paymentMethod,
      method: order.paymentMethod,
      paidAt: order.paidAt,
      refundedAmount: order.refundedAmount,
      refundedAt: order.refundedAt,
      shipping: order.recipientName ? {
        recipientName: order.recipientName,
        recipientPhone: order.recipientPhone,
        postalCode: order.postalCode,
        addressLine1: order.addressLine1,
        addressLine2: order.addressLine2,
      } : null,
      inventory: {
        reservedAt: order.inventoryReservedAt,
        releasedAt: order.inventoryReleasedAt,
      },
      expiresAt: order.expiresAt,
      createdAt: order.createdAt,
      items: order.items.map((item) => ({
        productId: item.productId,
        name: item.nameSnapshot,
        quantity: item.quantity,
        unitPrice: item.unitPriceSnapshot,
        amount: item.lineAmount,
      })),
    };
  }
}
