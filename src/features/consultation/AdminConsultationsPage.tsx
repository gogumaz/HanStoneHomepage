import { type FormEvent, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ApiClientError } from '../../lib/api-client';
import { getCurrentUser } from '../auth/api';
import {
  getAdminConsultation,
  listAdminConsultations,
  updateAdminConsultationStatus,
  type AdminConsultationFilters,
  type ConsultationStatus,
} from './api';

const STATUS_LABELS: Record<ConsultationStatus, string> = {
  submitted: '접수',
  in_review: '검토 중',
  contacted: '연락 완료',
  closed: '종료',
};

const NEXT_STATUSES: Record<ConsultationStatus, ConsultationStatus[]> = {
  submitted: ['in_review', 'closed'],
  in_review: ['contacted', 'closed'],
  contacted: ['in_review', 'closed'],
  closed: ['in_review'],
};

const INITIAL_FILTERS: AdminConsultationFilters = {
  status: 'all', category: '', q: '', page: 1, pageSize: 20,
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short', hourCycle: 'h23',
  }).format(new Date(value));
}

export function AdminConsultationsPage() {
  const queryClient = useQueryClient();
  const [filterForm, setFilterForm] = useState(INITIAL_FILTERS);
  const [filters, setFilters] = useState(INITIAL_FILTERS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const meQuery = useQuery({ queryKey: ['current-user'], queryFn: getCurrentUser, retry: false });
  const canManage = meQuery.data?.roles.some((role) => role === 'operator' || role === 'admin') ?? false;
  const listQuery = useQuery({
    queryKey: ['admin-consultations', filters],
    queryFn: () => listAdminConsultations(filters),
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
    queryKey: ['admin-consultation', selectedId],
    queryFn: () => getAdminConsultation(selectedId!),
    enabled: canManage && Boolean(selectedId),
    retry: false,
  });
  const statusMutation = useMutation({
    mutationFn: (status: ConsultationStatus) => updateAdminConsultationStatus(selectedId!, status),
    onSuccess: async (result) => {
      setNotice(`상담 상태를 '${STATUS_LABELS[result.consultation.status]}'(으)로 변경했습니다.`);
      queryClient.setQueryData(['admin-consultation', selectedId], result);
      await queryClient.invalidateQueries({ queryKey: ['admin-consultations'] });
    },
  });
  const detail = detailQuery.data?.consultation;
  const error = [meQuery.error, listQuery.error, detailQuery.error, statusMutation.error]
    .find((item): item is ApiClientError => item instanceof ApiClientError);

  function submitFilters(event: FormEvent) {
    event.preventDefault();
    setFilters({ ...filterForm, page: 1 });
  }

  return (
    <main className="catalog-page admin-consultations-page">
      <header className="catalog-header">
        <Link className="back-link" to="/">← 개발 현황으로</Link>
        <p className="react-stack-eyebrow">CONSULTATION DESK</p>
        <h1>기관 상담 관리</h1>
        <p>비공개 상담 접수를 검색하고 담당 진행 상태를 관리합니다.</p>
      </header>

      {meQuery.isLoading ? <p role="status">운영 권한을 확인하고 있습니다.</p> : null}
      {!meQuery.isLoading && !canManage ? (
        <section className="subscription-callout">
          <h2>운영자 권한이 필요합니다.</h2>
          <p>상담 연락처와 개인정보 동의 기록은 운영자 또는 관리자만 확인할 수 있습니다.</p>
          <Link to="/account">계정 확인</Link>
        </section>
      ) : null}

      {canManage ? (
        <>
          <form className="consultation-filters" onSubmit={submitFilters}>
            <label>상태
              <select value={filterForm.status} onChange={(event) => setFilterForm({
                ...filterForm, status: event.target.value as AdminConsultationFilters['status'],
              })}>
                <option value="all">전체</option>
                {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label>기관 유형
              <select value={filterForm.category} onChange={(event) => setFilterForm({ ...filterForm, category: event.target.value })}>
                <option value="">전체</option><option>바둑학원</option><option>방과후학교</option><option>학교</option><option>기관·단체</option>
              </select>
            </label>
            <label>검색
              <input value={filterForm.q} maxLength={100} placeholder="기관명·담당자·제목·연락처" onChange={(event) => setFilterForm({ ...filterForm, q: event.target.value })} />
            </label>
            <button type="submit">조회</button>
          </form>

          {listQuery.data ? (
            <section className="consultation-summary" aria-label="상담 현황 요약">
              <div><span>전체</span><strong>{listQuery.data.summary.total}건</strong></div>
              <div><span>접수</span><strong>{listQuery.data.summary.submitted}건</strong></div>
              <div><span>검토 중</span><strong>{listQuery.data.summary.in_review}건</strong></div>
              <div><span>연락 완료</span><strong>{listQuery.data.summary.contacted}건</strong></div>
            </section>
          ) : null}

          {listQuery.isLoading ? <p role="status">상담 내역을 불러오고 있습니다.</p> : null}
          {error ? <p className="form-error" role="alert">{error.message}</p> : null}
          {notice ? <p className="form-success" role="status">{notice}</p> : null}

          <div className="consultation-admin-layout">
            <section className="consultation-list" aria-labelledby="consultation-list-title">
              <h2 id="consultation-list-title">상담 접수 목록</h2>
              {listQuery.data?.items.length === 0 ? <p>조건에 맞는 상담이 없습니다.</p> : null}
              {listQuery.data?.items.map((item) => (
                <button key={item.id} type="button" aria-pressed={selectedId === item.id} onClick={() => setSelectedId(item.id)}>
                  <span data-status={item.status}>{STATUS_LABELS[item.status]}</span>
                  <strong>{item.organizationName}</strong>
                  <small>{item.category} · {item.contactName} · {formatDate(item.createdAt)}</small>
                  <em>{item.title}</em>
                </button>
              ))}
              {listQuery.data && listQuery.data.pagination.totalPages > 1 ? (
                <nav className="consultation-pagination" aria-label="상담 목록 페이지">
                  <button type="button" disabled={filters.page <= 1} onClick={() => setFilters({ ...filters, page: filters.page - 1 })}>이전</button>
                  <span>{filters.page} / {listQuery.data.pagination.totalPages}</span>
                  <button type="button" disabled={filters.page >= listQuery.data.pagination.totalPages} onClick={() => setFilters({ ...filters, page: filters.page + 1 })}>다음</button>
                </nav>
              ) : null}
            </section>

            <section className="consultation-detail" aria-labelledby="consultation-detail-title">
              <h2 id="consultation-detail-title">상담 상세</h2>
              {detailQuery.isLoading ? <p role="status">상세 내역을 불러오고 있습니다.</p> : null}
              {detail ? (
                <>
                  <div className="consultation-detail-heading"><span data-status={detail.status}>{STATUS_LABELS[detail.status]}</span><h3>{detail.title}</h3></div>
                  <dl>
                    <div><dt>기관</dt><dd>{detail.organizationName} · {detail.category}</dd></div>
                    <div><dt>담당자</dt><dd>{detail.contactName}</dd></div>
                    <div><dt>연락처</dt><dd><a href={`tel:${detail.phone}`}>{detail.phone}</a></dd></div>
                    <div><dt>이메일</dt><dd>{detail.email ? <a href={`mailto:${detail.email}`}>{detail.email}</a> : '-'}</dd></div>
                    <div><dt>예상 인원</dt><dd>{detail.expectedStudents.toLocaleString('ko-KR')}명</dd></div>
                    <div><dt>접수 시각</dt><dd>{formatDate(detail.createdAt)}</dd></div>
                    <div><dt>개인정보 동의</dt><dd>{detail.privacyConsentVersion} · {formatDate(detail.privacyConsentedAt)}</dd></div>
                  </dl>
                  <p className="consultation-content">{detail.content}</p>
                  <div className="consultation-status-actions" aria-label="상담 상태 변경">
                    {NEXT_STATUSES[detail.status].map((status) => (
                      <button key={status} type="button" disabled={statusMutation.isPending} onClick={() => statusMutation.mutate(status)}>
                        {STATUS_LABELS[status]} 전환
                      </button>
                    ))}
                  </div>
                </>
              ) : !selectedId ? <p>목록에서 상담을 선택해 주세요.</p> : null}
            </section>
          </div>
        </>
      ) : null}
    </main>
  );
}
