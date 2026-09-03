import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { getCurrentUser, type CurrentUser, type UserRole } from '../features/auth/api';

type NavigationItem = {
  label: string;
  to: string;
  authenticated?: boolean;
  roles?: UserRole[];
};

const navigationItems: NavigationItem[] = [
  { label: '강의 여행', to: '/lessons' },
  { label: '바둑미션', to: '/missions' },
  { label: '나의 여행지도', to: '/dashboard', roles: ['student'] },
  { label: '보호자 연결·리포트', to: '/guardian', roles: ['student', 'guardian'] },
  { label: '지도자 수업도우미', to: '/board.html?type=classHelper', roles: ['instructor', 'operator', 'admin'] },
  { label: '기관 라이선스·좌석·환불', to: '/organization/admin', roles: ['organization_admin'] },
  { label: '알림함', to: '/notifications', authenticated: true },
  { label: '계정 구독', to: '/subscriptions', authenticated: true },
  { label: '강의 CMS', to: '/admin/lessons', roles: ['operator', 'admin'] },
  { label: '결제 대사 관리', to: '/admin/payments', roles: ['operator', 'admin'] },
  { label: '바둑문제 입력기', to: '/admin/missions', roles: ['operator', 'admin'] },
  { label: '기관 상담 관리', to: '/admin/consultations', roles: ['operator', 'admin'] },
  { label: '1:1 문의 관리', to: '/admin/inquiries', roles: ['operator', 'admin'] },
  { label: '커뮤니티 신고함', to: '/admin/community-reports', roles: ['operator', 'admin'] },
  { label: '운영 워커 상태', to: '/admin/operations', roles: ['operator', 'admin'] },
  { label: '로그인·계정', to: '/account' },
  { label: '기존 홈페이지', to: '/index.html' },
];

export function getNavigationItems(user: CurrentUser | null): NavigationItem[] {
  return navigationItems.filter((item) => {
    if (item.roles) {
      return Boolean(user?.roles.some((role) => item.roles?.includes(role)));
    }
    return !item.authenticated || Boolean(user);
  });
}

export function RoleNavigation() {
  const meQuery = useQuery({
    queryKey: ['current-user'],
    queryFn: getCurrentUser,
    retry: false,
  });
  const items = getNavigationItems(meQuery.data ?? null);

  return (
    <section className="role-navigation" aria-labelledby="role-navigation-title">
      <div className="role-navigation-heading">
        <h2 id="role-navigation-title">내 서비스 메뉴</h2>
        {meQuery.isLoading ? <span role="status">권한 확인 중…</span> : null}
        {!meQuery.isLoading && meQuery.data ? <span>{meQuery.data.displayName}님</span> : null}
      </div>
      <nav aria-label="역할별 서비스 메뉴">
        {items.map((item) => <Link key={item.to} to={item.to}>{item.label}</Link>)}
      </nav>
      {meQuery.isError ? <p className="auth-error" role="alert">계정별 메뉴를 불러오지 못했습니다. 공용 메뉴만 표시합니다.</p> : null}
    </section>
  );
}
