import { type FormEvent, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ApiClientError } from '../../lib/api-client';
import { getCurrentUser } from '../auth/api';
import {
  answerAdminInquiry,
  adminInquiryAttachmentUrl,
  getAdminInquiry,
  listAdminInquiries,
  listAdminInquiryNotificationJobs,
  retryAdminInquiryNotificationJob,
  updateAdminInquiryStatus,
  type AdminInquiryFilters,
  type InquiryNotificationJobStatus,
  type InquiryStatus,
} from './api';

const STATUS_LABELS: Record<InquiryStatus, string> = {
  submitted: '접수',
  in_review: '검토 중',
  answered: '답변 완료',
  closed: '종료',
};

const NEXT_STATUSES: Record<InquiryStatus, InquiryStatus[]> = {
  submitted: ['in_review', 'closed'],
  in_review: ['closed'],
  answered: ['in_review', 'closed'],
  closed: ['in_review'],
};

const NOTIFICATION_STATUS_LABELS: Record<InquiryNotificationJobStatus, string> = {
  pending: '발송 대기',
  sending: '발송 중',
  sent: '발송 완료',
  skipped: '발송 제외',
  error: '발송 실패',
};

const INITIAL_FILTERS: AdminInquiryFilters = {
  status: 'all', category: '', q: '', page: 1, pageSize: 20,
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short', hourCycle: 'h23',
  }).format(new Date(value));
}

export function AdminInquiriesPage() {
  const queryClient = useQueryClient();
  const [filterForm, setFilterForm] = useState(INITIAL_FILTERS);
  const [filters, setFilters] = useState(INITIAL_FILTERS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [answer, setAnswer] = useState('');
  const [notice, setNotice] = useState('');
  const meQuery = useQuery({ queryKey: ['current-user'], queryFn: getCurrentUser, retry: false });
  const canManage = meQuery.data?.roles.some((role) => role === 'operator' || role === 'admin') ?? false;
  const listQuery = useQuery({
    queryKey: ['admin-inquiries', filters],
    queryFn: () => listAdminInquiries(filters),
    enabled: canManage,
    retry: false,
  });

  useEffect(() => {
    if (!selectedId && listQuery.data?.items[0]) setSelectedId(listQuery.data.items[0].id);
    if (selectedId && listQuery.data && !listQuery.data.items.some((item) => item.id === selectedId)) {
      setSelectedId(listQuery.data.items[0]?.id ?? null);
    }
  }, [listQuery.data, selectedId]);

  const detailQuery = useQuery({
    queryKey: ['admin-inquiry', selectedId],
    queryFn: () => getAdminInquiry(selectedId!),
    enabled: canManage && Boolean(selectedId),
    retry: false,
  });
  const notificationJobsQuery = useQuery({
    queryKey: ['admin-inquiry-notification-jobs', selectedId],
    queryFn: () => listAdminInquiryNotificationJobs(selectedId!),
    enabled: canManage && Boolean(selectedId),
    retry: false,
  });

  const detail = detailQuery.data?.inquiry;
  useEffect(() => {
    setAnswer(detail?.answer ?? '');
  }, [detail?.id, detail?.answer]);

  const answerMutation = useMutation({
    mutationFn: ({ inquiryId, value }: { inquiryId: string; value: string }) => answerAdminInquiry(inquiryId, value),
    onSuccess: async (result, variables) => {
      setNotice('문의 답변을 저장했습니다. 이메일 알림은 별도로 처리됩니다.');
      queryClient.setQueryData(['admin-inquiry', variables.inquiryId], result);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin-inquiries'] }),
        queryClient.invalidateQueries({ queryKey: ['admin-inquiry-notification-jobs', variables.inquiryId] }),
      ]);
    },
  });
  const statusMutation = useMutation({
    mutationFn: ({ inquiryId, status }: { inquiryId: string; status: InquiryStatus }) => updateAdminInquiryStatus(inquiryId, status),
    onSuccess: async (result, variables) => {
      setNotice(`문의 상태를 '${STATUS_LABELS[result.inquiry.status]}'(으)로 변경했습니다.`);
      queryClient.setQueryData(['admin-inquiry', variables.inquiryId], result);
      await queryClient.invalidateQueries({ queryKey: ['admin-inquiries'] });
    },
  });
  const retryNotificationMutation = useMutation({
    mutationFn: retryAdminInquiryNotificationJob,
    onSuccess: async (result) => {
      setNotice('답변 이메일 발송을 다시 요청했습니다.');
      await queryClient.invalidateQueries({ queryKey: ['admin-inquiry-notification-jobs', result.job.inquiryId] });
    },
  });
  const error = [
    meQuery.error,
    listQuery.error,
    detailQuery.error,
    notificationJobsQuery.error,
    answerMutation.error,
    statusMutation.error,
    retryNotificationMutation.error,
  ]
    .find((item): item is ApiClientError => item instanceof ApiClientError);

  function submitFilters(event: FormEvent) {
    event.preventDefault();
    setFilters({ ...filterForm, page: 1 });
  }

  function submitAnswer(event: FormEvent) {
    event.preventDefault();
    if (!detail || detail.status === 'closed' || answer.trim().length < 2) return;
    setNotice('');
    answerMutation.mutate({ inquiryId: detail.id, value: answer.trim() });
  }

  function changeStatus(status: InquiryStatus) {
    if (!detail) return;
    if (detail.status === 'answered' && status === 'in_review'
      && !window.confirm('재검토로 전환하면 기존 답변이 삭제됩니다. 계속하시겠습니까?')) return;
    setNotice('');
    statusMutation.mutate({ inquiryId: detail.id, status });
  }

  return (
    <main className="catalog-page admin-consultations-page admin-inquiries-page">
      <header className="catalog-header">
        <Link className="back-link" to="/">← 개발 현황으로</Link>
        <p className="react-stack-eyebrow">PRIVATE INQUIRY DESK</p>
        <h1>1:1 문의 관리</h1>
        <p>회원의 비공개 문의를 검색하고 답변과 처리 상태를 관리합니다.</p>
      </header>

      {meQuery.isLoading ? <p role="status">운영 권한을 확인하고 있습니다.</p> : null}
      {!meQuery.isLoading && !canManage ? (
        <section className="subscription-callout">
          <h2>운영자 권한이 필요합니다.</h2>
          <p>회원의 비공개 문의와 답변은 운영자 또는 관리자만 확인할 수 있습니다.</p>
          <Link to="/account">계정 확인</Link>
        </section>
      ) : null}

      {canManage ? (
        <>
          <form className="consultation-filters" onSubmit={submitFilters}>
            <label>상태
              <select value={filterForm.status} onChange={(event) => setFilterForm({
                ...filterForm, status: event.target.value as AdminInquiryFilters['status'],
              })}>
                <option value="all">전체</option>
                {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label>문의 유형
              <select value={filterForm.category} onChange={(event) => setFilterForm({ ...filterForm, category: event.target.value })}>
                <option value="">전체</option><option>회원</option><option>학습</option><option>교재</option><option>결제</option><option>기타</option>
              </select>
            </label>
            <label>검색
              <input value={filterForm.q} maxLength={100} placeholder="제목·문의 내용" onChange={(event) => setFilterForm({ ...filterForm, q: event.target.value })} />
            </label>
            <button type="submit">조회</button>
          </form>

          {listQuery.data ? (
            <section className="consultation-summary inquiry-summary" aria-label="문의 현황 요약">
              <div><span>검색 결과</span><strong>{listQuery.data.pagination.total}건</strong></div>
              <div><span>현재 페이지</span><strong>{listQuery.data.pagination.page} / {listQuery.data.pagination.totalPages}</strong></div>
            </section>
          ) : null}
          {listQuery.isLoading ? <p role="status">문의 내역을 불러오고 있습니다.</p> : null}
          {error ? <p className="form-error" role="alert">{error.message}</p> : null}
          {notice ? <p className="form-success" role="status">{notice}</p> : null}

          <div className="consultation-admin-layout">
            <section className="consultation-list" aria-labelledby="inquiry-list-title">
              <h2 id="inquiry-list-title">문의 접수 목록</h2>
              {listQuery.data?.items.length === 0 ? <p>조건에 맞는 문의가 없습니다.</p> : null}
              {listQuery.data?.items.map((item) => (
                <button key={item.id} type="button" aria-pressed={selectedId === item.id} onClick={() => { setSelectedId(item.id); setNotice(''); }}>
                  <span data-status={item.status}>{STATUS_LABELS[item.status]}</span>
                  <strong>{item.title}</strong>
                  <small>{item.category} · {formatDate(item.createdAt)}</small>
                  <em>{item.content}</em>
                </button>
              ))}
              {listQuery.data && listQuery.data.pagination.totalPages > 1 ? (
                <nav className="consultation-pagination" aria-label="문의 목록 페이지">
                  <button type="button" disabled={filters.page <= 1} onClick={() => setFilters({ ...filters, page: filters.page - 1 })}>이전</button>
                  <span>{filters.page} / {listQuery.data.pagination.totalPages}</span>
                  <button type="button" disabled={filters.page >= listQuery.data.pagination.totalPages} onClick={() => setFilters({ ...filters, page: filters.page + 1 })}>다음</button>
                </nav>
              ) : null}
            </section>

            <section className="consultation-detail" aria-labelledby="inquiry-detail-title">
              <h2 id="inquiry-detail-title">문의 상세</h2>
              {detailQuery.isLoading ? <p role="status">상세 내역을 불러오고 있습니다.</p> : null}
              {detail ? (
                <>
                  <div className="consultation-detail-heading"><span data-status={detail.status}>{STATUS_LABELS[detail.status]}</span><h3>{detail.title}</h3></div>
                  <dl>
                    <div><dt>문의 유형</dt><dd>{detail.category}</dd></div>
                    <div><dt>접수 시각</dt><dd>{formatDate(detail.createdAt)}</dd></div>
                    <div><dt>답변 시각</dt><dd>{detail.answeredAt ? formatDate(detail.answeredAt) : '-'}</dd></div>
                  </dl>
                  <p className="consultation-content">{detail.content}</p>
                  {detail.attachment ? (
                    <p className="inquiry-attachment">
                      <strong>첨부파일</strong>{' '}
                      <a href={adminInquiryAttachmentUrl(detail.id)}>{detail.attachment.originalName}</a>
                      <span>{Math.ceil(detail.attachment.size / 1024).toLocaleString('ko-KR')}KB</span>
                    </p>
                  ) : null}
                  <form className="inquiry-answer-form" onSubmit={submitAnswer}>
                    <label htmlFor="inquiry-answer">운영자 답변</label>
                    <textarea id="inquiry-answer" required minLength={2} maxLength={4000} disabled={detail.status === 'closed'} value={answer} onChange={(event) => setAnswer(event.target.value)} />
                    <button type="submit" disabled={detail.status === 'closed' || answerMutation.isPending || answer.trim().length < 2}>
                      {detail.status === 'closed' ? '재검토 후 답변 가능' : answerMutation.isPending ? '저장 중…' : detail.answer ? '답변 수정' : '답변 등록'}
                    </button>
                  </form>
                  <section className="inquiry-notification-jobs" aria-labelledby="inquiry-notification-jobs-title">
                    <h4 id="inquiry-notification-jobs-title">답변 이메일 발송</h4>
                    {notificationJobsQuery.isLoading ? <p role="status">발송 상태를 확인하고 있습니다.</p> : null}
                    {notificationJobsQuery.data?.items.length === 0 ? <p>아직 이메일 발송 작업이 없습니다.</p> : null}
                    <ul>
                      {notificationJobsQuery.data?.items.map((job) => (
                        <li key={job.id}>
                          <div>
                            <strong>답변 {job.answerVersion}차</strong>
                            <span data-status={job.status}>{NOTIFICATION_STATUS_LABELS[job.status]}</span>
                          </div>
                          <small>
                            시도 {job.attempts}회 · {job.manualRetryAvailable
                              ? `최종 실패 ${formatDate(job.updatedAt)}`
                              : job.completedAt
                                ? `처리 ${formatDate(job.completedAt)}`
                                : `다음 실행 ${formatDate(job.nextAttemptAt)}`}
                          </small>
                          {job.lastError ? <code>{job.lastError}</code> : null}
                          {job.manualRetryAvailable ? (
                            <button
                              type="button"
                              disabled={retryNotificationMutation.isPending}
                              onClick={() => { setNotice(''); retryNotificationMutation.mutate(job.id); }}
                            >
                              {retryNotificationMutation.isPending && retryNotificationMutation.variables === job.id
                                ? '재시도 요청 중…'
                                : '이메일 재시도'}
                            </button>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </section>
                  <div className="consultation-status-actions" aria-label="문의 상태 변경">
                    {NEXT_STATUSES[detail.status].map((status) => (
                      <button key={status} type="button" disabled={statusMutation.isPending} onClick={() => changeStatus(status)}>
                        {STATUS_LABELS[status]} 전환
                      </button>
                    ))}
                  </div>
                  {detail.status === 'answered' ? <p className="inquiry-workflow-note">재검토로 전환하면 기존 답변이 삭제됩니다.</p> : null}
                  {detail.status === 'closed' ? <p className="inquiry-workflow-note">답변을 변경하려면 문의를 재검토로 전환해 주세요.</p> : null}
                </>
              ) : !selectedId ? <p>목록에서 문의를 선택해 주세요.</p> : null}
            </section>
          </div>
        </>
      ) : null}
    </main>
  );
}
