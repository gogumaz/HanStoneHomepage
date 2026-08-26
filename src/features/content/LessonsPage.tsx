import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { ApiClientError } from '../../lib/api-client';
import { getLessonThumbnail, listEraLessons, listEras, listSubscriptionPlans } from './api';

function queryErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    return `${error.message}${error.requestId ? ` (요청 ID: ${error.requestId})` : ''}`;
  }
  return '네트워크 연결이 불안정합니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.';
}

function LessonThumbnail({ lessonId, title }: { lessonId: string; title: string }) {
  const thumbnailQuery = useQuery({
    queryKey: ['lesson-thumbnail', lessonId],
    queryFn: () => getLessonThumbnail(lessonId),
    staleTime: 4 * 60 * 1000,
    refetchInterval: (query) => {
      const expiresAt = query.state.data?.expiresAt;
      return expiresAt ? Math.max(10_000, Date.parse(expiresAt) - Date.now() - 30_000) : false;
    },
    retry: false,
  });
  if (!thumbnailQuery.data) return <div className="lesson-thumbnail-placeholder" aria-hidden="true" />;
  return <img className="lesson-thumbnail" src={thumbnailQuery.data.url} alt={`${title} 강의 썸네일`} />;
}

export function LessonsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const erasQuery = useQuery({ queryKey: ['eras'], queryFn: listEras, retry: false });
  const plansQuery = useQuery({
    queryKey: ['subscription-plans'],
    queryFn: listSubscriptionPlans,
    retry: false,
  });
  const requestedEraId = searchParams.get('era');
  const selectedEraId = requestedEraId
    && erasQuery.data?.some((era) => era.id === requestedEraId)
    ? requestedEraId
    : erasQuery.data?.[0]?.id ?? '';
  const lessonsQuery = useQuery({
    queryKey: ['era-lessons', selectedEraId],
    queryFn: () => listEraLessons(selectedEraId),
    enabled: Boolean(selectedEraId),
    retry: false,
  });
  const contentError = erasQuery.error ?? lessonsQuery.error;
  const contentRetrying = erasQuery.isFetching || lessonsQuery.isFetching;

  const retryContent = () => {
    if (erasQuery.error) void erasQuery.refetch();
    if (lessonsQuery.error) void lessonsQuery.refetch();
  };

  return (
    <main className="catalog-page">
      <header className="catalog-header">
        <Link className="back-link" to="/">← 개발 현황으로</Link>
        <p className="react-stack-eyebrow">HISTORY JOURNEY</p>
        <h1>시대별 강의 여행</h1>
        <p>공개된 강의만 표시합니다. 강의가 아직 없는 시대는 준비 중으로 안내합니다.</p>
        <Link className="catalog-subscription-link" to="/subscriptions">구독 플랜과 내역 보기 →</Link>
      </header>

      {plansQuery.data?.items.length ? (
        <section className="plan-strip" aria-label="계정 구독 플랜">
          {plansQuery.data.items.map((plan) => (
            <div key={plan.id}>
              <span>{plan.label}{plan.recommended ? ' · 추천' : ''}</span>
              <strong>{plan.price.toLocaleString('ko-KR')}원</strong>
            </div>
          ))}
        </section>
      ) : null}

      {plansQuery.error ? (
        <section className="catalog-network-state catalog-network-state-secondary" role="status">
          <div>
            <strong>구독 플랜은 잠시 후 확인할 수 있습니다.</strong>
            <p>강의 목록은 계속 이용할 수 있습니다.</p>
          </div>
          <button type="button" disabled={plansQuery.isFetching} onClick={() => void plansQuery.refetch()}>
            {plansQuery.isFetching ? '플랜 확인 중…' : '플랜 다시 불러오기'}
          </button>
        </section>
      ) : null}

      {erasQuery.isLoading ? (
        <section className="catalog-loading-state" role="status" aria-live="polite">
          <strong>시대 목록을 불러오고 있습니다.</strong>
          <p>제목과 기본 안내를 먼저 확인할 수 있습니다.</p>
          <span aria-hidden="true" />
        </section>
      ) : null}
      {erasQuery.data ? (
        <nav className="era-tabs" aria-label="시대 선택">
          {erasQuery.data.map((era) => (
            <button
              key={era.id}
              type="button"
              aria-pressed={selectedEraId === era.id}
              onClick={() => setSearchParams({ era: era.id })}
            >
              <span>{era.order}. {era.name}</span>
              <small>{era.totalLessons ? `${era.totalLessons}강` : '준비 중'}</small>
            </button>
          ))}
        </nav>
      ) : null}

      {lessonsQuery.isLoading ? (
        <section className="catalog-loading-state" role="status" aria-live="polite">
          <strong>강의를 불러오고 있습니다.</strong>
          <p>느린 연결에서도 현재 시대 정보는 그대로 유지됩니다.</p>
          <span aria-hidden="true" />
        </section>
      ) : null}

      {lessonsQuery.data ? (
        <section className="era-lessons" aria-labelledby="selected-era-title">
          <div className="era-summary">
            <div>
              <p>{lessonsQuery.data.era.status === 'available' ? '여행 가능' : '준비 중'}</p>
              <h2 id="selected-era-title">{lessonsQuery.data.era.name}</h2>
            </div>
            <div>
              <strong>{lessonsQuery.data.era.theme}</strong>
              <p>{lessonsQuery.data.era.description}</p>
            </div>
          </div>

          {lessonsQuery.data.items.length ? (
            <div className="lesson-grid">
              {lessonsQuery.data.items.map((lesson) => (
                <article className="lesson-card" key={lesson.id}>
                  {lesson.hasThumbnail ? <LessonThumbnail lessonId={lesson.id} title={lesson.title} /> : null}
                  <div className="lesson-card-topline">
                    <span>{lesson.course} · {lesson.order}강</span>
                    <span>{lesson.isFreeSample ? '무료 샘플' : '구독 전용'}</span>
                  </div>
                  <h3>{lesson.title}</h3>
                  <p>{lesson.summary}</p>
                  <dl>
                    <div><dt>난이도</dt><dd>{lesson.difficulty}</dd></div>
                    <div><dt>강사</dt><dd>{lesson.instructor}</dd></div>
                    <div><dt>시간</dt><dd>{lesson.durationMinutes}분</dd></div>
                  </dl>
                  <Link to={`/lessons/${encodeURIComponent(lesson.id)}`}>강의 자세히 보기</Link>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-lessons" role="status">
              <strong>아직 공개된 강의가 없습니다.</strong>
              <p>임시 강의를 표시하지 않고 운영자가 CMS에서 공개할 때까지 기다립니다.</p>
            </div>
          )}
        </section>
      ) : null}

      {contentError ? (
        <section className="catalog-network-state" role="alert">
          <div>
            <strong>강의 정보를 불러오지 못했습니다.</strong>
            <p>{queryErrorMessage(contentError)}</p>
          </div>
          <button type="button" disabled={contentRetrying} onClick={retryContent}>
            {contentRetrying ? '다시 연결 중…' : '강의 목록 다시 불러오기'}
          </button>
        </section>
      ) : null}
    </main>
  );
}
