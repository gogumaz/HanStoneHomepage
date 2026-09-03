import { Component, lazy, Suspense, type ReactNode } from 'react';
import { Link, Route, Routes } from 'react-router-dom';
import { RoleNavigation } from './RoleNavigation';

const AuthPage = lazy(async () => ({
  default: (await import('../features/auth/AuthPage')).AuthPage,
}));
const GuardianPage = lazy(async () => ({
  default: (await import('../features/guardian/GuardianPage')).GuardianPage,
}));
const LessonDetailPage = lazy(async () => ({
  default: (await import('../features/content/LessonDetailPage')).LessonDetailPage,
}));
const LessonsPage = lazy(async () => ({
  default: (await import('../features/content/LessonsPage')).LessonsPage,
}));
const AdminLessonsPage = lazy(async () => ({
  default: (await import('../features/content/AdminLessonsPage')).AdminLessonsPage,
}));
const SubscriptionsPage = lazy(async () => ({
  default: (await import('../features/subscription/SubscriptionsPage')).SubscriptionsPage,
}));
const AdminPaymentsPage = lazy(async () => ({
  default: (await import('../features/subscription/AdminPaymentsPage')).AdminPaymentsPage,
}));
const DashboardPage = lazy(async () => ({
  default: (await import('../features/dashboard/DashboardPage')).DashboardPage,
}));
const MissionPage = lazy(async () => ({
  default: (await import('../features/mission/MissionPage')).MissionPage,
}));
const AdminMissionPage = lazy(async () => ({
  default: (await import('../features/mission/AdminMissionPage')).AdminMissionPage,
}));
const AdminConsultationsPage = lazy(async () => ({
  default: (await import('../features/consultation/AdminConsultationsPage')).AdminConsultationsPage,
}));
const AdminInquiriesPage = lazy(async () => ({
  default: (await import('../features/inquiry/AdminInquiriesPage')).AdminInquiriesPage,
}));
const AdminCommunityReportsPage = lazy(async () => ({
  default: (await import('../features/community/AdminCommunityReportsPage')).AdminCommunityReportsPage,
}));
const NotificationsPage = lazy(async () => ({ default: (await import('../features/notification/NotificationsPage')).NotificationsPage }));
const AdminOperationsPage = lazy(async () => ({ default: (await import('../features/operations/AdminOperationsPage')).AdminOperationsPage }));
const QrPage = lazy(async () => ({ default: (await import('../features/qr/QrPage')).QrPage }));
const OrganizationAdminPage = lazy(async () => ({
  default: (await import('../features/organization/OrganizationAdminPage')).OrganizationAdminPage,
}));
const PrivacyPage = lazy(async () => ({
  default: (await import('../features/legal/PrivacyPage')).PrivacyPage,
}));

type RouteErrorBoundaryProps = {
  children: ReactNode;
};

type RouteErrorBoundaryState = {
  failed: boolean;
};

export class RouteErrorBoundary extends Component<
  RouteErrorBoundaryProps,
  RouteErrorBoundaryState
> {
  state: RouteErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): RouteErrorBoundaryState {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <main className="route-error-page">
          <section className="route-error-card" role="alert" aria-labelledby="route-error-title">
            <p className="route-error-eyebrow">CONNECTION ERROR</p>
            <h1 id="route-error-title">화면을 불러오지 못했습니다.</h1>
            <p>네트워크 상태를 확인한 뒤 최신 화면을 다시 불러와 주세요.</p>
            <button type="button" onClick={() => window.location.reload()}>
              새로고침
            </button>
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}

export function RouteLoading() {
  return (
    <main className="route-loading-page">
      <div className="route-loading-card" role="status" aria-live="polite" aria-busy="true">
        <span className="route-loading-spinner" aria-hidden="true" />
        <p>화면을 불러오고 있습니다…</p>
      </div>
    </main>
  );
}

type StackStatusProps = {
  navigation?: ReactNode;
};

export function StackStatus({ navigation }: StackStatusProps = {}) {
  return (
    <main className="react-stack-page">
      <section className="react-stack-card" aria-labelledby="react-stack-title">
        <p className="react-stack-eyebrow">REACT MIGRATION</p>
        <h1 id="react-stack-title">React 전환 환경이 준비되었습니다.</h1>
        <p>
          현재 정적 프로토타입을 유지하면서 바둑 플레이어와 CMS부터 React와 TypeScript로
          점진적으로 이전합니다.
        </p>
        <dl>
          <div><dt>UI</dt><dd>React + TypeScript</dd></div>
          <div><dt>Build</dt><dd>Vite</dd></div>
          <div><dt>Routing</dt><dd>React Router</dd></div>
          <div><dt>Server state</dt><dd>TanStack Query</dd></div>
        </dl>
        {navigation ?? <RoleNavigation />}
      </section>
    </main>
  );
}

export function App() {
  return (
    <RouteErrorBoundary>
      <Suspense fallback={<RouteLoading />}>
        <Routes>
          <Route path="/account" element={<AuthPage />} />
          <Route path="/guardian" element={<GuardianPage />} />
          <Route path="/lessons" element={<LessonsPage />} />
          <Route path="/lessons/:lessonId" element={<LessonDetailPage />} />
          <Route path="/qr/:code" element={<QrPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/admin/lessons" element={<AdminLessonsPage />} />
          <Route path="/admin/payments" element={<AdminPaymentsPage />} />
          <Route path="/subscriptions" element={<SubscriptionsPage />} />
          <Route path="/missions" element={<MissionPage />} />
          <Route path="/admin/missions" element={<AdminMissionPage />} />
          <Route path="/admin/consultations" element={<AdminConsultationsPage />} />
          <Route path="/admin/inquiries" element={<AdminInquiriesPage />} />
          <Route path="/admin/community-reports" element={<AdminCommunityReportsPage />} />
          <Route path="/admin/operations" element={<AdminOperationsPage />} />
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/organization/admin" element={<OrganizationAdminPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="*" element={<StackStatus />} />
        </Routes>
      </Suspense>
    </RouteErrorBoundary>
  );
}
