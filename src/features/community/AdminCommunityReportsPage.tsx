import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiClientError } from '../../lib/api-client';
import { getCurrentUser } from '../auth/api';
import {
  listCommunityReports,
  resolveCommunityReport,
  type CommunityReportFilters,
  type CommunityReportReason,
} from './api';

const REASON_LABELS: Record<CommunityReportReason, string> = {
  spam: '광고·도배',
  personal_info: '개인정보 노출',
  harassment: '욕설·괴롭힘',
  illegal: '불법정보',
  copyright: '저작권 침해',
  other: '기타',
};

const INITIAL_FILTERS: CommunityReportFilters = { status: 'open', type: 'all', page: 1, pageSize: 20 };

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short', hourCycle: 'h23',
  }).format(new Date(value));
}

export function AdminCommunityReportsPage() {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState(INITIAL_FILTERS);
  const [notice, setNotice] = useState('');
  const meQuery = useQuery({ queryKey: ['current-user'], queryFn: getCurrentUser, retry: false });
  const canManage = meQuery.data?.roles.some((role) => role === 'operator' || role === 'admin') ?? false;
  const reportsQuery = useQuery({
    queryKey: ['admin-community-reports', filters],
    queryFn: () => listCommunityReports(filters),
    enabled: canManage,
    retry: false,
  });
  const resolveMutation = useMutation({
    mutationFn: ({ reportId, action }: { reportId: string; action: 'hide' | 'dismiss' }) =>
      resolveCommunityReport(reportId, action),
    onSuccess: async (_, variables) => {
      setNotice(variables.action === 'hide'
        ? '게시글을 숨기고 관련 미처리 신고를 종결했습니다.'
        : '신고를 기각했습니다.');
      await queryClient.invalidateQueries({ queryKey: ['admin-community-reports'] });
    },
  });
  const error = [meQuery.error, reportsQuery.error, resolveMutation.error]
    .find((item): item is ApiClientError => item instanceof ApiClientError);

  function changeFilters(next: Partial<CommunityReportFilters>) {
    setNotice('');
    setFilters((current) => ({ ...current, ...next, page: next.page ?? 1 }));
  }

  function resolve(reportId: string, action: 'hide' | 'dismiss') {
    if (action === 'hide' && !window.confirm('게시글을 즉시 숨기고 관련 신고를 모두 종결할까요?')) return;
    setNotice('');
    resolveMutation.mutate({ reportId, action });
  }

  return (
    <main className="catalog-page community-reports-page">
      <header className="catalog-header">
        <Link className="back-link" to="/">← 개발 현황으로</Link>
        <p className="react-stack-eyebrow">COMMUNITY SAFETY</p>
        <h1>커뮤니티 신고함</h1>
        <p>수업 팁과 여행기 신고를 검토하고 공개 게시물을 즉시 숨김 처리합니다.</p>
      </header>

      {meQuery.isLoading ? <p role="status">운영 권한을 확인하고 있습니다.</p> : null}
      {!meQuery.isLoading && !canManage ? (
        <section className="subscription-callout">
          <h2>운영자 권한이 필요합니다</h2>
          <p>신고 사유와 처리 이력은 운영자 또는 관리자만 확인할 수 있습니다.</p>
          <Link to="/account">계정 확인</Link>
        </section>
      ) : null}

      {canManage ? (
        <>
          <section className="community-report-toolbar" aria-label="신고함 필터">
            <label>처리 상태
              <select value={filters.status} onChange={(event) => changeFilters({
                status: event.target.value as CommunityReportFilters['status'],
              })}>
                <option value="open">미처리</option>
                <option value="resolved">숨김 처리</option>
                <option value="dismissed">기각</option>
                <option value="all">전체</option>
              </select>
            </label>
            <label>게시판
              <select value={filters.type} onChange={(event) => changeFilters({
                type: event.target.value as CommunityReportFilters['type'],
              })}>
                <option value="all">전체</option>
                <option value="classTip">수업 팁</option>
                <option value="travel">여행기</option>
              </select>
            </label>
            <strong>{reportsQuery.data?.pagination.total ?? 0}건</strong>
          </section>

          {reportsQuery.isLoading ? <p role="status">신고 내역을 불러오고 있습니다.</p> : null}
          {error ? <p className="form-error" role="alert">{error.message}</p> : null}
          {notice ? <p className="form-success" role="status">{notice}</p> : null}

          <section className="community-report-list" aria-labelledby="community-report-list-title">
            <h2 id="community-report-list-title">신고 내역</h2>
            {reportsQuery.data?.items.length === 0 ? <p className="community-report-empty">조건에 맞는 신고가 없습니다.</p> : null}
            {reportsQuery.data?.items.map((item) => (
              <article key={item.id} className="community-report-card">
                <div className="community-report-card-heading">
                  <div>
                    <span data-status={item.status}>{item.status === 'open' ? '미처리' : item.status === 'resolved' ? '숨김 처리' : '기각'}</span>
                    <small>{item.post.type === 'classTip' ? '수업 팁' : '여행기'} · {formatDate(item.createdAt)}</small>
                  </div>
                  <strong>{REASON_LABELS[item.reason]}</strong>
                </div>
                <h3>{item.post.title}</h3>
                <p className="community-report-author">작성자 {item.post.authorLabel} · 게시글 상태 {item.post.status}</p>
                <p className="community-report-detail">{item.detail || '추가 설명 없음'}</p>
                {item.status === 'open' ? (
                  <div className="community-report-actions">
                    <button type="button" disabled={resolveMutation.isPending} onClick={() => resolve(item.id, 'hide')}>게시글 숨김</button>
                    <button type="button" disabled={resolveMutation.isPending} onClick={() => resolve(item.id, 'dismiss')}>신고 기각</button>
                  </div>
                ) : item.resolvedAt ? <small>처리 시각 {formatDate(item.resolvedAt)}</small> : null}
              </article>
            ))}
          </section>

          {reportsQuery.data && reportsQuery.data.pagination.totalPages > 1 ? (
            <nav className="consultation-pagination" aria-label="신고함 페이지">
              <button type="button" disabled={filters.page <= 1} onClick={() => changeFilters({ page: filters.page - 1 })}>이전</button>
              <span>{filters.page} / {reportsQuery.data.pagination.totalPages}</span>
              <button type="button" disabled={filters.page >= reportsQuery.data.pagination.totalPages} onClick={() => changeFilters({ page: filters.page + 1 })}>다음</button>
            </nav>
          ) : null}
        </>
      ) : null}
    </main>
  );
}
