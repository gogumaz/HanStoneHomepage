import { randomUUID } from "node:crypto";
import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import type { CurrentUser } from "../auth/auth.types.js";
import { ApiError } from "../common/api-error.js";
import { PrismaService } from "../database/prisma.service.js";
import {
  SubscriptionOrderStatus,
  SubscriptionPaymentStatus,
} from "../generated/prisma/enums.js";
import {
  PAYMENT_PROVIDER,
  PaymentComponentError,
  type PaymentProvider,
  type PaymentRecord,
} from "../components/payments/index.js";

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const ORDER_TTL_MS = 30 * 60 * 1000;
const RECONCILIATION_MAX_RANGE_DAYS = 366;
const RECONCILIATION_MAX_ROWS = 5_000;
const RECONCILIATION_DEFAULT_PAGE_SIZE = 50;
const RECONCILIATION_MAX_PAGE_SIZE = 200;

type CheckoutInput = { planId: string };
type VerifyInput = { paymentId: string; orderId: string };
type WebhookInput = VerifyInput & { cancellationId: string | null };
type ReconciliationStatus = "matched" | "attention";
type ReconciliationFilters = {
  from: Date | null;
  toExclusive: Date | null;
  fromDate: string | null;
  toDate: string | null;
  orderStatus: SubscriptionOrderStatus | null;
  reconciliationStatus: ReconciliationStatus | null;
  search: string;
  page: number;
  pageSize: number;
};

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parsePositiveInteger(value: unknown, fallback: number, maximum: number): number {
  const text = readString(value);
  if (!text) return fallback;
  if (!/^\d+$/.test(text)) {
    throw new ApiError("INVALID_RECONCILIATION_QUERY", "페이지 조건을 확인해 주세요.", HttpStatus.BAD_REQUEST);
  }
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new ApiError("INVALID_RECONCILIATION_QUERY", "페이지 조건을 확인해 주세요.", HttpStatus.BAD_REQUEST);
  }
  return parsed;
}

function parseKstDate(value: unknown, label: string): { text: string; start: Date } | null {
  const text = readString(value);
  if (!text) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new ApiError("INVALID_RECONCILIATION_DATE", `${label} 형식을 확인해 주세요.`, HttpStatus.BAD_REQUEST);
  }
  const start = new Date(`${text}T00:00:00+09:00`);
  const normalized = new Date(start.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
  if (Number.isNaN(start.getTime()) || normalized !== text) {
    throw new ApiError("INVALID_RECONCILIATION_DATE", `${label}를 확인해 주세요.`, HttpStatus.BAD_REQUEST);
  }
  return { text, start };
}

function validateReconciliationQuery(query: unknown): ReconciliationFilters {
  const data = query && typeof query === "object" ? query as Record<string, unknown> : {};
  let from = parseKstDate(data.from, "조회 시작일");
  let to = parseKstDate(data.to, "조회 종료일");
  if (Boolean(from) !== Boolean(to)) {
    throw new ApiError("INVALID_RECONCILIATION_RANGE", "조회 시작일과 종료일을 함께 입력해 주세요.", HttpStatus.BAD_REQUEST);
  }
  if (!from && !to) {
    const now = new Date();
    const todayText = new Date(now.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
    const today = parseKstDate(todayText, "조회 종료일");
    const fromStart = new Date((today?.start.getTime() ?? now.getTime()) - 30 * 86_400_000);
    const fromText = new Date(fromStart.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
    from = { text: fromText, start: fromStart };
    to = today;
  }
  if (from && to && from.start > to.start) {
    throw new ApiError("INVALID_RECONCILIATION_RANGE", "조회 시작일은 종료일보다 늦을 수 없습니다.", HttpStatus.BAD_REQUEST);
  }
  if (from && to && (to.start.getTime() - from.start.getTime()) / 86_400_000 >= RECONCILIATION_MAX_RANGE_DAYS) {
    throw new ApiError(
      "RECONCILIATION_RANGE_TOO_LARGE",
      `결제 대사 기간은 최대 ${RECONCILIATION_MAX_RANGE_DAYS}일입니다.`,
      HttpStatus.BAD_REQUEST,
    );
  }

  const rawOrderStatus = readString(data.status).toUpperCase();
  const orderStatus = rawOrderStatus && rawOrderStatus !== "ALL"
    ? Object.values(SubscriptionOrderStatus).find((status) => status === rawOrderStatus) ?? null
    : null;
  if (rawOrderStatus && rawOrderStatus !== "ALL" && !orderStatus) {
    throw new ApiError("INVALID_RECONCILIATION_STATUS", "주문 상태를 확인해 주세요.", HttpStatus.BAD_REQUEST);
  }

  const rawReconciliationStatus = readString(data.reconciliation).toLowerCase();
  const reconciliationStatus = rawReconciliationStatus && rawReconciliationStatus !== "all"
    ? rawReconciliationStatus as ReconciliationStatus
    : null;
  if (reconciliationStatus && !["matched", "attention"].includes(reconciliationStatus)) {
    throw new ApiError("INVALID_RECONCILIATION_STATUS", "대사 상태를 확인해 주세요.", HttpStatus.BAD_REQUEST);
  }

  const search = readString(data.search);
  if (search.length > 100) {
    throw new ApiError("INVALID_RECONCILIATION_SEARCH", "검색어는 100자 이하로 입력해 주세요.", HttpStatus.BAD_REQUEST);
  }

  return {
    from: from?.start ?? null,
    toExclusive: to ? new Date(to.start.getTime() + 86_400_000) : null,
    fromDate: from?.text ?? null,
    toDate: to?.text ?? null,
    orderStatus,
    reconciliationStatus,
    search,
    page: parsePositiveInteger(data.page, 1, 100_000),
    pageSize: parsePositiveInteger(data.pageSize, RECONCILIATION_DEFAULT_PAGE_SIZE, RECONCILIATION_MAX_PAGE_SIZE),
  };
}

function csvCell(value: unknown): string {
  let text = value instanceof Date ? value.toISOString() : String(value ?? "");
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function validateCheckout(body: unknown): CheckoutInput {
  if (!body || typeof body !== "object") {
    throw new ApiError("INVALID_CHECKOUT", "구독 플랜을 확인해 주세요.", HttpStatus.BAD_REQUEST);
  }
  const items = (body as Record<string, unknown>).items;
  if (!Array.isArray(items) || items.length !== 1 || !items[0] || typeof items[0] !== "object") {
    throw new ApiError("INVALID_CHECKOUT", "구독 플랜 한 개만 결제할 수 있습니다.", HttpStatus.BAD_REQUEST);
  }
  const item = items[0] as Record<string, unknown>;
  const planId = readString(item.planId);
  if (item.productType !== "account_subscription" || !planId || item.quantity !== 1) {
    throw new ApiError("INVALID_CHECKOUT", "구독 주문 정보를 확인해 주세요.", HttpStatus.BAD_REQUEST);
  }
  return { planId };
}

function validateVerification(body: unknown): VerifyInput {
  if (!body || typeof body !== "object") {
    throw new ApiError("INVALID_PAYMENT", "결제 확인 정보를 입력해 주세요.", HttpStatus.BAD_REQUEST);
  }
  const data = body as Record<string, unknown>;
  const paymentId = readString(data.paymentId ?? data.impUid ?? data.imp_uid);
  const orderId = readString(data.orderId ?? data.merchantUid ?? data.merchant_uid);
  if (!paymentId || paymentId.length > 100 || !orderId || orderId.length > 80) {
    throw new ApiError("INVALID_PAYMENT", "결제 확인 정보가 올바르지 않습니다.", HttpStatus.BAD_REQUEST);
  }
  return { paymentId, orderId };
}

function validateWebhook(body: unknown): WebhookInput {
  const input = validateVerification(body);
  const data = body as Record<string, unknown>;
  const cancellationId = readString(data.cancellationId ?? data.cancellation_id) || null;
  if (cancellationId && cancellationId.length > 120) {
    throw new ApiError("INVALID_PAYMENT", "웹훅 정보를 확인해 주세요.", HttpStatus.BAD_REQUEST);
  }
  return { ...input, cancellationId };
}

function validateRefund(body: unknown): { reason: string } {
  if (!body || typeof body !== "object") {
    throw new ApiError("INVALID_REFUND", "환불 사유를 입력해 주세요.", HttpStatus.BAD_REQUEST);
  }
  const reason = readString((body as Record<string, unknown>).reason);
  if (reason.length < 5 || reason.length > 500) {
    throw new ApiError("INVALID_REFUND_REASON", "환불 사유는 5자 이상 500자 이하로 입력해 주세요.", HttpStatus.BAD_REQUEST);
  }
  return { reason };
}

export function calculateSubscriptionEnd(paidAt: Date, months: number): Date {
  const kst = new Date(paidAt.getTime() + KST_OFFSET_MS);
  const targetMonth = kst.getUTCMonth() + months;
  const targetYear = kst.getUTCFullYear() + Math.floor(targetMonth / 12);
  const normalizedMonth = ((targetMonth % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0)).getUTCDate();
  const lastUsageDay = Math.min(kst.getUTCDate(), lastDay);
  return new Date(
    Date.UTC(targetYear, normalizedMonth, lastUsageDay + 1) - KST_OFFSET_MS,
  );
}

@Injectable()
export class SubscriptionService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(PAYMENT_PROVIDER) private readonly paymentProvider: PaymentProvider,
  ) {}

  async createCheckout(user: CurrentUser, body: unknown, requestId?: string) {
    const input = validateCheckout(body);
    const now = new Date();
    const [plan, activeSubscription, pendingOrder] = await Promise.all([
      this.prisma.subscriptionPlan.findFirst({ where: { id: input.planId, active: true } }),
      this.prisma.accountSubscription.findFirst({
        where: {
          userId: user.id,
          paymentStatus: SubscriptionPaymentStatus.PAID,
          startsAt: { lte: now },
          endsAt: { gt: now },
        },
      }),
      this.prisma.subscriptionOrder.findFirst({
        where: {
          userId: user.id,
          status: SubscriptionOrderStatus.PENDING,
          expiresAt: { gt: now },
        },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    if (!plan) {
      throw new ApiError("SUBSCRIPTION_PLAN_NOT_FOUND", "선택한 구독 플랜을 이용할 수 없습니다.", HttpStatus.NOT_FOUND);
    }
    if (activeSubscription) {
      throw new ApiError("ACTIVE_SUBSCRIPTION_EXISTS", "이미 이용 중인 구독이 있습니다.", HttpStatus.CONFLICT);
    }
    if (pendingOrder) {
      if (pendingOrder.planId === plan.id) return this.checkoutView(pendingOrder, user);
      throw new ApiError("PENDING_ORDER_EXISTS", "진행 중인 구독 주문을 먼저 완료해 주세요.", HttpStatus.CONFLICT);
    }

    const order = await this.prisma.$transaction(async (transaction) => {
      const created = await transaction.subscriptionOrder.create({
        data: {
          id: `sub_${randomUUID().replaceAll("-", "")}`,
          userId: user.id,
          planId: plan.id,
          orderName: `바둑타고 ${plan.label} 구독`,
          amount: plan.price,
          planLabelSnapshot: plan.label,
          monthsSnapshot: plan.months,
          expiresAt: new Date(now.getTime() + ORDER_TTL_MS),
        },
      });
      await transaction.auditLog.create({
        data: {
          actorId: user.id,
          action: "subscription.order.created",
          resourceType: "SubscriptionOrder",
          resourceId: created.id,
          requestId: requestId ?? null,
          metadata: { planId: plan.id, amount: plan.price },
        },
      });
      return created;
    });
    return this.checkoutView(order, user);
  }

  async verifyPayment(user: CurrentUser, body: unknown, requestId?: string) {
    const input = validateVerification(body);
    const order = await this.prisma.subscriptionOrder.findFirst({
      where: { id: input.orderId, userId: user.id },
    });
    if (!order) {
      throw new ApiError("ORDER_NOT_FOUND", "구독 주문을 찾을 수 없습니다.", HttpStatus.NOT_FOUND);
    }

    if (order.status === SubscriptionOrderStatus.PAID) {
      if (order.providerPaymentId && order.providerPaymentId !== input.paymentId) {
        throw new ApiError("PAYMENT_ORDER_MISMATCH", "결제 주문번호가 일치하지 않습니다.", HttpStatus.CONFLICT);
      }
      const subscription = await this.prisma.accountSubscription.findUnique({
        where: { orderId: order.id },
      });
      if (!subscription) {
        throw new ApiError("PAYMENT_STATE_INVALID", "결제 상태를 확인해 주세요.", HttpStatus.CONFLICT);
      }
      return this.paymentResult(order, subscription);
    }
    if (order.status !== SubscriptionOrderStatus.PENDING) {
      throw new ApiError("ORDER_NOT_PAYABLE", "결제할 수 없는 주문입니다.", HttpStatus.CONFLICT);
    }

    const payment = await this.getProviderPayment(input.paymentId);
    if (payment.paymentId !== input.paymentId || payment.orderId !== order.id) {
      throw new ApiError("PAYMENT_ORDER_MISMATCH", "결제 주문번호가 일치하지 않습니다.", HttpStatus.CONFLICT);
    }
    if (payment.status !== "paid") {
      throw new ApiError("PAYMENT_NOT_PAID", "결제가 완료되지 않았습니다.", HttpStatus.CONFLICT);
    }
    if (!payment.paidAt) {
      throw new ApiError("PAYMENT_STATE_INVALID", "결제 승인시각을 확인할 수 없습니다.", HttpStatus.CONFLICT);
    }
    if (!Number.isInteger(payment.amount) || payment.amount !== order.amount) {
      throw new ApiError("PAYMENT_AMOUNT_MISMATCH", "결제 금액이 주문 금액과 일치하지 않습니다.", HttpStatus.CONFLICT);
    }

    const usedPayment = await this.prisma.subscriptionOrder.findUnique({
      where: { providerPaymentId: payment.paymentId },
    });
    if (usedPayment && usedPayment.id !== order.id) {
      throw new ApiError("PAYMENT_ALREADY_USED", "이미 처리된 결제입니다.", HttpStatus.CONFLICT);
    }

    const subscription = await this.finalizePaidOrder(order, payment, user.id, requestId);

    return this.paymentResult({ ...order, paymentMethod: payment.method }, subscription);
  }

  async syncWebhook(body: unknown, requestId?: string) {
    const input = validateWebhook(body);
    const order = await this.prisma.subscriptionOrder.findUnique({ where: { id: input.orderId } });
    if (!order) return { received: true, action: "ignored_unknown_order" };

    const payment = await this.getProviderPayment(input.paymentId);
    if (payment.paymentId !== input.paymentId || payment.orderId !== order.id) {
      throw new ApiError("PAYMENT_ORDER_MISMATCH", "결제 주문번호가 일치하지 않습니다.", HttpStatus.CONFLICT);
    }
    if (!Number.isInteger(payment.amount) || payment.amount !== order.amount) {
      throw new ApiError("PAYMENT_AMOUNT_MISMATCH", "결제 금액이 주문 금액과 일치하지 않습니다.", HttpStatus.CONFLICT);
    }

    if (payment.cancelAmount > 0 || payment.status === "cancelled") {
      let subscription = await this.prisma.accountSubscription.findUnique({ where: { orderId: order.id } });
      if (!subscription && payment.status === "paid" && payment.paidAt) {
        await this.finalizePaidOrder(order, payment, null, requestId);
        subscription = await this.prisma.accountSubscription.findUnique({ where: { orderId: order.id } });
      }
      if (subscription) {
        await this.applyRefund(
          order,
          subscription,
          payment,
          input.cancellationId,
          "PortOne 웹훅 환불 동기화",
          null,
          requestId,
        );
        return {
          received: true,
          action: payment.cancelAmount >= order.amount ? "subscription_refunded" : "partial_refund_synced",
        };
      }
      await this.prisma.subscriptionOrder.updateMany({
        where: { id: order.id, status: SubscriptionOrderStatus.PENDING },
        data: {
          status: SubscriptionOrderStatus.CANCELED,
          providerPaymentId: payment.paymentId,
          refundedAmount: Math.min(payment.cancelAmount, order.amount),
          refundedAt: payment.cancelledAt,
        },
      });
      return { received: true, action: "unissued_payment_canceled" };
    }

    if (payment.status === "paid") {
      if (!payment.paidAt) {
        throw new ApiError("PAYMENT_STATE_INVALID", "결제 승인시각을 확인할 수 없습니다.", HttpStatus.CONFLICT);
      }
      await this.finalizePaidOrder(order, payment, null, requestId);
      return { received: true, action: "payment_confirmed" };
    }

    if (payment.status === "failed") {
      await this.prisma.subscriptionOrder.updateMany({
        where: { id: order.id, status: SubscriptionOrderStatus.PENDING },
        data: { status: SubscriptionOrderStatus.FAILED, providerPaymentId: payment.paymentId },
      });
      return { received: true, action: "payment_failed" };
    }

    return { received: true, action: "no_change" };
  }

  async refundSubscription(
    actor: CurrentUser,
    subscriptionId: string,
    body: unknown,
    requestId?: string,
  ) {
    const { reason } = validateRefund(body);
    const subscription = await this.prisma.accountSubscription.findUnique({ where: { id: subscriptionId } });
    if (!subscription) {
      throw new ApiError("SUBSCRIPTION_NOT_FOUND", "구독 내역을 찾을 수 없습니다.", HttpStatus.NOT_FOUND);
    }
    const order = await this.prisma.subscriptionOrder.findUnique({ where: { id: subscription.orderId } });
    if (!order || !subscription.paymentId) {
      throw new ApiError("PAYMENT_STATE_INVALID", "환불할 결제 정보를 확인할 수 없습니다.", HttpStatus.CONFLICT);
    }
    if (subscription.paymentStatus === SubscriptionPaymentStatus.REFUNDED) {
      return this.refundResult(subscription, order);
    }

    let payment = await this.getProviderPayment(subscription.paymentId);
    this.assertRefundPayment(order, payment);
    const cancelableAmount = order.amount - payment.cancelAmount;
    if (cancelableAmount > 0) {
      if (payment.status !== "paid") {
        throw new ApiError("PAYMENT_NOT_REFUNDABLE", "현재 상태에서는 결제를 환불할 수 없습니다.", HttpStatus.CONFLICT);
      }
      payment = await this.cancelProviderPayment({
        paymentId: subscription.paymentId,
        amount: cancelableAmount,
        checksum: cancelableAmount,
        reason,
      });
      this.assertRefundPayment(order, payment);
    }
    if (payment.cancelAmount < order.amount) {
      throw new ApiError("REFUND_INCOMPLETE", "전액 환불 결과를 확인하지 못했습니다.", HttpStatus.BAD_GATEWAY);
    }

    const updated = await this.applyRefund(
      order,
      subscription,
      payment,
      null,
      reason,
      actor.id,
      requestId,
    );
    return this.refundResult(updated, order);
  }

  private async getProviderPayment(paymentId: string): Promise<PaymentRecord> {
    try {
      return await this.paymentProvider.getPayment(paymentId);
    } catch (error) {
      this.throwPaymentProviderError(error);
    }
  }

  private async cancelProviderPayment(input: {
    paymentId: string;
    amount: number;
    checksum: number;
    reason: string;
  }): Promise<PaymentRecord> {
    try {
      return await this.paymentProvider.cancelPayment(input);
    } catch (error) {
      this.throwPaymentProviderError(error);
    }
  }

  private throwPaymentProviderError(error: unknown): never {
    if (error instanceof PaymentComponentError && error.code === "NOT_CONFIGURED") {
      throw new ApiError(
        "PAYMENT_PROVIDER_NOT_CONFIGURED",
        "결제 서버 설정이 완료되지 않았습니다.",
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    throw new ApiError(
      "PAYMENT_PROVIDER_ERROR",
      "결제 제공사에서 결제 정보를 확인하지 못했습니다.",
      HttpStatus.BAD_GATEWAY,
    );
  }

  private async finalizePaidOrder(
    order: {
      id: string; userId: string; planId: string; orderName: string; amount: number;
      planLabelSnapshot: string; monthsSnapshot: number; paymentMethod: string | null;
    },
    payment: PaymentRecord,
    actorId: string | null,
    requestId?: string,
  ) {
    if (!payment.paidAt) {
      throw new ApiError("PAYMENT_STATE_INVALID", "결제 승인시각을 확인할 수 없습니다.", HttpStatus.CONFLICT);
    }
    const paidAt = payment.paidAt;
    return this.prisma.$transaction(async (transaction) => {
      const claimed = await transaction.subscriptionOrder.updateMany({
        where: { id: order.id, status: SubscriptionOrderStatus.PENDING },
        data: {
          status: SubscriptionOrderStatus.PAID,
          providerPaymentId: payment.paymentId,
          paymentMethod: payment.method,
          paidAt,
        },
      });
      if (claimed.count === 0) {
        const existing = await transaction.accountSubscription.findUnique({ where: { orderId: order.id } });
        if (!existing) {
          throw new ApiError("PAYMENT_STATE_INVALID", "결제 상태를 확인해 주세요.", HttpStatus.CONFLICT);
        }
        return existing;
      }
      const created = await transaction.accountSubscription.create({
        data: {
          userId: order.userId,
          planId: order.planId,
          orderId: order.id,
          paymentId: payment.paymentId,
          planLabelSnapshot: order.planLabelSnapshot,
          monthsSnapshot: order.monthsSnapshot,
          amountSnapshot: order.amount,
          paidAt,
          startsAt: paidAt,
          endsAt: calculateSubscriptionEnd(paidAt, order.monthsSnapshot),
        },
      });
      await transaction.auditLog.create({
        data: {
          actorId,
          action: "subscription.payment.confirmed",
          resourceType: "AccountSubscription",
          resourceId: created.id,
          requestId: requestId ?? null,
          metadata: { orderId: order.id, paymentId: payment.paymentId, amount: payment.amount },
        },
      });
      return created;
    });
  }

  private assertRefundPayment(
    order: { id: string; amount: number; providerPaymentId: string | null },
    payment: PaymentRecord,
  ): void {
    if (
      payment.orderId !== order.id
      || (order.providerPaymentId && payment.paymentId !== order.providerPaymentId)
    ) {
      throw new ApiError("PAYMENT_ORDER_MISMATCH", "결제 주문번호가 일치하지 않습니다.", HttpStatus.CONFLICT);
    }
    if (
      !Number.isInteger(payment.amount)
      || payment.amount !== order.amount
      || !Number.isInteger(payment.cancelAmount)
      || payment.cancelAmount < 0
      || payment.cancelAmount > order.amount
    ) {
      throw new ApiError("PAYMENT_AMOUNT_MISMATCH", "결제 또는 환불 금액이 주문과 일치하지 않습니다.", HttpStatus.CONFLICT);
    }
  }

  private async applyRefund(
    order: {
      id: string; amount: number; refundedAmount: number; providerPaymentId: string | null;
    },
    subscription: {
      id: string; paymentStatus: SubscriptionPaymentStatus; refundedAmount: number;
      refundedAt: Date | null;
    },
    payment: PaymentRecord,
    providerCancellationId: string | null,
    reason: string,
    actorId: string | null,
    requestId?: string,
  ) {
    this.assertRefundPayment(order, payment);
    const cumulativeAmount = Math.min(payment.cancelAmount, order.amount);
    const previousAmount = Math.max(order.refundedAmount, subscription.refundedAmount);
    const refundAmount = Math.max(0, cumulativeAmount - previousAmount);
    const isFullRefund = cumulativeAmount >= order.amount;
    const completedAt = payment.cancelledAt ?? new Date();
    const cancellationId = providerCancellationId
      || `portone_${payment.paymentId}_${cumulativeAmount}`;

    return this.prisma.$transaction(async (transaction) => {
      await transaction.subscriptionOrder.update({
        where: { id: order.id },
        data: {
          status: isFullRefund ? SubscriptionOrderStatus.CANCELED : SubscriptionOrderStatus.PAID,
          refundedAmount: cumulativeAmount,
          refundedAt: isFullRefund ? completedAt : null,
        },
      });
      const updated = await transaction.accountSubscription.update({
        where: { id: subscription.id },
        data: {
          paymentStatus: isFullRefund
            ? SubscriptionPaymentStatus.REFUNDED
            : SubscriptionPaymentStatus.PAID,
          refundedAmount: cumulativeAmount,
          refundedAt: isFullRefund ? completedAt : null,
        },
      });
      if (refundAmount > 0) {
        await transaction.subscriptionRefund.upsert({
          where: { providerCancellationId: cancellationId },
          create: {
            subscriptionId: subscription.id,
            requestedById: actorId,
            providerCancellationId: cancellationId,
            amount: refundAmount,
            cumulativeAmount,
            reason,
            requestedAt: new Date(),
            completedAt,
          },
          update: {},
        });
        await transaction.auditLog.create({
          data: {
            actorId,
            action: isFullRefund ? "subscription.refunded" : "subscription.partial_refund.synced",
            resourceType: "AccountSubscription",
            resourceId: subscription.id,
            requestId: requestId ?? null,
            metadata: {
              orderId: order.id,
              paymentId: payment.paymentId,
              refundAmount,
              cumulativeAmount,
            },
          },
        });
      }
      return updated;
    });
  }

  private refundResult(
    subscription: {
      id: string; orderId: string; paymentStatus: SubscriptionPaymentStatus;
      refundedAmount: number; refundedAt: Date | null;
    },
    order: { amount: number },
  ) {
    return {
      subscriptionId: subscription.id,
      orderId: subscription.orderId,
      paymentStatus: subscription.paymentStatus.toLowerCase(),
      amount: order.amount,
      refundedAmount: subscription.refundedAmount,
      refundedAt: subscription.refundedAt,
      accessRevoked: subscription.paymentStatus === SubscriptionPaymentStatus.REFUNDED,
    };
  }

  async listOrders(user: CurrentUser) {
    const items = await this.prisma.subscriptionOrder.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    });
    return { items: items.map((order) => this.orderView(order)) };
  }

  async listSubscriptions(user: CurrentUser) {
    const now = new Date();
    const items = await this.prisma.accountSubscription.findMany({
      where: { userId: user.id },
      orderBy: { paidAt: "desc" },
    });
    return {
      items: items.map((subscription) => ({
        id: subscription.id,
        orderId: subscription.orderId,
        planId: subscription.planId,
        planLabelSnapshot: subscription.planLabelSnapshot,
        monthsSnapshot: subscription.monthsSnapshot,
        amountSnapshot: subscription.amountSnapshot,
        paymentStatus: subscription.paymentStatus.toLowerCase(),
        refundedAmount: subscription.refundedAmount,
        refundedAt: subscription.refundedAt,
        paidAt: subscription.paidAt,
        startsAt: subscription.startsAt,
        endsAt: subscription.endsAt,
        active: subscription.paymentStatus === SubscriptionPaymentStatus.PAID
          && subscription.startsAt <= now
          && subscription.endsAt > now,
      })),
    };
  }

  async listPaymentReconciliation(query?: unknown) {
    const filters = validateReconciliationQuery(query);
    const report = await this.buildPaymentReconciliation(filters);
    const start = (filters.page - 1) * filters.pageSize;
    const totalPages = Math.max(1, Math.ceil(report.items.length / filters.pageSize));
    return {
      generatedAt: report.generatedAt,
      limit: RECONCILIATION_MAX_ROWS,
      truncated: report.truncated,
      filters: this.reconciliationFilterView(filters),
      pagination: {
        page: filters.page,
        pageSize: filters.pageSize,
        total: report.items.length,
        totalPages,
      },
      summary: report.summary,
      items: report.items.slice(start, start + filters.pageSize),
    };
  }

  async exportPaymentReconciliationCsv(
    actor: CurrentUser,
    query?: unknown,
    requestId?: string,
  ) {
    const filters = validateReconciliationQuery(query);
    const report = await this.buildPaymentReconciliation(filters);
    if (report.truncated) {
      throw new ApiError(
        "RECONCILIATION_EXPORT_TOO_LARGE",
        `내보내기 결과가 ${RECONCILIATION_MAX_ROWS.toLocaleString("ko-KR")}건을 초과합니다. 조회 기간이나 조건을 좁혀 주세요.`,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const header = [
      "주문번호", "주문일시", "주문상태", "PortOne 결제번호", "결제수단",
      "회원번호", "회원명", "회원이메일", "상품명", "결제금액", "환불금액",
      "구독상태", "구독시작", "구독종료", "대사상태", "확인항목",
    ];
    const rows = report.items.map((item) => [
      item.order.id,
      item.order.createdAt,
      item.order.status,
      item.order.paymentId,
      item.order.paymentMethod,
      item.order.user.id,
      item.order.user.displayName,
      item.order.user.email,
      item.order.orderName,
      item.order.amount,
      item.order.refundedAmount,
      item.subscription?.paymentStatus,
      item.subscription?.startsAt,
      item.subscription?.endsAt,
      item.reconciliation.status,
      item.reconciliation.issues.join("|"),
    ]);
    const content = `\uFEFF${[header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
    await this.prisma.auditLog.create({
      data: {
        actorId: actor.id,
        action: "subscription.payments.reconciliation_exported",
        resourceType: "SubscriptionOrder",
        resourceId: null,
        requestId: requestId ?? null,
        metadata: {
          ...this.reconciliationFilterView(filters),
          exportedCount: report.items.length,
        },
      },
    });
    const date = new Date(report.generatedAt.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
    return { filename: `payment-reconciliation-${date}.csv`, content };
  }

  private reconciliationFilterView(filters: ReconciliationFilters) {
    return {
      from: filters.fromDate,
      to: filters.toDate,
      status: filters.orderStatus?.toLowerCase() ?? "all",
      reconciliation: filters.reconciliationStatus ?? "all",
      search: filters.search,
    };
  }

  private async buildPaymentReconciliation(filters: ReconciliationFilters) {
    const now = new Date();
    const createdAt = {
      ...(filters.from ? { gte: filters.from } : {}),
      ...(filters.toExclusive ? { lt: filters.toExclusive } : {}),
    };
    const orders = await this.prisma.subscriptionOrder.findMany({
      where: {
        ...(Object.keys(createdAt).length ? { createdAt } : {}),
        ...(filters.orderStatus ? { status: filters.orderStatus } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: RECONCILIATION_MAX_ROWS + 1,
      include: { user: { select: { id: true, email: true, displayName: true } } },
    });
    const truncated = orders.length > RECONCILIATION_MAX_ROWS;
    const selectedOrders = orders.slice(0, RECONCILIATION_MAX_ROWS);
    const subscriptions = selectedOrders.length
      ? await this.prisma.accountSubscription.findMany({
        where: { orderId: { in: selectedOrders.map((order) => order.id) } },
        include: {
          refunds: {
            orderBy: { completedAt: "desc" },
            select: {
              id: true,
              amount: true,
              cumulativeAmount: true,
              reason: true,
              completedAt: true,
              providerCancellationId: true,
            },
          },
        },
      })
      : [];
    const subscriptionByOrder = new Map(subscriptions.map((item) => [item.orderId, item]));
    const keyword = filters.search.toLocaleLowerCase("ko-KR");
    const items = selectedOrders.map((order) => {
      const subscription = subscriptionByOrder.get(order.id) ?? null;
      const issues: string[] = [];
      if (order.status === SubscriptionOrderStatus.PENDING && order.expiresAt <= now) {
        issues.push("expired_pending_order");
      }
      if (order.status === SubscriptionOrderStatus.PAID && !order.providerPaymentId) {
        issues.push("paid_order_missing_payment_id");
      }
      if (order.status === SubscriptionOrderStatus.PAID && !subscription) {
        issues.push("paid_order_missing_subscription");
      }
      if (subscription) {
        if (subscription.userId !== order.userId) issues.push("subscription_user_mismatch");
        if (subscription.amountSnapshot !== order.amount) issues.push("subscription_amount_mismatch");
        if (subscription.paymentId !== order.providerPaymentId) issues.push("provider_payment_id_mismatch");
        if (subscription.refundedAmount !== order.refundedAmount) issues.push("refunded_amount_mismatch");
        if (
          order.status === SubscriptionOrderStatus.CANCELED
          && subscription.paymentStatus !== SubscriptionPaymentStatus.REFUNDED
        ) issues.push("canceled_order_access_not_revoked");
        if (
          order.status === SubscriptionOrderStatus.PAID
          && subscription.paymentStatus === SubscriptionPaymentStatus.REFUNDED
        ) issues.push("refunded_subscription_order_not_canceled");
        if (
          order.refundedAmount >= order.amount
          && order.status !== SubscriptionOrderStatus.CANCELED
        ) issues.push("full_refund_order_not_canceled");
        if (
          subscription.refundedAmount >= subscription.amountSnapshot
          && subscription.paymentStatus !== SubscriptionPaymentStatus.REFUNDED
        ) issues.push("full_refund_access_not_revoked");
      }
      return {
        order: {
          ...this.orderView(order),
          user: order.user,
        },
        subscription: subscription ? {
          id: subscription.id,
          paymentStatus: subscription.paymentStatus.toLowerCase(),
          amountSnapshot: subscription.amountSnapshot,
          refundedAmount: subscription.refundedAmount,
          refundedAt: subscription.refundedAt,
          startsAt: subscription.startsAt,
          endsAt: subscription.endsAt,
        } : null,
        refunds: subscription?.refunds.map((refund) => ({
          id: refund.id,
          amount: refund.amount,
          cumulativeAmount: refund.cumulativeAmount,
          reason: refund.reason,
          completedAt: refund.completedAt,
          providerCancellationId: refund.providerCancellationId,
        })) ?? [],
        reconciliation: {
          status: issues.length ? "attention" as const : "matched" as const,
          issues,
          canSync: Boolean(order.providerPaymentId),
        },
      };
    }).filter((item) => {
      if (filters.reconciliationStatus && item.reconciliation.status !== filters.reconciliationStatus) return false;
      if (!keyword) return true;
      return [
        item.order.id,
        item.order.paymentId ?? "",
        item.order.user.id,
        item.order.user.email ?? "",
        item.order.user.displayName,
        item.order.orderName,
      ].some((value) => value.toLocaleLowerCase("ko-KR").includes(keyword));
    });
    return {
      generatedAt: now,
      truncated,
      summary: {
        total: items.length,
        attention: items.filter((item) => item.reconciliation.status === "attention").length,
        paidAmount: items
          .filter((item) => item.order.paidAt)
          .reduce((sum, item) => sum + item.order.amount, 0),
        refundedAmount: items.reduce((sum, item) => sum + item.order.refundedAmount, 0),
      },
      items,
    };
  }

  async reconcileOrder(actor: CurrentUser, orderId: string, body: unknown, requestId?: string) {
    const order = await this.prisma.subscriptionOrder.findUnique({ where: { id: orderId } });
    if (!order) throw new ApiError("ORDER_NOT_FOUND", "구독 주문을 찾을 수 없습니다.", HttpStatus.NOT_FOUND);
    const requestedPaymentId = body && typeof body === "object"
      ? readString((body as Record<string, unknown>).paymentId)
      : "";
    if (requestedPaymentId.length > 100) {
      throw new ApiError("INVALID_PAYMENT", "PortOne 결제번호를 확인해 주세요.", HttpStatus.BAD_REQUEST);
    }
    const paymentId = order.providerPaymentId || requestedPaymentId;
    if (!paymentId) {
      throw new ApiError(
        "PAYMENT_ID_REQUIRED",
        "PortOne 결제번호를 입력해야 대사를 실행할 수 있습니다.",
        HttpStatus.CONFLICT,
      );
    }
    const result = await this.syncWebhook({
      paymentId,
      orderId: order.id,
    }, requestId);
    await this.prisma.auditLog.create({
      data: {
        actorId: actor.id,
        action: "subscription.order.reconciled",
        resourceType: "SubscriptionOrder",
        resourceId: order.id,
        requestId: requestId ?? null,
        metadata: { paymentId, result: result.action },
      },
    });
    return { orderId: order.id, paymentId, action: result.action };
  }

  private checkoutView(order: {
    id: string; orderName: string; amount: number; expiresAt: Date;
  }, user: CurrentUser) {
    return {
      orderId: order.id,
      orderName: order.orderName,
      amount: order.amount,
      currency: "KRW",
      expiresAt: order.expiresAt,
      customerKey: user.id,
      customerEmail: user.email,
      customerName: user.displayName,
    };
  }

  private orderView(order: {
    id: string; planId: string; orderName: string; amount: number;
    planLabelSnapshot: string; monthsSnapshot: number; status: SubscriptionOrderStatus;
    provider: string; providerPaymentId: string | null; paymentMethod: string | null;
    paidAt: Date | null; refundedAmount: number; refundedAt: Date | null;
    expiresAt: Date; createdAt: Date;
  }) {
    return {
      id: order.id,
      planId: order.planId,
      orderName: order.orderName,
      amount: order.amount,
      planLabelSnapshot: order.planLabelSnapshot,
      monthsSnapshot: order.monthsSnapshot,
      status: order.status.toLowerCase(),
      provider: order.provider,
      paymentId: order.providerPaymentId,
      paymentMethod: order.paymentMethod,
      paidAt: order.paidAt,
      refundedAmount: order.refundedAmount,
      refundedAt: order.refundedAt,
      expiresAt: order.expiresAt,
      createdAt: order.createdAt,
    };
  }

  private paymentResult(order: {
    id: string; orderName: string; amount: number; paymentMethod: string | null;
  }, subscription: {
    id: string; planId: string; startsAt: Date; endsAt: Date; paidAt: Date;
  }) {
    return {
      orderId: order.id,
      orderName: order.orderName,
      amount: order.amount,
      method: order.paymentMethod,
      subscription: {
        id: subscription.id,
        planId: subscription.planId,
        paidAt: subscription.paidAt,
        startsAt: subscription.startsAt,
        endsAt: subscription.endsAt,
      },
    };
  }
}
