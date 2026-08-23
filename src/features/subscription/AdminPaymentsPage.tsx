import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { getCurrentUser } from '../auth/api';
import { ApiClientError } from '../../lib/api-client';
import {
  listAdminPaymentReconciliation,
  downloadAdminPaymentReconciliationCsv,
  reconcileSubscriptionOrder,
  refundAccountSubscription,
  type AdminPaymentReconciliationFilters,
} from './api';

const ISSUE_LABELS: Record<string, string> = {
  expired_pending_order: '결제 대기 시간이 만료됨',
  paid_order_missing_payment_id: '결제 완료 주문에 PortOne 결제번호가 없음',
  paid_order_missing_subscription: '결제 완료 주문의 구독이 누락됨',
  subscription_user_mismatch: '주문자와 구독 사용자가 다름',
  subscription_amount_mismatch: '주문 금액과 구독 금액이 다름',
  provider_payment_id_mismatch: '주문과 구독의 결제번호가 다름',
  refunded_amount_mismatch: '주문과 구독의 환불 누적액이 다름',
  canceled_order_access_not_revoked: '취소 주문의 구독 권한이 남아 있음',
  refunded_subscription_order_not_canceled: '환불 구독의 주문이 결제 완료 상태임',
  full_refund_order_not_canceled: '전액 환불 주문이 취소 상태가 아님',
  full_refund_access_not_revoked: '전액 환불 후 구독 권한이 회수되지 않음',
};

const ORDER_LABELS: Record<string, string> = {
  pending: '결제 대기', paid: '결제 완료', canceled: '취소', failed: '실패',
};

function formatKrw(value: number) {
  return `${value.toLocaleString('ko-KR')}원`;
}

function formatDate(value: string | null) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short', hourCycle: 'h23',
  }).format(new Date(value));
}

function kstDate(daysFromToday = 0) {
  const value = new Date(Date.now() + 9 * 60 * 60 * 1000);
  value.setUTCDate(value.getUTCDate() + daysFromToday);
  return value.toISOString().slice(0, 10);
}

const INITIAL_FILTERS: AdminPaymentReconciliationFilters = {
  from: kstDate(-30),
  to: kstDate(),
  status: 'all',
  reconciliation: 'all',
  search: '',
  page: 1,
  pageSize: 50,
};

export function AdminPaymentsPage() {
  const queryClient = useQueryClient();
  const [filterForm, setFilterForm] = useState(INITIAL_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState(INITIAL_FILTERS);
  const [refundTarget, setRefundTarget] = useState<string | null>(null);
  const [refundReason, setRefundReason] = useState('');
  const [refundConfirmed, setRefundConfirmed] = useState(false);
  const [manualPaymentIds, setManualPaymentIds] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState('');
  const meQuery = useQuery({ queryKey: ['current-user'], queryFn: getCurrentUser, retry: false });
  const canManage = meQuery.data?.roles.some((role) => role === 'operator' || role === 'admin') ?? false;
  const reportQuery = useQuery({
    queryKey: ['admin-payment-reconciliation', appliedFilters],
    queryFn: () => listAdminPaymentReconciliation(appliedFilters),
    enabled: canManage,
    retry: false,
  });
  const reconcileMutation = useMutation({
    mutationFn: ({ orderId, paymentId }: { orderId: string; paymentId?: string }) =>
      reconcileSubscriptionOrder(orderId, paymentId),
    onSuccess: async (result) => {
      setNotice(`${result.orderId} 주문을 PortOne 원본과 다시 동기화했습니다. (${result.action})`);
      await queryClient.invalidateQueries({ queryKey: ['admin-payment-reconciliation'] });
    },
  });
  const refundMutation = useMutation({
    mutationFn: ({ subscriptionId, reason }: { subscriptionId: string; reason: string }) =>
      refundAccountSubscription(subscriptionId, reason),
    onSuccess: async (result) => {
      setNotice(`${result.orderId} 주문을 전액 환불하고 구독 권한을 회수했습니다.`);
      setRefundTarget(null);
      setRefundReason('');
      setRefundConfirmed(false);
      await queryClient.invalidateQueries({ queryKey: ['admin-payment-reconciliation'] });
    },
  });
  const exportMutation = useMutation({
    mutationFn: () => downloadAdminPaymentReconciliationCsv(appliedFilters),
    onSuccess: ({ blob, filename }) => {
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename ?? `payment-reconciliation-${kstDate()}.csv`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setNotice('현재 조회 조건의 결제 대사 CSV를 내려받았습니다.');
    },
  });
  const items = reportQuery.data?.items ?? [];
  const errors = [meQuery.error, reportQuery.error, reconcileMutation.error, refundMutation.error, exportMutation.error];
  const error = errors.find((item): item is ApiClientError => item instanceof ApiClientError);

  return (
    <main className="catalog-page admin-payments-page">
      <header className="catalog-header">
        <Link className="back-link" to="/">← 개발 현황으로</Link>
        <p className="react-stack-eyebrow">PAYMENT RECONCILIATION</p>
        <h1>결제 대사 관리</h1>
        <p>DB 주문·구독·환불 이력을 비교하고 PortOne 결제 원본으로 상태를 다시 확인합니다.</p>
      </header>

      {meQuery.isLoading ? <p role="status">운영 권한을 확인하고 있습니다.</p> : null}
      {!meQuery.isLoading && !canManage ? (
        <section className="subscription-callout">
          <h2>운영자 권한이 필요합니다.</h2>
          <p>결제번호와 환불 작업은 운영자 또는 관리자만 확인할 수 있습니다.</p>
          <Link to="/account">계정 확인</Link>
        </section>
      ) : null}

      {canManage && reportQuery.data ? (
        <>
          <section className="payment-summary" aria-label="결제 대사 요약">
            <div><span>조회 주문</span><strong>{reportQuery.data.summary.total}건</strong></div>
            <div data-attention={reportQuery.data.summary.attention > 0}><span>확인 필요</span><strong>{reportQuery.data.summary.attention}건</strong></div>
            <div><span>승인 금액</span><strong>{formatKrw(reportQuery.data.summary.paidAmount)}</strong></div>
            <div><span>환불 금액</span><strong>{formatKrw(reportQuery.data.summary.refundedAmount)}</strong></div>
          </section>

          <section className="payment-reconciliation" aria-labelledby="payment-orders-title">
            <div className="payment-reconciliation-heading">
              <div>
                <h2 id="payment-orders-title">주문 대사 내역</h2>
                <small>{formatDate(reportQuery.data.generatedAt)} 생성 · 조건 일치 {reportQuery.data.pagination.total}건</small>
              </div>
              <div className="payment-heading-actions">
                <button type="button" onClick={() => reportQuery.refetch()} disabled={reportQuery.isFetching}>
                  {reportQuery.isFetching ? '새로고침 중…' : 'DB 내역 새로고침'}
                </button>
                <button type="button" onClick={() => exportMutation.mutate()} disabled={exportMutation.isPending}>
                  {exportMutation.isPending ? 'CSV 생성 중…' : 'CSV 내려받기'}
                </button>
              </div>
            </div>
            <form className="payment-filters" onSubmit={(event) => {
              event.preventDefault();
              setAppliedFilters({ ...filterForm, page: 1 });
            }}>
              <label>시작일
                <input type="date" required value={filterForm.from} onChange={(event) => setFilterForm({ ...filterForm, from: event.target.value })} />
              </label>
              <label>종료일
                <input type="date" required value={filterForm.to} onChange={(event) => setFilterForm({ ...filterForm, to: event.target.value })} />
              </label>
              <label>주문 상태
                <select value={filterForm.status} onChange={(event) => setFilterForm({
                  ...filterForm,
                  status: event.target.value as AdminPaymentReconciliationFilters['status'],
                })}>
                  <option value="all">전체</option>
                  <option value="pending">결제 대기</option>
                  <option value="paid">결제 완료</option>
                  <option value="canceled">취소</option>
                  <option value="failed">실패</option>
                </select>
              </label>
              <label>대사 상태
                <select value={filterForm.reconciliation} onChange={(event) => setFilterForm({
                  ...filterForm,
                  reconciliation: event.target.value as AdminPaymentReconciliationFilters['reconciliation'],
                })}>
                  <option value="all">전체</option>
                  <option value="attention">확인 필요</option>
                  <option value="matched">일치</option>
                </select>
              </label>
              <label className="payment-search-filter">주문·결제번호·사용자 검색
                <input value={filterForm.search} maxLength={100} onChange={(event) => setFilterForm({ ...filterForm, search: event.target.value })} />
              </label>
              <div className="payment-filter-actions">
                <button type="submit" disabled={reportQuery.isFetching}>조건 조회</button>
                <button type="button" onClick={() => {
                  setFilterForm(INITIAL_FILTERS);
                  setAppliedFilters(INITIAL_FILTERS);
                }}>초기화</button>
              </div>
            </form>

            {reportQuery.data.truncated ? (
              <p className="auth-error" role="alert">조회 대상이 {reportQuery.data.limit.toLocaleString('ko-KR')}건을 초과했습니다. 정확한 합계와 CSV를 위해 기간이나 조건을 좁혀 주세요.</p>
            ) : null}

            {items.length ? <div className="payment-order-list">{items.map((item) => {
              const subscription = item.subscription;
              const isRefundable = subscription?.paymentStatus === 'paid'
                && subscription.refundedAmount < subscription.amountSnapshot;
              const refundOpen = refundTarget === subscription?.id;
              return (
                <article key={item.order.id} className="payment-order-card" data-status={item.reconciliation.status}>
                  <div className="payment-order-main">
                    <div>
                      <span className="payment-reconciliation-badge">
                        {item.reconciliation.status === 'matched' ? '일치' : '확인 필요'}
                      </span>
                      <h3>{item.order.orderName}</h3>
                      <p>{item.order.user.displayName} · {item.order.user.email ?? '이메일 없음'}</p>
                    </div>
                    <div>
                      <strong>{formatKrw(item.order.amount)}</strong>
                      <span>{ORDER_LABELS[item.order.status] ?? item.order.status}</span>
                      <small>{formatDate(item.order.createdAt)}</small>
                    </div>
                  </div>
                  <dl className="payment-order-details">
                    <div><dt>주문번호</dt><dd>{item.order.id}</dd></div>
                    <div><dt>PortOne 결제번호</dt><dd>{item.order.paymentId ?? '미수집'}</dd></div>
                    <div><dt>구독</dt><dd>{subscription ? `${subscription.paymentStatus} · ${formatDate(subscription.endsAt)}까지` : '없음'}</dd></div>
                    <div><dt>누적 환불</dt><dd>{formatKrw(item.order.refundedAmount)}</dd></div>
                  </dl>
                  {item.reconciliation.issues.length ? (
                    <ul className="payment-issues">
                      {item.reconciliation.issues.map((issue) => <li key={issue}>{ISSUE_LABELS[issue] ?? issue}</li>)}
                    </ul>
                  ) : null}
                  {item.refunds.length ? (
                    <details className="payment-refunds">
                      <summary>환불 이력 {item.refunds.length}건</summary>
                      <ul>{item.refunds.map((refund) => (
                        <li key={refund.id}>
                          <span>{formatDate(refund.completedAt)} · {refund.reason}</span>
                          <strong>{formatKrw(refund.amount)}</strong>
                        </li>
                      ))}</ul>
                    </details>
                  ) : null}
                  <div className="payment-order-actions">
                    <button
                      type="button"
                      disabled={!item.reconciliation.canSync || reconcileMutation.isPending}
                      onClick={() => reconcileMutation.mutate({ orderId: item.order.id })}
                    >PortOne 재조회·동기화</button>
                    {isRefundable ? (
                      <button type="button" className="danger" onClick={() => {
                        setRefundTarget(refundOpen ? null : subscription.id);
                        setRefundReason('');
                        setRefundConfirmed(false);
                      }}>전액 환불</button>
                    ) : null}
                  </div>
                  {!item.reconciliation.canSync ? (
                    <div className="payment-manual-sync">
                      <label>PortOne 결제번호
                        <input
                          value={manualPaymentIds[item.order.id] ?? ''}
                          onChange={(event) => setManualPaymentIds({
                            ...manualPaymentIds,
                            [item.order.id]: event.target.value,
                          })}
                        />
                      </label>
                      <button
                        type="button"
                        disabled={!manualPaymentIds[item.order.id]?.trim() || reconcileMutation.isPending}
                        onClick={() => reconcileMutation.mutate({
                          orderId: item.order.id,
                          paymentId: manualPaymentIds[item.order.id]?.trim(),
                        })}
                      >입력한 결제번호로 동기화</button>
                    </div>
                  ) : null}
                  {refundOpen && subscription ? (
                    <form className="payment-refund-form" onSubmit={(event) => {
                      event.preventDefault();
                      refundMutation.mutate({ subscriptionId: subscription.id, reason: refundReason.trim() });
                    }}>
                      <strong>남은 결제금액을 전액 환불하고 구독 권한을 즉시 회수합니다.</strong>
                      <label>환불 사유
                        <textarea minLength={5} maxLength={500} required value={refundReason} onChange={(event) => setRefundReason(event.target.value)} />
                      </label>
                      <label className="payment-refund-confirm">
                        <input type="checkbox" checked={refundConfirmed} onChange={(event) => setRefundConfirmed(event.target.checked)} />
                        전액 환불과 즉시 권한 회수를 확인했습니다.
                      </label>
                      <button type="submit" className="danger" disabled={!refundConfirmed || refundReason.trim().length < 5 || refundMutation.isPending}>
                        {refundMutation.isPending ? '환불 처리 중…' : '전액 환불 확정'}
                      </button>
                    </form>
                  ) : null}
                </article>
              );
            })}</div> : <p className="payment-empty">조건에 맞는 주문이 없습니다.</p>}
            {reportQuery.data.pagination.totalPages > 1 ? (
              <nav className="payment-pagination" aria-label="결제 대사 페이지">
                <button type="button" disabled={reportQuery.data.pagination.page <= 1 || reportQuery.isFetching} onClick={() => {
                  setAppliedFilters({ ...appliedFilters, page: Math.max(1, (appliedFilters.page ?? 1) - 1) });
                }}>이전</button>
                <span>{reportQuery.data.pagination.page} / {reportQuery.data.pagination.totalPages}</span>
                <button type="button" disabled={reportQuery.data.pagination.page >= reportQuery.data.pagination.totalPages || reportQuery.isFetching} onClick={() => {
                  setAppliedFilters({ ...appliedFilters, page: (appliedFilters.page ?? 1) + 1 });
                }}>다음</button>
              </nav>
            ) : null}
          </section>
        </>
      ) : null}
      {notice ? <p className="subscription-notice" role="status">{notice}</p> : null}
      {error ? <p className="auth-error" role="alert">{error.message}{error.requestId ? ` (요청 ID: ${error.requestId})` : ''}</p> : null}
    </main>
  );
}
