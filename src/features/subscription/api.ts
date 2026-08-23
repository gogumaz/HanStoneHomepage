import { apiDownload, apiRequest } from '../../lib/api-client';
import type { SubscriptionPlan } from '../content/api';

export type Checkout = {
  orderId: string;
  orderName: string;
  amount: number;
  currency: 'KRW';
  expiresAt: string;
  customerKey: string;
  customerEmail: string | null;
  customerName: string;
};

export type AccountSubscription = {
  id: string;
  orderId: string;
  planId: string;
  planLabelSnapshot: string;
  monthsSnapshot: number;
  amountSnapshot: number;
  paymentStatus: 'paid' | 'canceled' | 'refunded';
  refundedAmount: number;
  refundedAt: string | null;
  paidAt: string;
  startsAt: string;
  endsAt: string;
  active: boolean;
};

export type SubscriptionOrder = {
  id: string;
  planId: string;
  orderName: string;
  amount: number;
  planLabelSnapshot: string;
  monthsSnapshot: number;
  status: 'pending' | 'paid' | 'canceled' | 'failed';
  provider: string;
  paymentId: string | null;
  paymentMethod: string | null;
  paidAt: string | null;
  refundedAmount: number;
  refundedAt: string | null;
  expiresAt: string;
  createdAt: string;
};

export type PaymentResult = {
  orderId: string;
  orderName: string;
  amount: number;
  method: string | null;
  subscription: {
    id: string;
    planId: string;
    paidAt: string;
    startsAt: string;
    endsAt: string;
  };
};

export type AdminPaymentReconciliation = {
  generatedAt: string;
  limit: number;
  truncated: boolean;
  filters: {
    from: string | null;
    to: string | null;
    status: 'all' | 'pending' | 'paid' | 'canceled' | 'failed';
    reconciliation: 'all' | 'matched' | 'attention';
    search: string;
  };
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  summary: {
    total: number;
    attention: number;
    paidAmount: number;
    refundedAmount: number;
  };
  items: Array<{
    order: SubscriptionOrder & {
      user: { id: string; email: string | null; displayName: string };
    };
    subscription: null | {
      id: string;
      paymentStatus: 'paid' | 'canceled' | 'refunded';
      amountSnapshot: number;
      refundedAmount: number;
      refundedAt: string | null;
      startsAt: string;
      endsAt: string;
    };
    refunds: Array<{
      id: string;
      amount: number;
      cumulativeAmount: number;
      reason: string;
      completedAt: string;
      providerCancellationId: string;
    }>;
    reconciliation: {
      status: 'matched' | 'attention';
      issues: string[];
      canSync: boolean;
    };
  }>;
};

export type AdminPaymentReconciliationFilters = {
  from?: string;
  to?: string;
  status?: 'all' | 'pending' | 'paid' | 'canceled' | 'failed';
  reconciliation?: 'all' | 'matched' | 'attention';
  search?: string;
  page?: number;
  pageSize?: number;
};

export function buildAdminPaymentReconciliationQuery(filters: AdminPaymentReconciliationFilters = {}) {
  const query = new URLSearchParams();
  if (filters.from) query.set('from', filters.from);
  if (filters.to) query.set('to', filters.to);
  if (filters.status && filters.status !== 'all') query.set('status', filters.status);
  if (filters.reconciliation && filters.reconciliation !== 'all') {
    query.set('reconciliation', filters.reconciliation);
  }
  if (filters.search?.trim()) query.set('search', filters.search.trim());
  if (filters.page && filters.page > 1) query.set('page', String(filters.page));
  if (filters.pageSize) query.set('pageSize', String(filters.pageSize));
  const value = query.toString();
  return value ? `?${value}` : '';
}

export function listSubscriptionPlans() {
  return apiRequest<{ items: SubscriptionPlan[] }>('/subscription-plans');
}

export function createSubscriptionCheckout(planId: string) {
  return apiRequest<Checkout>('/orders/checkout', {
    method: 'POST',
    body: JSON.stringify({
      items: [{ productType: 'account_subscription', planId, quantity: 1 }],
    }),
  });
}

export function verifyPortOnePayment(paymentId: string, orderId: string) {
  return apiRequest<PaymentResult>('/payments/portone/verify', {
    method: 'POST',
    body: JSON.stringify({ paymentId, orderId }),
  });
}

export function listMySubscriptions() {
  return apiRequest<{ items: AccountSubscription[] }>('/me/subscriptions');
}

export function listMyOrders() {
  return apiRequest<{ items: SubscriptionOrder[] }>('/me/orders');
}

export function listAdminPaymentReconciliation(filters: AdminPaymentReconciliationFilters = {}) {
  return apiRequest<AdminPaymentReconciliation>(
    `/admin/payments/reconciliation${buildAdminPaymentReconciliationQuery(filters)}`,
  );
}

export function downloadAdminPaymentReconciliationCsv(filters: AdminPaymentReconciliationFilters = {}) {
  const exportFilters = { ...filters };
  delete exportFilters.page;
  delete exportFilters.pageSize;
  return apiDownload(
    `/admin/payments/reconciliation.csv${buildAdminPaymentReconciliationQuery(exportFilters)}`,
  );
}

export function reconcileSubscriptionOrder(orderId: string, paymentId?: string) {
  return apiRequest<{ orderId: string; paymentId: string; action: string }>(
    `/admin/orders/${encodeURIComponent(orderId)}/reconcile`,
    { method: 'POST', body: JSON.stringify(paymentId ? { paymentId } : {}) },
  );
}

export function refundAccountSubscription(subscriptionId: string, reason: string) {
  return apiRequest<{
    subscriptionId: string;
    orderId: string;
    paymentStatus: 'refunded';
    amount: number;
    refundedAmount: number;
    refundedAt: string;
    accessRevoked: boolean;
  }>(`/admin/subscriptions/${encodeURIComponent(subscriptionId)}/refund`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}
