import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminInquiriesPage } from './AdminInquiriesPage';
import type { AdminInquiry, InquiryNotificationJob } from './api';

const item: AdminInquiry = {
  id: 'inquiry-ui-1', requesterUserId: 'student-1', category: '학습', title: '진도 저장 문의',
  content: '다른 기기에서 학습 진도를 확인하고 싶습니다.', status: 'submitted', answer: null,
  answeredById: null, answeredAt: null,
  attachment: {
    id: 'attachment-ui-1', originalName: '진도 화면.pdf', contentType: 'application/pdf', size: 4096, status: 'ready',
  },
  createdAt: '2026-08-24T00:00:00.000Z', updatedAt: '2026-08-24T00:00:00.000Z',
};

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={queryClient}><MemoryRouter><AdminInquiriesPage /></MemoryRouter></QueryClientProvider>);
}

function response(data: unknown, status = 200) {
  return new Response(JSON.stringify({ data }), { status, headers: { 'content-type': 'application/json' } });
}

describe('AdminInquiriesPage', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('allows an operator to answer a private inquiry and close it', async () => {
    let current = { ...item };
    let notificationJobs: InquiryNotificationJob[] = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/v1/me') return response({ user: {
        id: 'operator-1', email: 'operator@example.test', emailVerified: true,
        displayName: '운영자', roles: ['operator'],
      } });
      if (url.startsWith('/api/v1/admin/inquiries?')) return response({
        items: [current], pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
      });
      if (url === `/api/v1/admin/inquiries/${item.id}/notification-jobs`) {
        return response({ items: notificationJobs });
      }
      if (url === '/api/v1/admin/inquiry-notification-jobs/notification-ui-1/retry' && init?.method === 'POST') {
        notificationJobs = notificationJobs.map((job) => ({
          ...job, status: 'pending', attempts: 0, lastError: null, manualRetryAvailable: false,
        }));
        return response({ job: notificationJobs[0] });
      }
      if (url === `/api/v1/admin/inquiries/${item.id}`) return response({ inquiry: current });
      if (url.endsWith(`/${item.id}/answer`) && init?.method === 'POST') {
        expect(JSON.parse(String(init.body))).toEqual({ answer: '진도는 로그인한 계정에 자동 저장됩니다.' });
        current = {
          ...current, status: 'answered', answer: '진도는 로그인한 계정에 자동 저장됩니다.',
          answeredById: 'operator-1', answeredAt: '2026-08-24T01:00:00.000Z',
        };
        notificationJobs = [{
          id: 'notification-ui-1', inquiryId: item.id, answerVersion: 1,
          status: 'error', attempts: 5, nextAttemptAt: '2026-08-24T02:00:00.000Z',
          completedAt: null, lastError: 'SMTP_TEMPORARY_FAILURE', manualRetryAvailable: true,
          createdAt: '2026-08-24T01:00:00.000Z', updatedAt: '2026-08-24T01:30:00.000Z',
        }];
        return response({ inquiry: current });
      }
      if (url.endsWith(`/${item.id}/status`) && init?.method === 'PATCH') {
        expect(JSON.parse(String(init.body))).toEqual({ status: 'closed' });
        current = { ...current, status: 'closed' };
        return response({ inquiry: current });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPage();

    expect(await screen.findByRole('heading', { name: '1:1 문의 관리' })).toBeInTheDocument();
    expect(await screen.findByText('다른 기기에서 학습 진도를 확인하고 싶습니다.')).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: '진도 화면.pdf' })).toHaveAttribute(
      'href',
      `/api/v1/admin/inquiries/${item.id}/attachment`,
    );
    fireEvent.change(await screen.findByLabelText('운영자 답변'), { target: { value: '진도는 로그인한 계정에 자동 저장됩니다.' } });
    fireEvent.click(screen.getByRole('button', { name: '답변 등록' }));
    expect(await screen.findByText('문의 답변을 저장했습니다. 이메일 알림은 별도로 처리됩니다.')).toBeInTheDocument();
    expect(await screen.findByText('재검토로 전환하면 기존 답변이 삭제됩니다.')).toBeInTheDocument();
    expect(await screen.findByText('SMTP_TEMPORARY_FAILURE')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '이메일 재시도' }));
    expect(await screen.findByText('답변 이메일 발송을 다시 요청했습니다.')).toBeInTheDocument();
    expect(await screen.findByText('발송 대기')).toBeInTheDocument();

    const confirmMock = vi.fn(() => false);
    vi.stubGlobal('confirm', confirmMock);
    fireEvent.click(screen.getByRole('button', { name: '검토 중 전환' }));
    expect(confirmMock).toHaveBeenCalledWith('재검토로 전환하면 기존 답변이 삭제됩니다. 계속하시겠습니까?');

    fireEvent.click(screen.getByRole('button', { name: '종료 전환' }));
    expect(await screen.findByText(/문의 상태를 '종료'/)).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: '재검토 후 답변 가능' })).toBeDisabled();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/admin/inquiries/${item.id}/status`,
      expect.objectContaining({ method: 'PATCH' }),
    ));
  });

  it('does not request private inquiries for a non-operator', async () => {
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
