import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminOperationsPage } from './AdminOperationsPage';

function response(data: unknown) {
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter><AdminOperationsPage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

const queues = [
  { name: 'accountMail', status: 'critical', due: 2, staleLocks: 1, terminalErrors: 0, oldestDueAt: '2026-08-24T00:00:00.000Z' },
  { name: 'inquiryNotification', status: 'attention', due: 0, staleLocks: 0, terminalErrors: 1, oldestDueAt: null },
  { name: 'videoScan', status: 'healthy', due: 0, staleLocks: 0, terminalErrors: 0, oldestDueAt: null },
  { name: 'hlsTranscode', status: 'healthy', due: 0, staleLocks: 0, terminalErrors: 0, oldestDueAt: null },
  { name: 'objectDeletion', status: 'healthy', due: 0, staleLocks: 0, terminalErrors: 0, oldestDueAt: null },
];

describe('AdminOperationsPage', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows worker queue risks and manually refreshes for an operator', async () => {
    let healthRequests = 0;
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/v1/me') return response({ user: {
        id: 'operator-operations', email: 'operator@example.test', emailVerified: true,
        displayName: '운영자', roles: ['operator'],
      } });
      if (url === '/api/v1/admin/operations/worker-health') {
        healthRequests += 1;
        return response({
          status: 'critical', checkedAt: '2026-08-24T00:30:00.000Z',
          backlogThresholdMinutes: 15, queues,
          localVideoStorage: {
            enabled: true, status: 'attention', fileCount: 2, totalVideoBytes: 1024,
            capacityBytes: 32 * 1024 ** 3, availableBytes: 26 * 1024 ** 3,
            usedPercent: 18.8, invalidEntries: 0,
            warningFreeBytes: 5 * 1024 ** 3, criticalFreeBytes: 1024 ** 3,
          },
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPage();

    expect(await screen.findByRole('heading', { name: '운영 워커 상태' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: '즉시 확인' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '계정 인증·복구 메일' })).toBeInTheDocument();
    expect(screen.getByText('위험 적체 기준 15분')).toBeInTheDocument();
    expect(screen.getAllByText('1건').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole('heading', { name: '로컬 영상 저장소' })).toBeInTheDocument();
    expect(screen.getByText('26.0 GB')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '상태 새로고침' }));
    await waitFor(() => expect(healthRequests).toBe(2));
  });

  it('does not request internal queue data for a student', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/v1/me') return response({ user: {
        id: 'student-operations', email: 'student@example.test', emailVerified: true,
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
