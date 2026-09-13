import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TeacherAssignmentsPanel } from './TeacherAssignmentsPanel';

const classId = '10000000-0000-4000-8000-000000000001';
function response(data: unknown) { return new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } }); }

describe('TeacherAssignmentsPanel', () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('creates a draft from published resources and active students', async () => {
    let createdBody: Record<string, unknown> | null = null;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/assignment-options')) return response({
        class: { id: classId, name: '햇살반', academicYear: 2026, organizationId: 'org-1' },
        lessons: [{ id: 'PRE-01', title: '첫 강의', course: '입문', order: 1, era: { id: 'pre', name: '선사시대', order: 1 } }],
        missions: [{ id: 'mission-01', title: '활로 찾기', boardSize: 9, difficulty: 1, era: { id: 'pre', name: '선사시대', order: 1 } }],
        students: [{ id: 'student-1', displayName: '강하늘', enrolledAt: '2026-03-01T00:00:00.000Z' }],
      });
      if (url.endsWith('/assignments') && init?.method === 'POST') {
        createdBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        return response({ assignment: { id: 'assignment-1', status: 'draft' } });
      }
      if (url.endsWith('/assignments')) return response({ items: [] });
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><TeacherAssignmentsPanel classId={classId} /></QueryClientProvider>);

    fireEvent.change(await screen.findByLabelText('과제 제목'), { target: { value: '이번 주 과제' } });
    fireEvent.click(await screen.findByLabelText(/강의 · 선사시대 · 첫 강의/));
    fireEvent.click(screen.getByRole('button', { name: '과제 초안 만들기' }));
    expect(await screen.findByText(/과제 초안을 만들었습니다/)).toBeInTheDocument();
    await waitFor(() => expect(createdBody).toMatchObject({
      title: '이번 주 과제',
      items: [{ type: 'lesson', resourceId: 'PRE-01' }],
      targetStudentIds: [],
    }));
  });
});
