import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthPage } from './AuthPage';

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AuthPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AuthPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete window.APP_CONFIG;
  });

  it('shows the login form when the session endpoint returns 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { code: 'AUTH_REQUIRED', message: '로그인이 필요합니다.', requestId: 'req_test_123' },
    }), { status: 401, headers: { 'content-type': 'application/json' } })));

    renderPage();

    expect(await screen.findByRole('button', { name: '로그인' })).toBeInTheDocument();
    expect(screen.getByLabelText('이메일')).toBeInTheDocument();
    expect(screen.getByLabelText('비밀번호')).toHaveAttribute('minlength', '10');
  });

  it('requests a password reset and shows the development confirmation form', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: { code: 'AUTH_REQUIRED', message: '로그인이 필요합니다.', requestId: 'req_me' },
      }), { status: 401, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: { accepted: true, developmentToken: 'a'.repeat(43) },
      }), { status: 202, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: '비밀번호를 잊으셨나요?' }));
    fireEvent.change(screen.getByLabelText('이메일'), { target: { value: 'member@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: '재설정 안내 받기' }));

    expect(await screen.findByLabelText('재설정 토큰')).toHaveValue('a'.repeat(43));
    expect(screen.getByLabelText('새 비밀번호')).toHaveAttribute('minlength', '10');
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/v1/auth/password-reset/request',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    );
  });

  it('lets a signed-in user request and complete email verification', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/me')) {
        return new Response(JSON.stringify({
          data: {
            user: {
              id: 'user-1',
              email: 'member@example.com',
              emailVerified: false,
              displayName: '테스트 회원',
              roles: ['student'],
            },
          },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.endsWith('/auth/email-verification/request')) {
        return new Response(JSON.stringify({
          data: { accepted: true, alreadyVerified: false, developmentToken: 'b'.repeat(43) },
        }), { status: 202, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({
        data: { verified: true, verifiedAt: new Date().toISOString() },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: '인증 안내 다시 받기' }));
    expect(await screen.findByLabelText('이메일 인증 토큰')).toHaveValue('b'.repeat(43));
    fireEvent.click(screen.getByRole('button', { name: '이메일 인증 완료' }));

    expect(await screen.findByText('이메일 인증을 완료했습니다.')).toBeInTheDocument();
    expect(screen.getByText('이메일 인증 완료')).toBeInTheDocument();
  });

  it('shows only OAuth providers enabled by the reusable server module configuration', async () => {
    window.APP_CONFIG = {
      apiBaseUrl: '/api/v1',
      oauthEnabled: true,
      oauthProviders: ['naver', 'google'],
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { code: 'AUTH_REQUIRED', message: '로그인이 필요합니다.', requestId: 'req_oauth_ui' },
    }), { status: 401, headers: { 'content-type': 'application/json' } })));
    renderPage();

    expect(await screen.findByRole('link', { name: '네이버로 계속하기' })).toHaveAttribute(
      'href',
      '/api/v1/auth/oauth/naver/start?returnTo=%2Faccount',
    );
    expect(screen.getByRole('link', { name: 'Google로 계속하기' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '카카오로 계속하기' })).not.toBeInTheDocument();
  });
});
