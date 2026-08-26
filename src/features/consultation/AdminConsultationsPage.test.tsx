import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminConsultationsPage } from './AdminConsultationsPage';

const item = {
  id: 'consultation-ui-1', requesterUserId: null, category: '학교', organizationName: '한빛초등학교',
  contactName: '홍길동', phone: '010-1234-5678', email: 'teacher@example.test', expectedStudents: 30,
  title: '방과후 수업 도입 문의', content: '다음 학기 방과후 바둑 수업을 상담하고 싶습니다.',
  privacyConsentVersion: 'consultation-privacy-v1', privacyConsentedAt: '2026-08-24T00:00:00.000Z',
  status: 'submitted', createdAt: '2026-08-24T00:00:00.000Z', updatedAt: '2026-08-24T00:00:00.000Z',
};

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={queryClient}><MemoryRouter><AdminConsultationsPage /></MemoryRouter></QueryClientProvider>);
}

function response(data: unknown, status = 200) {
  return new Response(JSON.stringify({ data }), { status, headers: { 'content-type': 'application/json' } });
}

describe('AdminConsultationsPage', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows an operator the private queue and changes status', async () => {
    let current = { ...item };
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/v1/me') return response({ user: {
        id: 'operator-1', email: 'operator@example.test', emailVerified: true,
        displayName: '운영자', roles: ['operator'],
      } });
      if (url.startsWith('/api/v1/admin/consultations?')) return response({
        items: [current], pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        summary: { total: 1, submitted: current.status === 'submitted' ? 1 : 0, in_review: current.status === 'in_review' ? 1 : 0, contacted: 0, closed: 0 },
      });
      if (url === `/api/v1/admin/consultations/${item.id}`) return response({ consultation: current });
      if (url.endsWith(`/${item.id}/status`) && init?.method === 'PATCH') {
        expect(JSON.parse(String(init.body))).toEqual({ status: 'in_review' });
        current = { ...current, status: 'in_review' };
        return response({ consultation: current });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPage();

    expect(await screen.findByRole('heading', { name: '기관 상담 관리' })).toBeInTheDocument();
    expect(await screen.findByText('010-1234-5678')).toBeInTheDocument();
    expect(screen.getByText(/consultation-privacy-v1/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '검토 중 전환' }));
    expect(await screen.findByText(/상담 상태를 '검토 중'/)).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/admin/consultations/${item.id}/status`,
      expect.objectContaining({ method: 'PATCH' }),
    ));
  });

  it('does not request the queue for a non-operator', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/v1/me') return response({ user: {
        id: 'student-1', email: 'student@example.test', emailVerified: true,
        displayName: '학생', roles: ['student'],
      } });
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPage();

    expect(await screen.findByRole('heading', { name: '운영자 권한이 필요합니다.' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
