import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QrPage } from './QrPage';

function LessonDestination() {
  const lessonId = useParams().lessonId;
  return <h1>{lessonId} 강의 도착</h1>;
}

function AccountDestination() {
  const location = useLocation();
  return <h1>로그인 이동 {location.search}</h1>;
}

describe('textbook QR route', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('opens the exact lesson returned for the scanned opaque code', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/me')) {
        return new Response(JSON.stringify({
          data: {
            user: {
              id: 'student-qr',
              email: 'qr@example.com',
              emailVerified: true,
              displayName: 'QR 학생',
              roles: ['student'],
            },
          },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({
        data: {
          status: 'active',
          expiresAt: null,
          remainingClaims: null,
          target: {
            type: 'lesson',
            lesson: { id: 'PRE-01', title: '주먹도끼에서 배운 첫 수' },
            path: '/lessons/PRE-01',
          },
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/qr/QR-PREHISTORIC-0001']}>
          <Routes>
            <Route path="/qr/:code" element={<QrPage />} />
            <Route path="/lessons/:lessonId" element={<LessonDestination />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole('heading', { name: 'PRE-01 강의 도착' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/qr/QR-PREHISTORIC-0001',
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('sends a signed-out reader to login with the exact QR route preserved', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/me')) {
        return new Response(JSON.stringify({
          error: { code: 'AUTH_REQUIRED', message: '로그인이 필요합니다.', requestId: 'req_qr_me' },
        }), { status: 401, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({
        data: {
          status: 'active',
          expiresAt: null,
          remainingClaims: 1,
          target: {
            type: 'lesson',
            lesson: { id: 'PRE-01', title: '주먹도끼에서 배운 첫 수' },
            path: '/lessons/PRE-01',
          },
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/qr/QR-PREHISTORIC-0001']}>
          <Routes>
            <Route path="/qr/:code" element={<QrPage />} />
            <Route path="/account" element={<AccountDestination />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole('heading', {
      name: '로그인 이동 ?returnTo=%2Fqr%2FQR-PREHISTORIC-0001',
    })).toBeInTheDocument();
  });

  it.each([
    {
      status: 'expired',
      expiresAt: '2026-08-29T15:00:00.000Z',
      remainingClaims: 1,
      title: '사용 기간이 만료된 QR 코드입니다.',
      detail: '이 코드는 더 이상 등록하거나 강의를 열 수 없습니다. 새 코드가 필요하면 교재 구매처에 문의해 주세요.',
      action: '다른 강의 둘러보기',
      actionPath: '/lessons',
    },
    {
      status: 'used',
      expiresAt: null,
      remainingClaims: 0,
      title: '이미 사용이 완료된 QR 코드입니다.',
      detail: '등록 가능 횟수가 모두 소진되었습니다. 이전에 등록한 강의는 나의 학습 여정에서 확인해 주세요.',
      action: '등록한 강의 확인하기',
      actionPath: '/dashboard',
    },
  ] as const)('clearly explains a $status QR code and the next action', async (state) => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      data: {
        status: state.status,
        expiresAt: state.expiresAt,
        remainingClaims: state.remainingClaims,
        target: null,
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/qr/QR-STATE-CODE-0001']}>
          <Routes>
            <Route path="/qr/:code" element={<QrPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(state.title);
    expect(alert).toHaveTextContent(state.detail);
    expect(screen.getByRole('link', { name: state.action })).toHaveAttribute('href', state.actionPath);
    if (state.status === 'expired') {
      expect(alert.querySelector('time')).toHaveAttribute('datetime', state.expiresAt);
    } else {
      expect(alert).toHaveTextContent('남은 등록 횟수: 0회');
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
