import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { getCurrentUser } from '../auth/api';
import { ApiClientError } from '../../lib/api-client';
import {
  createSubscriptionCheckout,
  listMyOrders,
  listMySubscriptions,
  listSubscriptionPlans,
  verifyPortOnePayment,
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

function statusLabel(status: string) {
  return ({ pending: '결제 대기', paid: '결제 완료', canceled: '취소', failed: '실패' } as Record<string, string>)[status] ?? status;
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
  const [notice, setNotice] = useState('');
  const userQuery = useQuery({ queryKey: ['current-user'], queryFn: getCurrentUser, retry: false });
  const plansQuery = useQuery({ queryKey: ['subscription-plans'], queryFn: listSubscriptionPlans, retry: false });
  const enabled = Boolean(userQuery.data);
  const subscriptionsQuery = useQuery({
    queryKey: ['my-subscriptions'], queryFn: listMySubscriptions, enabled, retry: false,
  });
  const ordersQuery = useQuery({
    queryKey: ['my-orders'], queryFn: listMyOrders, enabled, retry: false,
  });

  const verifyMutation = useMutation({
    mutationFn: ({ paymentId, orderId }: { paymentId: string; orderId: string }) =>
      verifyPortOnePayment(paymentId, orderId),
    onSuccess: async (result) => {
      setNotice(`${formatDate(result.subscription.endsAt)}까지 구독을 이용할 수 있습니다.`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['my-subscriptions'] }),
        queryClient.invalidateQueries({ queryKey: ['my-orders'] }),
        queryClient.invalidateQueries({ queryKey: ['lesson-progress'] }),
      ]);
      navigate('/subscriptions', { replace: true });
    },
  });

  const checkoutMutation = useMutation({
    mutationFn: createSubscriptionCheckout,
    onSuccess: (checkout) => requestPayment(checkout),
  });

  function requestPayment(checkout: Checkout) {
    const config = window.APP_CONFIG?.portoneV1;
    const portOne = window.IMP;
    if (!config?.userCode || !config.channelKey || !portOne) {
      setNotice('PortOne 브라우저 설정이 필요합니다. 생성된 주문은 주문 내역에서 확인할 수 있습니다.');
      void queryClient.invalidateQueries({ queryKey: ['my-orders'] });
      return;
    }
    portOne.init(config.userCode);
    portOne.request_pay({
      channelKey: config.channelKey,
      pg: config.pgProvider && config.mid ? `${config.pgProvider}.${config.mid}` : undefined,
      pay_method: 'card',
      merchant_uid: checkout.orderId,
      name: checkout.orderName,
      amount: checkout.amount,
      buyer_email: checkout.customerEmail ?? undefined,
      buyer_name: checkout.customerName,
      m_redirect_url: `${window.location.origin}/subscriptions`,
    }, (response) => {
      const paymentId = response.imp_uid;
      const orderId = response.merchant_uid;
      if (paymentId && orderId) {
        verifyMutation.mutate({ paymentId, orderId });
      } else {
        setNotice(response.error_msg || '결제가 완료되지 않았습니다.');
      }
    });
  }

  useEffect(() => {
    if (redirectHandled.current || !userQuery.data) return;
    const paymentId = searchParams.get('imp_uid');
    const orderId = searchParams.get('merchant_uid');
    if (!paymentId || !orderId) return;
    redirectHandled.current = true;
    verifyMutation.mutate({ paymentId, orderId });
  }, [searchParams, userQuery.data, verifyMutation]);

  const activeSubscription = subscriptionsQuery.data?.items.find((item) => item.active);
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

          <section className="subscription-plans" aria-labelledby="plan-title">
            <h2 id="plan-title">구독 플랜</h2>
            <div className="subscription-plan-grid-react">
              {plansQuery.data?.items.map((plan) => (
                <article key={plan.id} className={plan.recommended ? 'recommended' : ''}>
                  {plan.recommended ? <span>추천</span> : null}
                  <h3>{plan.label}</h3>
                  <strong>{formatKrw(plan.price)}</strong>
                  <button
                    type="button"
                    disabled={Boolean(activeSubscription) || checkoutMutation.isPending || verifyMutation.isPending}
                    onClick={() => checkoutMutation.mutate(plan.id)}
                  >
                    {activeSubscription ? '현재 구독 이용 중' : '결제하기'}
                  </button>
                </article>
              ))}
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
              <ul>{ordersQuery.data.items.map((item) => (
                <li key={item.id}>
                  <div><strong>{item.orderName}</strong><small>{item.id} · {formatDate(item.createdAt)}</small></div>
                  <div>
                    <b>{formatKrw(item.amount)}</b>
                    <span>{statusLabel(item.status)}</span>
                    {item.refundedAmount > 0 ? <small>환불 {formatKrw(item.refundedAmount)}</small> : null}
                  </div>
                </li>
              ))}</ul>
            ) : <p>아직 주문 내역이 없습니다.</p>}
          </section>
        </>
      ) : null}
    </main>
  );
}
