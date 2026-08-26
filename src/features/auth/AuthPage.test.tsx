import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
    cleanup();
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

  it('renders API-provided account text without creating executable HTML', async () => {
    const maliciousName = '<img src=x onerror="window.__xss=1">공격자';
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/me')) {
        return new Response(JSON.stringify({
          data: {
            user: {
              id: 'user-xss',
              email: 'xss@example.com',
              emailVerified: true,
              displayName: maliciousName,
              roles: ['student'],
            },
          },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({ data: { items: [], hasPassword: true } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }));

    renderPage();

    expect(await screen.findByText(maliciousName)).toBeInTheDocument();
    expect(document.querySelector('img[onerror]')).toBeNull();
  });

  it('shows linked OAuth accounts and lets a password user unlink one', async () => {
    window.APP_CONFIG = {
      apiBaseUrl: '/api/v1',
      oauthEnabled: true,
      oauthProviders: ['naver', 'google'],
    };
    let linked = true;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/me')) {
        return new Response(JSON.stringify({
          data: {
            user: {
              id: 'user-oauth-links',
              email: 'owner@example.com',
              emailVerified: true,
              displayName: 'OAuth Owner',
              roles: ['student'],
            },
          },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.endsWith('/me/oauth-accounts/google') && init?.method === 'DELETE') {
        linked = false;
        return new Response(JSON.stringify({
          data: { unlinked: true, provider: 'google' },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.endsWith('/me/oauth-accounts')) {
        return new Response(JSON.stringify({
          data: {
            items: linked ? [{ provider: 'google', email: 'linked@example.com', createdAt: new Date().toISOString() }] : [],
            hasPassword: true,
          },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage();

    expect(await screen.findByText('linked@example.com')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '네이버 연결' })).toHaveAttribute(
      'href',
      '/api/v1/me/oauth-accounts/naver/start?returnTo=%2Faccount%3FoauthLinked%3Dnaver',
    );

    fireEvent.click(screen.getByRole('button', { name: '연결 해제' }));

    expect(await screen.findByText('Google 계정 연결을 해제했습니다.')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/me/oauth-accounts/google',
      expect.objectContaining({ method: 'DELETE', credentials: 'include' }),
    );
  });

  it('requires confirmation and the current password before deleting an account', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/me') && init?.method === 'DELETE') {
        return new Response(JSON.stringify({ data: { deleted: true } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.endsWith('/me')) {
        return new Response(JSON.stringify({
          data: {
            user: {
              id: 'user-delete',
              email: 'delete@example.com',
              emailVerified: true,
              displayName: 'Delete User',
              roles: ['student'],
            },
          },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.endsWith('/me/oauth-accounts')) {
        return new Response(JSON.stringify({ data: { items: [], hasPassword: true } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage();

    fireEvent.change(await screen.findByLabelText('확인 문구'), { target: { value: '회원탈퇴' } });
    fireEvent.change(screen.getByLabelText('현재 비밀번호'), { target: { value: 'safe-password-delete' } });
    fireEvent.click(screen.getByRole('button', { name: '계정 탈퇴' }));

    expect(await screen.findByText('계정 탈퇴와 개인정보 익명화를 완료했습니다.')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/me',
      expect.objectContaining({
        method: 'DELETE',
        credentials: 'include',
        body: JSON.stringify({ confirmation: '회원탈퇴', password: 'safe-password-delete' }),
      }),
    );
  });

  it('offers OAuth reauthentication for an account without a password', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/me')) {
        return new Response(JSON.stringify({
          data: {
            user: {
              id: 'user-oauth-delete',
              email: 'oauth-delete@example.com',
              emailVerified: true,
              displayName: 'OAuth Delete User',
              roles: ['student'],
            },
          },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({
        data: {
          items: [{ provider: 'kakao', email: 'oauth-delete@example.com', createdAt: new Date().toISOString() }],
          hasPassword: false,
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPage();

    const oauthDeletionLink = await screen.findByRole('link', { name: '카카오로 확인하고 탈퇴' });
    expect(oauthDeletionLink).toHaveAttribute(
      'href',
      '/api/v1/me/account-deletion/oauth/kakao/start?returnTo=%2Faccount%3FaccountDeleted%3D1',
    );
    expect(oauthDeletionLink.closest('section')?.querySelector('input[type="password"]')).toBeNull();
  });
});
