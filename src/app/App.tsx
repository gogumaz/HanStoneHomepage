import { Link, Route, Routes } from 'react-router-dom';
import { AuthPage } from '../features/auth/AuthPage';
import { GuardianPage } from '../features/guardian/GuardianPage';
import { LessonDetailPage } from '../features/content/LessonDetailPage';
import { LessonsPage } from '../features/content/LessonsPage';
import { AdminLessonsPage } from '../features/content/AdminLessonsPage';
import { SubscriptionsPage } from '../features/subscription/SubscriptionsPage';
import { AdminPaymentsPage } from '../features/subscription/AdminPaymentsPage';
import { DashboardPage } from '../features/dashboard/DashboardPage';

export function StackStatus() {
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
        <nav aria-label="기존 프로토타입 이동">
          <Link to="/lessons">React 강의 여행</Link>
          <Link to="/dashboard">나의 여행지도</Link>
          <Link to="/admin/lessons">강의 CMS</Link>
          <Link to="/admin/payments">결제 대사 관리</Link>
          <Link to="/subscriptions">계정 구독</Link>
          <Link to="/account">계정 API 확인</Link>
          <Link to="/index.html">기존 홈페이지</Link>
          <Link to="/lecture.html">강의 CMS</Link>
          <Link to="/board.html?type=classHelper">지도자 수업도우미</Link>
        </nav>
      </section>
    </main>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/account" element={<AuthPage />} />
      <Route path="/guardian" element={<GuardianPage />} />
      <Route path="/lessons" element={<LessonsPage />} />
      <Route path="/lessons/:lessonId" element={<LessonDetailPage />} />
      <Route path="/dashboard" element={<DashboardPage />} />
      <Route path="/admin/lessons" element={<AdminLessonsPage />} />
      <Route path="/admin/payments" element={<AdminPaymentsPage />} />
      <Route path="/subscriptions" element={<SubscriptionsPage />} />
      <Route path="*" element={<StackStatus />} />
    </Routes>
  );
}
