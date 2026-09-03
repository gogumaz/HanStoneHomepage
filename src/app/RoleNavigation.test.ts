import { describe, expect, it } from 'vitest';
import { getNavigationItems } from './RoleNavigation';
import type { CurrentUser, UserRole } from '../features/auth/api';

function labelsFor(...roles: UserRole[]) {
  const user: CurrentUser = {
    id: 'user-1',
    email: 'user@example.test',
    emailVerified: true,
    displayName: '테스트 사용자',
    roles,
  };
  return getNavigationItems(user).map((item) => item.label);
}

describe('role navigation policy', () => {
  it('keeps authenticated and role-only menus hidden from signed-out visitors', () => {
    const labels = getNavigationItems(null).map((item) => item.label);

    expect(labels).toEqual(['강의 여행', '바둑미션', '로그인·계정', '기존 홈페이지']);
  });

  it('shows only student learning and guardian-link menus to students', () => {
    const labels = labelsFor('student');

    expect(labels).toContain('나의 여행지도');
    expect(labels).toContain('보호자 연결·리포트');
    expect(labels).not.toContain('지도자 수업도우미');
    expect(labels).not.toContain('강의 CMS');
  });

  it('shows guardian reports without student or administration menus to guardians', () => {
    const labels = labelsFor('guardian');

    expect(labels).toContain('보호자 연결·리포트');
    expect(labels).not.toContain('나의 여행지도');
    expect(labels).not.toContain('지도자 수업도우미');
    expect(labels).not.toContain('강의 CMS');
  });

  it('shows the class helper without operator administration to instructors', () => {
    const labels = labelsFor('instructor');

    expect(labels).toContain('지도자 수업도우미');
    expect(labels).not.toContain('나의 여행지도');
    expect(labels).not.toContain('강의 CMS');
    expect(labels).not.toContain('기관 라이선스·좌석·환불');
  });

  it('shows institution management without instructor or operator menus to organization admins', () => {
    const labels = labelsFor('organization_admin');

    expect(labels).toContain('기관 라이선스·좌석·환불');
    expect(labels).not.toContain('지도자 수업도우미');
    expect(labels).not.toContain('결제 대사 관리');
  });

  it('shows every operations menu to operators and administrators', () => {
    for (const role of ['operator', 'admin'] as const) {
      const labels = labelsFor(role);
      expect(labels).toContain('강의 CMS');
      expect(labels).toContain('결제 대사 관리');
      expect(labels).toContain('운영 워커 상태');
    }
  });
});
