import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { getCurrentUser } from '../auth/api';
import { ApiClientError } from '../../lib/api-client';
import {
  clearTossConfirmationId,
  resolveTossBrowserConfig,
  stableTossConfirmationId,
  tossPaymentReadyMessage,
  type TossBrowserConfig,
} from '../../payments/toss-browser';
import { loadTossPaymentsSdk } from '../../payments/load-toss-sdk';
import {
  createSubscriptionCheckout,
  listMyOrders,
  listMySubscriptions,
  listSubscriptionPlans,
  confirmTossSubscriptionPayment,
  type Checkout,
} from './api';

function formatKrw(value: number) {
  return `${value.toLocaleString('ko-KR')}원`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short', hourCycle: 'h23',
  }).format(new Date(value));
}

function isPayablePendingOrder(item: { status: string; expiresAt: string }) {
  return item.status === 'pending' && new Date(item.expiresAt).getTime() > Date.now();
}

function orderStatusLabel(item: { status: string; expiresAt: string }) {
  if (item.status === 'pending' && !isPayablePendingOrder(item)) return '결제 기한 만료';
  return ({ pending: '결제 대기', paid: '결제 완료', canceled: '취소', failed: '실패' } as Record<string, string>)[item.status] ?? item.status;
}

function subscriptionStatusLabel(item: {
  active: boolean;
  paymentStatus: string;
  refundedAmount: number;
  amountSnapshot: number;
}) {
  if (item.paymentStatus === 'refunded') return '전액 환불';
  if (item.paymentStatus === 'canceled') return '취소';
  if (item.refundedAmount > 0 && item.refundedAmount < item.amountSnapshot) {
    return `부분 환불 ${formatKrw(item.refundedAmount)}`;
  }
  return item.active ? '이용 중' : '종료';
}

export function SubscriptionsPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirectHandled = useRef(false);
  const tossWidgets = useRef<TossPaymentWidgets | null>(null);
  const tossConfig = useRef<TossBrowserConfig | null>(null);
  const [pendingCheckout, setPendingCheckout] = useState<Checkout | null>(null);
  const [widgetReady, setWidgetReady] = useState(false);
  const [notice, setNotice] = useState('');
  const userQuery = useQuery({ queryKey: ['current-user'], queryFn: getCurrentUser, retry: false });
  const plansQuery = useQuery({ queryKey: ['subscription-plans'], queryFn: listSubscriptionPlans, retry: false });
  const enabled = Boolean(userQuery.data);
  const subscriptionsQuery = useQuery({
    queryKey: ['my-subscriptions'], queryFn: ({ signal }) => listMySubscriptions(signal), enabled, retry: false,
  });
  const ordersQuery = useQuery({
    queryKey: ['my-orders'], queryFn: ({ signal }) => listMyOrders(signal), enabled, retry: false,
  });

  const verifyMutation = useMutation({
    mutationFn: ({ paymentId, orderId, amount, confirmationId }: {
      paymentId: string; orderId: string; amount: number; confirmationId: string;
    }) => confirmTossSubscriptionPayment(paymentId, orderId, amount, confirmationId),
    onSuccess: async (result, variables) => {
      clearTossConfirmationId(variables.orderId);
      setNotice(`${formatDate(result.subscription.endsAt)}까지 구독을 이용할 수 있습니다.`);
      await Promise.all([
        queryClient.cancelQueries({ queryKey: ['my-subscriptions'] }),
        queryClient.cancelQueries({ queryKey: ['my-orders'] }),
      ]);
      navigate('/subscriptions', { replace: true });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['my-subscriptions'] }),
        queryClient.invalidateQueries({ queryKey: ['my-orders'] }),
        queryClient.invalidateQueries({ queryKey: ['lesson-progress'] }),
      ]);
    },
  });

  const checkoutMutation = useMutation({
    mutationFn: createSubscriptionCheckout,
    onSuccess: (checkout) => requestPayment(checkout),
  });

  function beginCheckout(planId: string) {
    checkoutMutation.reset();
    let config;
    try {
      config = resolveTossBrowserConfig(window.APP_CONFIG?.tossPayments);
    } catch {
      setNotice('토스페이먼츠 테스트·라이브 클라이언트 키와 결제 모드가 일치하지 않습니다. 새 주문은 생성되지 않았습니다.');
      return;
    }
    if (!config) {
      setNotice('결제 기능을 준비하고 있습니다. 토스페이먼츠 브라우저 키를 설정한 뒤 다시 시도해 주세요. 새 주문은 생성되지 않았습니다.');
      return;
    }
    setNotice('결제 정보를 준비하고 있습니다.');
    checkoutMutation.mutate(planId);
  }

  useEffect(() => {
    const widgets = tossWidgets.current;
    const config = tossConfig.current;
    if (!pendingCheckout || !widgets || !config) return;

    let current = true;
    void Promise.all([
      widgets.renderPaymentMethods({
        selector: '#subscription-payment-method',
        variantKey: config.paymentMethodVariantKey,
      }),
      widgets.renderAgreement({
        selector: '#subscription-agreement',
        variantKey: config.agreementVariantKey,
      }),
    ]).then(() => {
      if (!current) return;
      setWidgetReady(true);
      setNotice(tossPaymentReadyMessage(config.mode));
    }).catch(() => {
      if (!current) return;
      tossWidgets.current = null;
      setWidgetReady(false);
      setNotice('결제위젯을 표시하지 못했습니다. 연결 상태를 확인하고 다시 시도해 주세요.');
    });

    return () => {
      current = false;
    };
  }, [pendingCheckout]);

  async function requestPayment(checkout: Checkout) {
    setWidgetReady(false);
    setPendingCheckout(null);
    tossWidgets.current = null;
    tossConfig.current = null;
    let config;
    try {
      config = resolveTossBrowserConfig(window.APP_CONFIG?.tossPayments);
    } catch {
      setNotice('토스페이먼츠 테스트·라이브 클라이언트 키와 결제 모드가 일치하지 않습니다.');
      return;
    }
    if (!config) {
      setNotice('토스페이먼츠 브라우저 설정이 필요합니다. 설정 후 주문 내역의 결제 계속하기를 눌러 주세요.');
      void queryClient.invalidateQueries({ queryKey: ['my-orders'] });
      return;
    }
    let tossPaymentsFactory;
    try {
      tossPaymentsFactory = await loadTossPaymentsSdk();
    } catch {
      setNotice('결제 모듈을 불러오지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.');
      void queryClient.invalidateQueries({ queryKey: ['my-orders'] });
      return;
    }
    try {
      const toss = tossPaymentsFactory(config.clientKey);
      const widgets = toss.widgets({ customerKey: checkout.customerKey || tossPaymentsFactory.ANONYMOUS || 'ANONYMOUS' });
      await widgets.setAmount({ currency: 'KRW', value: checkout.amount });
      tossWidgets.current = widgets;
      tossConfig.current = config;
      setPendingCheckout(checkout);
    } catch {
      setNotice('결제위젯을 준비하지 못했습니다. 잠시 후 주문 내역의 결제 계속하기를 다시 눌러 주세요.');
      void queryClient.invalidateQueries({ queryKey: ['my-orders'] });
    }
  }

  async function openTossPayment() {
    if (!pendingCheckout || !tossWidgets.current || !widgetReady) return;
    try {
      await tossWidgets.current.requestPayment({
        orderId: pendingCheckout.orderId,
        orderName: pendingCheckout.orderName,
        successUrl: `${window.location.origin}/subscriptions`,
        failUrl: `${window.location.origin}/subscriptions?paymentFailed=true`,
        customerEmail: pendingCheckout.customerEmail ?? undefined,
        customerName: pendingCheckout.customerName,
      });
    } catch {
      setNotice('결제창을 열지 못했습니다. 잠시 후 다시 시도해 주세요. 주문은 결제 대기 상태로 보관됩니다.');
    }
  }

  useEffect(() => {
    if (redirectHandled.current || !userQuery.data) return;
    const paymentId = searchParams.get('paymentKey');
    const orderId = searchParams.get('orderId');
    const amount = Number(searchParams.get('amount'));
    if (!paymentId || !orderId || !Number.isInteger(amount) || amount < 1) return;
    redirectHandled.current = true;
    verifyMutation.mutate({ paymentId, orderId, amount, confirmationId: stableTossConfirmationId(orderId) });
  }, [searchParams, userQuery.data, verifyMutation]);

  const activeSubscription = subscriptionsQuery.data?.items.find((item) => item.active);
  const currentPendingOrder = ordersQuery.data?.items.find(isPayablePendingOrder);
  const error = checkoutMutation.error instanceof ApiClientError
    ? checkoutMutation.error
    : verifyMutation.error instanceof ApiClientError
      ? verifyMutation.error
      : null;

  return (
    <main className="subscription-page">
      <header className="catalog-header">
        <Link className="back-link" to="/lessons">← 강의 여행으로</Link>
        <p className="react-stack-eyebrow">ACCOUNT SUBSCRIPTION</p>
        <h1>계정 구독</h1>
        <p>구독 기간에는 추가 결제 없이 공개 강의를 이용할 수 있습니다.</p>
        {userQuery.data?.roles.some((role) => role === 'operator' || role === 'admin') ? (
          <Link className="catalog-subscription-link" to="/admin/payments">결제 대사 관리 →</Link>
        ) : null}
      </header>

      {userQuery.isLoading ? <p role="status">계정 정보를 확인하고 있습니다.</p> : null}
      {!userQuery.isLoading && !userQuery.data ? (
        <section className="subscription-callout">
          <h2>로그인이 필요합니다.</h2>
          <p>계정 로그인 후 구독 주문과 결제 내역을 안전하게 관리할 수 있습니다.</p>
          <Link to="/account">로그인하기</Link>
        </section>
      ) : null}

      {userQuery.data ? (
        <>
          <section className={`subscription-callout ${activeSubscription ? 'active' : ''}`} aria-live="polite">
            <h2>{activeSubscription ? `${activeSubscription.planLabelSnapshot} 이용 중` : '이용 중인 구독이 없습니다.'}</h2>
            <p>{activeSubscription
              ? `${formatDate(activeSubscription.endsAt)}에 종료됩니다.`
              : '원하는 기간을 선택하면 결제 검증 후 즉시 이용할 수 있습니다.'}</p>
          </section>

          {pendingCheckout ? (
            <section className="subscription-payment-widget" aria-label="토스페이먼츠 결제" aria-busy={!widgetReady}>
              <div id="subscription-payment-method" aria-label="결제수단 선택" />
              <div id="subscription-agreement" aria-label="결제 약관" />
              <button type="button" disabled={!widgetReady} onClick={() => void openTossPayment()}>
                {widgetReady ? `토스로 ${formatKrw(pendingCheckout.amount)} 결제` : '결제위젯 준비 중…'}
              </button>
            </section>
          ) : null}

          <section className="subscription-plans" aria-labelledby="plan-title">
            <h2 id="plan-title">구독 플랜</h2>
            <div className="subscription-plan-grid-react">
              {plansQuery.data?.items.map((plan) => {
                const continuesPendingOrder = currentPendingOrder?.planId === plan.id;
                const blockedByAnotherOrder = Boolean(currentPendingOrder) && !continuesPendingOrder;
                return (
                  <article key={plan.id} className={plan.recommended ? 'recommended' : ''}>
                    {plan.recommended ? <span>추천</span> : null}
                    <h3>{plan.label}</h3>
                    <strong>{formatKrw(plan.price)}</strong>
                    <button
                      type="button"
                      disabled={Boolean(activeSubscription) || blockedByAnotherOrder || checkoutMutation.isPending || verifyMutation.isPending}
                      onClick={() => beginCheckout(plan.id)}
                    >
                      {activeSubscription
                        ? '현재 구독 이용 중'
                        : continuesPendingOrder
                          ? '결제 계속하기'
                          : blockedByAnotherOrder
                            ? '진행 중 주문 있음'
                            : '결제하기'}
                    </button>
                  </article>
                );
              })}
            </div>
          </section>

          {notice ? <p className="subscription-notice" role="status">{notice}</p> : null}
          {verifyMutation.isPending ? <p role="status">결제 내역을 서버에서 검증하고 있습니다.</p> : null}
          {error ? <p className="auth-error" role="alert">{error.message}{error.requestId ? ` (요청 ID: ${error.requestId})` : ''}</p> : null}

          <section className="subscription-history" aria-labelledby="subscription-history-title">
            <h2 id="subscription-history-title">구독 내역</h2>
            {subscriptionsQuery.data?.items.length ? (
              <ul>{subscriptionsQuery.data.items.map((item) => (
                <li key={item.id}>
                  <div><strong>{item.planLabelSnapshot}</strong><small>{formatDate(item.startsAt)} 시작 · {formatDate(item.endsAt)} 종료</small></div>
                  <div>
                    <b>{formatKrw(item.amountSnapshot)}</b>
                    <span>{subscriptionStatusLabel(item)}</span>
                    {item.refundedAt ? <small>{formatDate(item.refundedAt)}</small> : null}
                  </div>
                </li>
              ))}</ul>
            ) : <p>아직 구독 내역이 없습니다.</p>}
          </section>

          <section className="subscription-history" aria-labelledby="order-history-title">
            <h2 id="order-history-title">주문 내역</h2>
            {ordersQuery.data?.items.length ? (
              <ul>{ordersQuery.data.items.map((item) => {
                const canContinue = isPayablePendingOrder(item);
                return (
                  <li key={item.id}>
                    <div><strong>{item.orderName}</strong><small>{item.id} · {formatDate(item.createdAt)}</small></div>
                    <div>
                      <b>{formatKrw(item.amount)}</b>
                      <span>{orderStatusLabel(item)}</span>
                      {canContinue ? (
                        <button
                          className="subscription-resume-button"
                          type="button"
                          disabled={checkoutMutation.isPending || verifyMutation.isPending}
                          onClick={() => beginCheckout(item.planId)}
                        >
                          결제 계속하기
                        </button>
                      ) : null}
                      {item.refundedAmount > 0 ? <small>환불 {formatKrw(item.refundedAmount)}</small> : null}
                    </div>
                  </li>
                );
              })}</ul>
            ) : <p>아직 주문 내역이 없습니다.</p>}
          </section>
        </>
      ) : null}
    </main>
  );
}
