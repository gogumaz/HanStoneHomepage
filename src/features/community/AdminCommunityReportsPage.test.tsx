import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminCommunityReportsPage } from './AdminCommunityReportsPage';

const report = {
  id: 'report-ui-1',
  reason: 'personal_info',
  detail: '학생 연락처가 본문에 노출되어 있습니다.',
  status: 'open',
  resolution: null,
  resolvedAt: null,
  createdAt: '2026-08-24T01:00:00.000Z',
  post: {
    id: 'post-ui-1', type: 'classTip', title: '교실 대항전 운영 팁', status: 'published', authorLabel: '김지도',
  },
};

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter><AdminCommunityReportsPage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

function response(data: unknown, status = 200) {
  return new Response(JSON.stringify({ data }), { status, headers: { 'content-type': 'application/json' } });
}

describe('AdminCommunityReportsPage', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows the operator queue and hides a reported post', async () => {
    let items = [report];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/v1/me') return response({ user: {
        id: 'operator-1', email: 'operator@example.test', emailVerified: true,
        displayName: '운영자', roles: ['operator'],
      } });
      if (url.startsWith('/api/v1/admin/community-reports?')) return response({
        items, pagination: { page: 1, pageSize: 20, total: items.length, totalPages: 1 },
      });
      if (url === `/api/v1/admin/community-reports/${report.id}/resolve` && init?.method === 'POST') {
        expect(JSON.parse(String(init.body))).toEqual({ action: 'hide' });
        items = [];
        return response({ report: {
          ...report, status: 'resolved', resolution: 'hidden', resolvedAt: '2026-08-24T02:00:00.000Z',
          post: { ...report.post, status: 'hidden' },
        } });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('confirm', vi.fn(() => true));
    renderPage();

    expect(await screen.findByRole('heading', { name: '커뮤니티 신고함' })).toBeInTheDocument();
    expect(await screen.findByText('교실 대항전 운영 팁')).toBeInTheDocument();
    expect(screen.getByText('개인정보 노출')).toBeInTheDocument();
    expect(screen.getByText('학생 연락처가 본문에 노출되어 있습니다.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '게시글 숨김' }));
    expect(await screen.findByText('게시글을 숨기고 관련 미처리 신고를 종결했습니다.')).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/admin/community-reports/${report.id}/resolve`,
      expect.objectContaining({ method: 'POST' }),
    ));
  });

  it('does not request reports without an operator role', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/v1/me') return response({ user: {
        id: 'student-1', email: 'student@example.test', emailVerified: true,
        displayName: '학생', roles: ['student'],
      } });
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPage();

    expect(await screen.findByRole('heading', { name: '운영자 권한이 필요합니다' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
