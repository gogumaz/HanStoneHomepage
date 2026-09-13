import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DashboardPage } from './DashboardPage';

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
      <MemoryRouter><DashboardPage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('DashboardPage class enrollment', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('claims a teacher-issued code and confirms the enrolled class', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/v1/me') return response({ user: {
        id: 'student-1', email: 'student@example.test', emailVerified: true,
        displayName: '한별', roles: ['student'],
      } });
      if (url === '/api/v1/me/dashboard') return response({
        student: { id: 'student-1', displayName: '한별' },
        generatedAt: '2026-09-13T00:00:00.000Z',
        access: { hasActiveSubscription: false, subscriptionEndsAt: null },
        summary: {
          totalLessons: 0, startedLessons: 0, completedLessons: 0, completionRate: 0,
          completedSteps: 0, totalSteps: 0, stepCompletionRate: 0, lastActivityAt: null,
          weekly: { studyDays: 0, firstAttemptMissions: 0, firstAttemptAccuracy: 0 },
        },
        eras: [], recentLessons: [], nextLesson: null,
      });
      if (url === '/api/v1/me/class-invite-codes/claim') {
        expect(init?.method).toBe('POST');
        expect(JSON.parse(init?.body as string)).toEqual({ code: 'ABCD-EFGH-JKLM' });
        return response({ enrollment: {
          id: 'enrollment-1',
          enrolledAt: '2026-09-13T00:00:00.000Z',
          class: {
            id: 'class-1', name: '햇살반', academicYear: 2026,
            organization: { id: 'organization-1', name: '한빛초등학교' },
          },
        } });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPage();

    const input = await screen.findByLabelText('학생 등록 코드');
    fireEvent.change(input, { target: { value: 'abcd-efgh-jklm' } });
    fireEvent.click(screen.getByRole('button', { name: '학급 등록하기' }));

    const enrolledClass = await screen.findByText('햇살반');
    expect(enrolledClass.closest('[role="status"]')).toHaveTextContent('햇살반 등록을 완료했습니다. (한빛초등학교)');
    await waitFor(() => expect(input).toHaveValue(''));
  });
});
