import { type FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { ApiClientError } from '../../lib/api-client';
import {
  confirmEmailVerification,
  confirmPasswordReset,
  deleteAccount,
  getCurrentUser,
  login,
  listOAuthAccounts,
  logout,
  oauthAccountDeletionStartUrl,
  oauthLinkStartUrl,
  oauthStartUrl,
  requestEmailVerification,
  requestPasswordReset,
  signup,
  unlinkOAuthAccount,
  type AuthResponse,
  type OAuthProviderName,
} from './api';

const roleLabels: Record<string, string> = {
  student: '학생',
  guardian: '보호자',
  instructor: '지도자',
  organization_admin: '기관 관리자',
  operator: '운영자',
  admin: '관리자',
};

type AuthMode = 'login' | 'signup' | 'reset';
const oauthLabels = { naver: '네이버', kakao: '카카오', google: 'Google' } as const;

export function AuthPage() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialResetToken = searchParams.get('resetToken') ?? '';
  const initialVerificationToken = searchParams.get('verifyEmailToken') ?? '';
  const oauthLinked = searchParams.get('oauthLinked');
  const accountDeleted = searchParams.get('accountDeleted') === '1';
  const initialLinkedProvider = oauthLinked && oauthLinked in oauthLabels
    ? oauthLinked as OAuthProviderName
    : null;
  const [mode, setMode] = useState<AuthMode>(initialResetToken ? 'reset' : 'login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<'student' | 'guardian'>('student');
  const [resetToken, setResetToken] = useState(initialResetToken);
  const [verificationToken, setVerificationToken] = useState(initialVerificationToken);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [deletePassword, setDeletePassword] = useState('');
  const [notice, setNotice] = useState(
    accountDeleted
      ? '계정 탈퇴와 개인정보 익명화를 완료했습니다.'
      : initialLinkedProvider
        ? `${oauthLabels[initialLinkedProvider]} 계정 연결을 완료했습니다.`
        : '',
  );

  const meQuery = useQuery({
    queryKey: ['current-user'],
    queryFn: getCurrentUser,
    retry: false,
  });
  const oauthAccountsQuery = useQuery({
    queryKey: ['oauth-accounts'],
    queryFn: listOAuthAccounts,
    enabled: Boolean(meQuery.data),
    retry: false,
  });
  const authMutation = useMutation({
    mutationFn: (): Promise<AuthResponse> => mode === 'login'
      ? login({ email, password })
      : signup({ email, password, displayName, role }),
    onSuccess: (result) => {
      queryClient.setQueryData(['current-user'], result.user);
      setPassword('');
      if (result.developmentVerificationToken) setVerificationToken(result.developmentVerificationToken);
      setNotice(result.user.emailVerified ? '' : '로그인했습니다. 이메일 인증을 완료해 주세요.');
    },
  });
  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: () => {
      queryClient.setQueryData(['current-user'], null);
      setVerificationToken('');
      setNotice('로그아웃했습니다.');
    },
  });
  const unlinkOAuthMutation = useMutation({
    mutationFn: unlinkOAuthAccount,
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['oauth-accounts'] });
      setNotice(`${oauthLabels[result.provider]} 계정 연결을 해제했습니다.`);
    },
  });
  const deleteAccountMutation = useMutation({
    mutationFn: deleteAccount,
    onSuccess: () => {
      queryClient.setQueryData(['current-user'], null);
      queryClient.removeQueries({ queryKey: ['oauth-accounts'] });
      setDeleteConfirmation('');
      setDeletePassword('');
      setNotice('계정 탈퇴와 개인정보 익명화를 완료했습니다.');
    },
  });
  const resetRequestMutation = useMutation({
    mutationFn: () => requestPasswordReset(email),
    onSuccess: (result) => {
      if (result.developmentToken) setResetToken(result.developmentToken);
      setNotice('가입 여부와 관계없이 재설정 안내를 받을 수 있는 주소라면 안내를 전송했습니다.');
    },
  });
  const resetConfirmMutation = useMutation({
    mutationFn: () => confirmPasswordReset({ token: resetToken, password }),
    onSuccess: () => {
      queryClient.setQueryData(['current-user'], null);
      setResetToken('');
      setPassword('');
      setMode('login');
      setSearchParams({});
      setNotice('비밀번호를 변경하고 기존 로그인 세션을 모두 종료했습니다. 새 비밀번호로 로그인해 주세요.');
    },
  });
  const verificationRequestMutation = useMutation({
    mutationFn: requestEmailVerification,
    onSuccess: (result) => {
      if (result.developmentToken) setVerificationToken(result.developmentToken);
      setNotice(result.alreadyVerified ? '이미 인증된 이메일입니다.' : '이메일 인증 안내를 전송했습니다.');
    },
  });
  const verificationConfirmMutation = useMutation({
    mutationFn: () => confirmEmailVerification(verificationToken),
    onSuccess: () => {
      queryClient.setQueryData(['current-user'], (current: unknown) => {
        if (!current || typeof current !== 'object') return current;
        return { ...current, emailVerified: true };
      });
      setVerificationToken('');
      setSearchParams({});
      setNotice('이메일 인증을 완료했습니다.');
    },
  });

  function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice('');
    authMutation.mutate();
  }

  function changeMode(nextMode: AuthMode) {
    setMode(nextMode);
    setPassword('');
    setNotice('');
    authMutation.reset();
    resetRequestMutation.reset();
    resetConfirmMutation.reset();
  }

  const mutationErrors = [
    authMutation.error,
    resetRequestMutation.error,
    resetConfirmMutation.error,
    verificationRequestMutation.error,
    verificationConfirmMutation.error,
    logoutMutation.error,
    oauthAccountsQuery.error,
    unlinkOAuthMutation.error,
    deleteAccountMutation.error,
  ];
  const error = mutationErrors.find((item) => item instanceof ApiClientError)
    ?? (meQuery.error instanceof ApiClientError ? meQuery.error : null);
  const linkedProviders = new Set(oauthAccountsQuery.data?.items?.map((item) => item.provider) ?? []);
  const enabledProviders = new Set(window.APP_CONFIG?.oauthProviders ?? []);
  const visibleProviders = (['naver', 'kakao', 'google'] as OAuthProviderName[])
    .filter((provider) => linkedProviders.has(provider) || enabledProviders.has(provider));

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="account-title">
        <Link className="back-link" to="/">← 개발 현황으로</Link>
        <p className="react-stack-eyebrow">ACCOUNT</p>
        <h1 id="account-title">계정과 보안</h1>

        {meQuery.isLoading ? <p role="status">로그인 상태를 확인하고 있습니다.</p> : null}
        {meQuery.data ? (
          <div className="signed-in-panel">
            <p><strong>{meQuery.data.displayName}</strong>님으로 로그인했습니다.</p>
            <p>{meQuery.data.email}</p>
            <p className={`email-status ${meQuery.data.emailVerified ? 'is-verified' : ''}`}>
              이메일 {meQuery.data.emailVerified ? '인증 완료' : '인증 필요'}
            </p>
            <ul aria-label="계정 역할">
              {meQuery.data.roles.map((item) => <li key={item}>{roleLabels[item] ?? item}</li>)}
            </ul>
            {!meQuery.data.emailVerified ? (
              <section className="account-security" aria-labelledby="email-verification-title">
                <h2 id="email-verification-title">이메일 인증</h2>
                <p>계정 복구와 중요 알림을 위해 현재 이메일을 확인합니다.</p>
                <button
                  type="button"
                  disabled={verificationRequestMutation.isPending}
                  onClick={() => verificationRequestMutation.mutate()}
                >
                  {verificationRequestMutation.isPending ? '인증 안내 요청 중…' : '인증 안내 다시 받기'}
                </button>
                {verificationToken ? (
                  <form className="auth-form security-token-form" onSubmit={(event) => {
                    event.preventDefault();
                    verificationConfirmMutation.mutate();
                  }}>
                    <label>이메일 인증 토큰
                      <input value={verificationToken} onChange={(event) => setVerificationToken(event.target.value)} required />
                    </label>
                    <button type="submit" disabled={verificationConfirmMutation.isPending}>
                      {verificationConfirmMutation.isPending ? '인증 중…' : '이메일 인증 완료'}
                    </button>
                    <Link to={`/account?verifyEmailToken=${encodeURIComponent(verificationToken)}`}>개발용 인증 링크 열기</Link>
                  </form>
                ) : null}
              </section>
            ) : null}
            {visibleProviders.length > 0 ? (
              <section className="account-security oauth-account-links" aria-labelledby="oauth-account-links-title">
                <h2 id="oauth-account-links-title">소셜 계정 연결</h2>
                <p>연결 과정은 현재 로그인 계정과 일회성 OAuth 요청에 묶입니다. 마지막 로그인 수단은 해제할 수 없습니다.</p>
                {oauthAccountsQuery.isLoading ? <p role="status">소셜 계정 연결 상태를 확인하고 있습니다.</p> : null}
                <ul>
                  {visibleProviders.map((provider) => {
                    const account = oauthAccountsQuery.data?.items?.find((item) => item.provider === provider);
                    return (
                      <li key={provider}>
                        <span>
                          <strong>{oauthLabels[provider]}</strong>
                          <small>{account ? account.email ?? '이메일 비공개' : '연결되지 않음'}</small>
                        </span>
                        {account ? (
                          <button
                            type="button"
                            disabled={unlinkOAuthMutation.isPending}
                            onClick={() => {
                              if (window.confirm(`${oauthLabels[provider]} 계정 연결을 해제하시겠습니까?`)) {
                                unlinkOAuthMutation.mutate(provider);
                              }
                            }}
                          >연결 해제</button>
                        ) : enabledProviders.has(provider) ? (
                          <a href={oauthLinkStartUrl(provider)}>{oauthLabels[provider]} 연결</a>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ) : null}
            {oauthAccountsQuery.data?.items ? (
              <section className="account-security account-deletion" aria-labelledby="account-deletion-title">
                <h2 id="account-deletion-title">계정 탈퇴</h2>
                <p>로그인 수단과 학습 진도는 삭제하고 계정을 익명화합니다. 탈퇴 즉시 남은 구독 이용 권한도 종료되며, 결제·환불·감사 기록은 관련 보존 정책에 따라 분리 보관될 수 있습니다.</p>
                {oauthAccountsQuery.data.hasPassword ? (
                  <form
                    className="auth-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (window.confirm('계정을 탈퇴하면 되돌릴 수 없습니다. 계속하시겠습니까?')) {
                        deleteAccountMutation.mutate({
                          confirmation: deleteConfirmation,
                          password: deletePassword,
                        });
                      }
                    }}
                  >
                    <label>확인 문구
                      <input
                        value={deleteConfirmation}
                        onChange={(event) => setDeleteConfirmation(event.target.value)}
                        placeholder="회원탈퇴"
                        autoComplete="off"
                        required
                      />
                    </label>
                    <label>현재 비밀번호
                      <input
                        type="password"
                        value={deletePassword}
                        onChange={(event) => setDeletePassword(event.target.value)}
                        autoComplete="current-password"
                        maxLength={128}
                        required
                      />
                    </label>
                    <button type="submit" className="danger-button" disabled={deleteAccountMutation.isPending}>
                      {deleteAccountMutation.isPending ? '탈퇴 처리 중…' : '계정 탈퇴'}
                    </button>
                  </form>
                ) : (
                  <div className="oauth-deletion-options">
                    <p>연결된 소셜 계정으로 다시 인증하면 탈퇴가 완료됩니다.</p>
                    {oauthAccountsQuery.data.items.map((account) => (
                      <a
                        key={account.provider}
                        href={oauthAccountDeletionStartUrl(account.provider)}
                        onClick={(event) => {
                          if (!window.confirm('소셜 계정 재인증 후 즉시 탈퇴됩니다. 계속하시겠습니까?')) {
                            event.preventDefault();
                          }
                        }}
                      >{oauthLabels[account.provider]}로 확인하고 탈퇴</a>
                    ))}
                  </div>
                )}
              </section>
            ) : null}
            {meQuery.data.roles.some((item) => item === 'student' || item === 'guardian') ? (
              <Link className="guardian-link" to="/guardian">보호자 연결 관리</Link>
            ) : null}
            {meQuery.data.roles.includes('student') ? (
              <Link className="guardian-link" to="/dashboard">나의 여행지도</Link>
            ) : null}
            <button type="button" disabled={logoutMutation.isPending} onClick={() => logoutMutation.mutate()}>
              {logoutMutation.isPending ? '로그아웃 중…' : '로그아웃'}
            </button>
          </div>
        ) : !meQuery.isLoading ? (
          <>
            {verificationToken ? (
              <form className="auth-form account-security standalone-security" onSubmit={(event) => {
                event.preventDefault();
                verificationConfirmMutation.mutate();
              }}>
                <h2>이메일 인증</h2>
                <label>이메일 인증 토큰
                  <input value={verificationToken} onChange={(event) => setVerificationToken(event.target.value)} required />
                </label>
                <button type="submit" disabled={verificationConfirmMutation.isPending}>
                  {verificationConfirmMutation.isPending ? '인증 중…' : '이메일 인증 완료'}
                </button>
              </form>
            ) : null}

            <div className="auth-tabs" role="tablist" aria-label="계정 작업 선택">
              <button type="button" role="tab" aria-selected={mode === 'login'} onClick={() => changeMode('login')}>로그인</button>
              <button type="button" role="tab" aria-selected={mode === 'signup'} onClick={() => changeMode('signup')}>회원가입</button>
            </div>

            {window.APP_CONFIG?.oauthEnabled && window.APP_CONFIG.oauthProviders?.length ? (
              <section className="oauth-login" aria-label="소셜 로그인">
                <p>간편 로그인</p>
                <div>
                  {window.APP_CONFIG.oauthProviders.map((provider) => (
                    <a key={provider} href={oauthStartUrl(provider)}>{oauthLabels[provider]}로 계속하기</a>
                  ))}
                </div>
              </section>
            ) : null}

            {mode === 'reset' ? (
              <form className="auth-form" onSubmit={(event) => {
                event.preventDefault();
                setNotice('');
                if (resetToken) resetConfirmMutation.mutate();
                else resetRequestMutation.mutate();
              }}>
                <h2>비밀번호 재설정</h2>
                {resetToken ? (
                  <>
                    <label>재설정 토큰
                      <input value={resetToken} onChange={(event) => setResetToken(event.target.value)} required />
                    </label>
                    <label>새 비밀번호
                      <input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={10} maxLength={128} required />
                    </label>
                    <button type="submit" disabled={resetConfirmMutation.isPending}>
                      {resetConfirmMutation.isPending ? '변경 중…' : '비밀번호 변경'}
                    </button>
                    <Link to={`/account?resetToken=${encodeURIComponent(resetToken)}`}>개발용 재설정 링크 열기</Link>
                  </>
                ) : (
                  <>
                    <p>가입한 이메일을 입력하면 재설정 안내를 보냅니다.</p>
                    <label>이메일
                      <input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
                    </label>
                    <button type="submit" disabled={resetRequestMutation.isPending}>
                      {resetRequestMutation.isPending ? '요청 중…' : '재설정 안내 받기'}
                    </button>
                  </>
                )}
                <button className="text-button" type="button" onClick={() => changeMode('login')}>로그인으로 돌아가기</button>
              </form>
            ) : (
              <form className="auth-form" onSubmit={submitAuth}>
                {mode === 'signup' ? (
                  <>
                    <label>이름<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} minLength={2} maxLength={40} required /></label>
                    <label>가입 역할
                      <select value={role} onChange={(event) => setRole(event.target.value as 'student' | 'guardian')}>
                        <option value="student">학생</option>
                        <option value="guardian">보호자</option>
                      </select>
                    </label>
                  </>
                ) : null}
                <label>이메일<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
                <label>비밀번호<input type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={(event) => setPassword(event.target.value)} minLength={10} maxLength={128} required /></label>
                <button type="submit" disabled={authMutation.isPending}>
                  {authMutation.isPending ? '처리 중…' : mode === 'login' ? '로그인' : '회원가입'}
                </button>
                {mode === 'login' ? (
                  <button className="text-button" type="button" onClick={() => changeMode('reset')}>비밀번호를 잊으셨나요?</button>
                ) : null}
              </form>
            )}
          </>
        ) : null}

        {notice ? <p className="auth-notice" role="status">{notice}</p> : null}
        {error instanceof ApiClientError ? (
          <p className="auth-error" role="alert">
            {error.message}{error.requestId ? ` (요청 ID: ${error.requestId})` : ''}
          </p>
        ) : null}
      </section>
    </main>
  );
}
