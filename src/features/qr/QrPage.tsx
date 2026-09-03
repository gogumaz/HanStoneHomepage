import { useQuery } from '@tanstack/react-query';
import { Link, Navigate, useLocation, useParams } from 'react-router-dom';
import { ApiClientError } from '../../lib/api-client';
import { getCurrentUser } from '../auth/api';
import { resolveQrCode, type QrResolution } from './api';

type InactiveQrStatus = Exclude<QrResolution['status'], 'active'>;

const STATUS_CONTENT: Record<InactiveQrStatus, {
  title: string;
  message: string;
  action: { to: string; label: string };
}> = {
  expired: {
    title: '사용 기간이 만료된 QR 코드입니다.',
    message: '이 코드는 더 이상 등록하거나 강의를 열 수 없습니다. 새 코드가 필요하면 교재 구매처에 문의해 주세요.',
    action: { to: '/lessons', label: '다른 강의 둘러보기' },
  },
  used: {
    title: '이미 사용이 완료된 QR 코드입니다.',
    message: '등록 가능 횟수가 모두 소진되었습니다. 이전에 등록한 강의는 나의 학습 여정에서 확인해 주세요.',
    action: { to: '/dashboard', label: '등록한 강의 확인하기' },
  },
  disabled: {
    title: '사용이 중지된 QR 코드입니다.',
    message: '운영 정책에 따라 이 코드의 사용이 중지되었습니다. 다른 강의를 선택해 주세요.',
    action: { to: '/lessons', label: '강의 목록 보기' },
  },
  unavailable: {
    title: '연결된 강의를 현재 이용할 수 없습니다.',
    message: '강의가 준비 중이거나 공개가 종료되었습니다. 다른 강의를 선택해 주세요.',
    action: { to: '/lessons', label: '강의 목록 보기' },
  },
};

function formatExpiry(value: string): string {
  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'long',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function QrPage() {
  const code = useParams().code ?? '';
  const location = useLocation();
  const query = useQuery({
    queryKey: ['qr-code', code],
    queryFn: () => resolveQrCode(code),
    enabled: Boolean(code),
    retry: false,
  });
  const sessionQuery = useQuery({
    queryKey: ['current-user'],
    queryFn: getCurrentUser,
    enabled: query.data?.status === 'active' && Boolean(query.data.target),
    retry: false,
  });

  if (query.data?.status === 'active' && query.data.target) {
    if (sessionQuery.isLoading) {
      return <main className="catalog-page"><p role="status">로그인 상태를 확인하고 있습니다.</p></main>;
    }
    if (!sessionQuery.isError && !sessionQuery.data) {
      const returnTo = `${location.pathname}${location.search}${location.hash}`;
      return <Navigate to={`/account?returnTo=${encodeURIComponent(returnTo)}`} replace />;
    }
    if (sessionQuery.data) return <Navigate to={query.data.target.path} replace />;
  }
  const error = query.error instanceof ApiClientError
    ? query.error
    : sessionQuery.error instanceof ApiClientError
      ? sessionQuery.error
      : null;
  const statusContent = query.data && query.data.status !== 'active'
    ? STATUS_CONTENT[query.data.status]
    : null;

  return (
    <main className="catalog-page">
      <header className="catalog-header">
        <p className="react-stack-eyebrow">TEXTBOOK QR</p>
        <h1>교재 QR 연결</h1>
        <p>QR 코드에 연결된 강의를 확인하고 있습니다.</p>
      </header>
      {query.isLoading ? <p role="status">강의 연결 정보를 확인하고 있습니다.</p> : null}
      {statusContent && query.data ? (
        <section className="subscription-callout" role="alert" aria-labelledby="qr-status-title">
          <h2 id="qr-status-title">{statusContent.title}</h2>
          <p>{statusContent.message}</p>
          {query.data.status === 'expired' && query.data.expiresAt ? (
            <p>만료 일시: <time dateTime={query.data.expiresAt}>{formatExpiry(query.data.expiresAt)}</time></p>
          ) : null}
          {query.data.status === 'used' && query.data.remainingClaims !== null ? (
            <p>남은 등록 횟수: <strong>{query.data.remainingClaims}회</strong></p>
          ) : null}
          <Link to={statusContent.action.to}>{statusContent.action.label}</Link>
        </section>
      ) : null}
      {error ? <p className="auth-error" role="alert">{error.message}</p> : null}
      {!query.isLoading && error ? <Link to="/lessons">강의 목록 보기</Link> : null}
    </main>
  );
}
