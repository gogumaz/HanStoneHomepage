import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OrganizationAdminPage } from './OrganizationAdminPage';

function response(data: unknown) { return new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } }); }
const organizationId = '10000000-0000-4000-8000-000000000001';
const classId = '20000000-0000-4000-8000-000000000001';

describe('OrganizationAdminPage', () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('creates classes and manages instructor assignments inside the selected organization', async () => {
    const mutations: string[] = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/v1/me') return response({ user: { id: 'admin-1', displayName: '기관장', roles: ['organization_admin'] } });
      if (url === '/api/v1/organization-admin/organizations') return response({ items: [{ membershipId: 'admin-membership', organization: { id: organizationId, name: '한빛초' }, membership: { startsAt: '2026-01-01', endsAt: null }, permissions: { license: ['read', 'manage'], seats: ['read', 'manage'], refunds: ['read', 'request'] } }], paymentExecutionRoles: ['operator', 'admin'] });
      if (url.endsWith('/management')) return response({ organization: { id: organizationId, name: '한빛초', seatLimit: 30, usedSeats: 12 }, members: [{ membershipId: 'admin-membership', role: 'admin', status: 'active', startsAt: '2026-01-01', endsAt: null, user: { id: 'admin-1', email: 'admin@example.test', displayName: '기관장' } }] });
      if (url.endsWith('/instructors')) return response({ items: [{ membershipId: 'teacher-membership', user: { id: 'teacher-1', displayName: '김지도' }, startsAt: '2026-01-01', endsAt: null }] });
      if (url.endsWith('/classes') && init?.method === 'POST') { mutations.push('create'); return response({ class: { id: 'new-class' } }); }
      if (url.includes('/instructors/teacher-membership') && init?.method === 'PUT') { mutations.push('assign'); return response({ assignment: { id: 'assignment-1' } }); }
      if (url.endsWith('/classes')) return response({ items: [{ id: classId, organizationId, name: '햇살반', academicYear: 2026, status: 'active', createdAt: '2026-01-01', updatedAt: '2026-01-01', teachers: [], students: [] }] });
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MemoryRouter><OrganizationAdminPage /></MemoryRouter></QueryClientProvider>);

    expect(await screen.findByRole('heading', { name: '기관·학급·배정 관리' })).toBeInTheDocument();
    expect(await screen.findByText(/12석/)).toBeInTheDocument();
    fireEvent.change(await screen.findByLabelText('학급 이름'), { target: { value: '별빛반' } });
    fireEvent.click(screen.getByRole('button', { name: '학급 생성' }));
    expect(await screen.findByText('새 학급을 만들었습니다.')).toBeInTheDocument();
    fireEvent.change(await screen.findByLabelText('햇살반 지도자 선택'), { target: { value: 'teacher-membership' } });
    fireEvent.click(screen.getByRole('button', { name: '배정' }));
    await waitFor(() => expect(mutations).toEqual(['create', 'assign']));
  });
});
