import { useQuery } from '@tanstack/react-query';
import { getCurrentUser } from '../auth/api';
import { getOrganizationAdminContext } from './api';

const permissionLabels = {
  license: '기관 라이선스 조회·관리',
  seats: '기관 좌석 조회·관리',
  refunds: '기관 환불 조회·요청',
} as const;

export function OrganizationAdminPage() {
  const meQuery = useQuery({ queryKey: ['current-user'], queryFn: getCurrentUser, retry: false });
  const canManage = meQuery.data?.roles.includes('organization_admin') ?? false;
  const contextQuery = useQuery({
    queryKey: ['organization-admin-context'],
    queryFn: getOrganizationAdminContext,
    enabled: canManage,
    retry: false,
  });

  if (meQuery.isLoading) {
    return <main className="react-stack-page"><p role="status">기관 관리자 권한을 확인하고 있습니다…</p></main>;
  }
  if (!canManage) {
    return (
      <main className="react-stack-page">
        <section className="react-stack-card" role="alert">
          <h1>기관 관리 권한이 없습니다.</h1>
          <p>일반 지도자는 기관 라이선스·좌석·환불 메뉴를 이용할 수 없습니다.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="react-stack-page">
      <section className="react-stack-card" aria-labelledby="organization-admin-title">
        <p className="react-stack-eyebrow">ORGANIZATION ADMIN</p>
        <h1 id="organization-admin-title">기관 라이선스·좌석·환불 관리</h1>
        <p>활성 기관 관리자 멤버십 범위에서만 관리 권한이 제공됩니다.</p>
        {contextQuery.isLoading ? <p role="status">기관 권한을 불러오고 있습니다…</p> : null}
        {contextQuery.isError ? <p className="auth-error" role="alert">활성 기관 관리자 멤버십을 확인할 수 없습니다.</p> : null}
        {contextQuery.data?.items.map((item) => (
          <article key={item.membershipId}>
            <h2>{item.organization.name}</h2>
            <ul>
              {(Object.keys(permissionLabels) as Array<keyof typeof permissionLabels>).map((key) => (
                <li key={key}>{permissionLabels[key]}</li>
              ))}
            </ul>
            <p>결제 취소 실행은 운영자 또는 관리자에게 요청 후 처리됩니다.</p>
          </article>
        ))}
      </section>
    </main>
  );
}
