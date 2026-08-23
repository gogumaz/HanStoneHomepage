import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { getCurrentUser } from '../auth/api';
import { ApiClientError } from '../../lib/api-client';
import { getStudentDashboard } from './api';

const ERA_STATUS_LABELS = {
  coming_soon: '준비 중',
  not_started: '출발 전',
  in_progress: '여행 중',
  completed: '완료',
};

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleDateString('ko-KR') : '아직 없음';
}

export function DashboardPage() {
  const meQuery = useQuery({ queryKey: ['current-user'], queryFn: getCurrentUser, retry: false });
  const isStudent = meQuery.data?.roles.includes('student') ?? false;
  const dashboardQuery = useQuery({
    queryKey: ['student-dashboard'],
    queryFn: getStudentDashboard,
    enabled: isStudent,
    retry: false,
  });
  const errors = [meQuery.error, dashboardQuery.error];
  const error = errors.find((item): item is ApiClientError => item instanceof ApiClientError);
  const dashboard = dashboardQuery.data;

  return (
    <main className="catalog-page dashboard-page">
      <header className="catalog-header">
        <Link className="back-link" to="/lessons">← 시대별 강의로</Link>
        <p className="react-stack-eyebrow">MY HISTORY JOURNEY</p>
        <h1>나의 여행지도</h1>
        <p>완료한 강의와 시대별 여정을 실제 학습 기록으로 확인합니다.</p>
      </header>

      {meQuery.isLoading ? <p role="status">학생 계정을 확인하고 있습니다.</p> : null}
      {!meQuery.isLoading && !meQuery.data ? (
        <section className="subscription-callout">
          <h2>로그인이 필요합니다.</h2>
          <p>로그인하면 저장된 진도와 다음 여행을 확인할 수 있습니다.</p>
          <Link to="/account">로그인하기</Link>
        </section>
      ) : null}
      {meQuery.data && !isStudent ? (
        <section className="subscription-callout">
          <h2>학생 계정 전용 화면입니다.</h2>
          <p>보호자는 보호자 연결 관리에서 학생의 학습 리포트를 확인해 주세요.</p>
          <Link to="/guardian">보호자 학습 리포트</Link>
        </section>
      ) : null}
      {dashboardQuery.isLoading ? <p role="status">여행지도를 만들고 있습니다.</p> : null}

      {dashboard ? (
        <>
          <section className="dashboard-hero" aria-labelledby="dashboard-student-title">
            <div>
              <p className="react-stack-eyebrow">탐험가</p>
              <h2 id="dashboard-student-title">{dashboard.student.displayName}님의 한국사 여행</h2>
              <p>최근 학습: {formatDate(dashboard.summary.lastActivityAt)}</p>
            </div>
            <div className="dashboard-access" data-active={dashboard.access.hasActiveSubscription}>
              <strong>{dashboard.access.hasActiveSubscription ? '전체 강의 이용 중' : '무료 강의 이용 중'}</strong>
              <span>{dashboard.access.subscriptionEndsAt
                ? `${formatDate(dashboard.access.subscriptionEndsAt)}까지`
                : '구독하면 모든 공개 강의를 이용할 수 있어요.'}</span>
              {!dashboard.access.hasActiveSubscription ? <Link to="/subscriptions">구독 플랜 보기</Link> : null}
            </div>
          </section>

          {dashboard.nextLesson ? (
            <section className="dashboard-next" aria-labelledby="dashboard-next-title">
              <div>
                <p>{dashboard.nextLesson.reason === 'continue' ? '이어서 여행하기' : '다음 여행지'}</p>
                <h2 id="dashboard-next-title">{dashboard.nextLesson.lesson.title}</h2>
                <span>{dashboard.nextLesson.lesson.era.name} · {dashboard.nextLesson.lesson.order}강 · {dashboard.nextLesson.lesson.durationMinutes}분</span>
              </div>
              <div>
                <strong>{dashboard.nextLesson.progress.completedSteps} / {dashboard.nextLesson.progress.totalSteps}단계</strong>
                <Link to={`/lessons/${encodeURIComponent(dashboard.nextLesson.lesson.id)}`}>
                  {dashboard.nextLesson.reason === 'continue' ? '학습 이어가기' : '강의 시작하기'}
                </Link>
              </div>
            </section>
          ) : (
            <section className="dashboard-next complete">
              <div><p>현재 여정 완료</p><h2>이용 가능한 강의를 모두 여행했습니다.</h2></div>
              <Link to="/lessons">전체 강의 보기</Link>
            </section>
          )}

          <section className="dashboard-summary" aria-label="전체 학습 요약">
            <div><span>완료 강의</span><strong>{dashboard.summary.completedLessons} / {dashboard.summary.totalLessons}</strong></div>
            <div><span>시작한 강의</span><strong>{dashboard.summary.startedLessons}개</strong></div>
            <div><span>완료 단계</span><strong>{dashboard.summary.completedSteps} / {dashboard.summary.totalSteps}</strong></div>
            <div><span>단계 진행률</span><strong>{dashboard.summary.stepCompletionRate}%</strong></div>
          </section>

          <section className="dashboard-progress" aria-labelledby="dashboard-progress-title">
            <div><h2 id="dashboard-progress-title">전체 여정 진행률</h2><strong>{dashboard.summary.completionRate}%</strong></div>
            <progress max="100" value={dashboard.summary.completionRate}>{dashboard.summary.completionRate}%</progress>
          </section>

          <section className="dashboard-eras" aria-labelledby="dashboard-eras-title">
            <h2 id="dashboard-eras-title">시대별 여행지도</h2>
            <div>{dashboard.eras.map((era) => (
              <article key={era.id} data-status={era.status}>
                <span>{String(era.order).padStart(2, '0')}</span>
                <div>
                  <small>{ERA_STATUS_LABELS[era.status]}</small>
                  <h3>{era.name}</h3>
                  <strong>{era.theme}</strong>
                  <p>{era.totalLessons ? `${era.completedLessons} / ${era.totalLessons}강 완료` : era.description}</p>
                  {era.totalLessons ? <progress max="100" value={era.completionRate}>{era.completionRate}%</progress> : null}
                </div>
                {era.totalLessons ? <Link to={`/lessons?era=${encodeURIComponent(era.id)}`}>강의 보기</Link> : null}
              </article>
            ))}</div>
          </section>

          <section className="dashboard-recent" aria-labelledby="dashboard-recent-title">
            <h2 id="dashboard-recent-title">최근 학습</h2>
            {dashboard.recentLessons.length ? (
              <ul>{dashboard.recentLessons.map((item) => (
                <li key={item.lesson.id}>
                  <div><small>{item.lesson.era.name}</small><strong>{item.lesson.title}</strong><span>{formatDate(item.progress.lastActivityAt)}</span></div>
                  <div><b>{item.progress.status === 'completed' ? '완료' : '학습 중'}</b><span>{item.progress.completedSteps} / {item.progress.totalSteps}단계</span><Link to={`/lessons/${encodeURIComponent(item.lesson.id)}`}>열기</Link></div>
                </li>
              ))}</ul>
            ) : <p>아직 시작한 강의가 없습니다. 추천 강의에서 첫 여행을 시작해 보세요.</p>}
          </section>
        </>
      ) : null}

      {error ? <p className="auth-error" role="alert">{error.message}{error.requestId ? ` (요청 ID: ${error.requestId})` : ''}</p> : null}
    </main>
  );
}
