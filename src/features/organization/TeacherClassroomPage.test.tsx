import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TeacherClassroomPage } from './TeacherClassroomPage';

function response(data: unknown, status = 200) {
  return new Response(JSON.stringify(status < 400 ? { data } : { error: data }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter><TeacherClassroomPage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

const classes = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    name: '햇살반',
    academicYear: 2026,
    organization: { id: 'organization-1', name: '한빛초등학교' },
    assignment: { startsAt: '2026-03-02T00:00:00.000Z', endsAt: null },
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    name: '별빛반',
    academicYear: 2025,
    organization: { id: 'organization-1', name: '한빛초등학교' },
    assignment: { startsAt: '2025-03-03T00:00:00.000Z', endsAt: '2027-02-28T00:00:00.000Z' },
  },
];

describe('TeacherClassroomPage', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows only assigned classes and fetches each selected active roster', async () => {
    const rosterRequests: string[] = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/v1/me') return response({ user: {
        id: 'instructor-1', email: 'teacher@example.test', emailVerified: true,
        displayName: '김지도', roles: ['instructor'],
      } });
      if (url === '/api/v1/teacher/classes') return response({ items: classes });
      if (url === `/api/v1/teacher/classes/${classes[0].id}/invite-codes`) {
        expect(init?.method).toBe('POST');
        return response({ inviteCode: {
          code: 'ABCD-EFGH-JKLM',
          expiresAt: '2026-09-16T00:00:00.000Z',
          class: { ...classes[0], assignment: undefined },
        } });
      }
      if (url.endsWith('/students')) {
        rosterRequests.push(url);
        const isSunshine = url.includes(classes[0].id);
        return response({
          class: {
            id: isSunshine ? classes[0].id : classes[1].id,
            organizationId: 'organization-1',
            name: isSunshine ? '햇살반' : '별빛반',
            academicYear: isSunshine ? 2026 : 2025,
          },
          items: isSunshine
            ? [{ id: 'student-1', displayName: '강하늘', enrolledAt: '2026-03-02T00:00:00.000Z' }]
            : [{ id: 'student-2', displayName: '윤바다', enrolledAt: '2025-03-03T00:00:00.000Z' }],
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPage();

    expect(await screen.findByRole('heading', { name: '김지도님의 지도자 교실' })).toBeInTheDocument();
    expect(await screen.findByText('강하늘')).toBeInTheDocument();
    expect(screen.queryByText('teacher@example.test')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /햇살반/ })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '새 등록 코드 만들기' }));
    expect(await screen.findByText('ABCD-EFGH-JKLM')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /별빛반/ }));
    expect(await screen.findByText('윤바다')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '별빛반 학생 명단' })).toBeInTheDocument();
    expect(rosterRequests).toEqual([
      `/api/v1/teacher/classes/${classes[0].id}/students`,
      `/api/v1/teacher/classes/${classes[1].id}/students`,
    ]);
  });

  it('does not request class data for a non-instructor', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/v1/me') return response({ user: {
        id: 'student-1', email: 'student@example.test', emailVerified: true,
        displayName: '학생', roles: ['student'],
      } });
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPage();

    expect(await screen.findByRole('heading', { name: '지도자 권한이 필요합니다.' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('shows the server request id when roster access is rejected', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/v1/me') return response({ user: {
        id: 'instructor-1', email: 'teacher@example.test', emailVerified: true,
        displayName: '김지도', roles: ['instructor'],
      } });
      if (url === '/api/v1/teacher/classes') return response({ items: [classes[0]] });
      if (url.includes('/api/v1/teacher/classes/')) return response({
        code: 'CLASS_STUDENTS_FORBIDDEN',
        message: '담당 반의 학생만 조회할 수 있습니다.',
        requestId: 'request-teacher-1',
      }, 403);
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent('담당 반의 학생만 조회할 수 있습니다. (요청 ID: request-teacher-1)');
  });
});
