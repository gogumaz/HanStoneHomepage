import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { ApiClientError } from '../../lib/api-client';
import { GoBoard } from './GoBoard';
import {
  addMissionFavorite,
  getMission,
  getMissionAttempt,
  listMissions,
  removeMissionFavorite,
  retryMission,
  startMissionAttempt,
  submitMissionMove,
  useMissionHint,
  type BoardState,
  type MissionAttempt,
  type MissionSummary,
  type MissionFilters,
  type Point,
} from './api';

export function MissionPage() {
  const [searchParams] = useSearchParams();
  const linkedLessonId = searchParams.get('lessonId')?.trim() ?? '';
  const linkedMissionId = searchParams.get('missionId')?.trim() || null;
  const queryClient = useQueryClient();
  const [boardSize, setBoardSize] = useState<0 | 9 | 13 | 19>(0);
  const [filterDraft, setFilterDraft] = useState({ q: '', level: '', volume: '', lessonNumber: '', category: '', problemGroup: '', missionType: '', difficulty: '', progress: '', favorite: false });
  const [appliedFilters, setAppliedFilters] = useState(filterDraft);
  const [selectedId, setSelectedId] = useState<string | null>(linkedMissionId);
  const queryFilters = useMemo<MissionFilters>(() => ({
    ...(boardSize ? { boardSize } : {}),
    ...(appliedFilters.q.trim() ? { q: appliedFilters.q.trim() } : {}),
    ...(appliedFilters.level ? { level: appliedFilters.level } : {}),
    ...(appliedFilters.volume ? { volume: Number(appliedFilters.volume) } : {}),
    ...(appliedFilters.lessonNumber ? { lessonNumber: Number(appliedFilters.lessonNumber) } : {}),
    ...(appliedFilters.category ? { category: appliedFilters.category } : {}),
    ...(appliedFilters.problemGroup ? { problemGroup: appliedFilters.problemGroup } : {}),
    ...(appliedFilters.missionType ? { missionType: appliedFilters.missionType } : {}),
    ...(appliedFilters.difficulty ? { difficulty: Number(appliedFilters.difficulty) } : {}),
    ...(appliedFilters.progress ? { progress: appliedFilters.progress as MissionFilters['progress'] } : {}),
    ...(appliedFilters.favorite ? { favorite: true } : {}),
    ...(linkedLessonId ? { lessonId: linkedLessonId } : {}),
  }), [appliedFilters, boardSize, linkedLessonId]);
  const missionsQuery = useQuery({
    queryKey: ['missions', queryFilters],
    queryFn: () => listMissions(queryFilters),
  });
  const selectedMission = missionsQuery.data?.items.find((mission) => mission.id === selectedId) ?? null;

  useEffect(() => setSelectedId(linkedMissionId), [linkedMissionId]);

  const restoreCardFocus = useCallback((id: string) => {
    window.setTimeout(() => document.querySelector<HTMLElement>(`[data-mission-card="${id}"]`)?.focus(), 0);
  }, []);
  const closeMission = useCallback(() => {
    if (!selectedId) return;
    if (window.history.state?.badukMissionDialog === selectedId) {
      window.history.back();
      return;
    }
    const id = selectedId;
    setSelectedId(null);
    restoreCardFocus(id);
  }, [restoreCardFocus, selectedId]);
  const openMission = useCallback((id: string) => {
    window.history.pushState({ ...window.history.state, badukMissionDialog: id }, '');
    setSelectedId(id);
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    const closeOnBack = () => {
      const id = selectedId;
      setSelectedId(null);
      restoreCardFocus(id);
    };
    window.addEventListener('popstate', closeOnBack);
    return () => window.removeEventListener('popstate', closeOnBack);
  }, [restoreCardFocus, selectedId]);
  const favoriteMutation = useMutation({
    mutationFn: ({ id, isFavorite }: { id: string; isFavorite: boolean }) => isFavorite
      ? removeMissionFavorite(id) : addMissionFavorite(id),
    onMutate: async ({ id, isFavorite }) => {
      await queryClient.cancelQueries({ queryKey: ['missions'] });
      queryClient.setQueryData<{ items: MissionSummary[] }>(['missions', queryFilters], (current) => current ? {
        items: current.items.map((mission) => mission.id === id ? { ...mission, isFavorite: !isFavorite } : mission),
      } : current);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['missions'] }),
  });

  return (
    <main className="mission-page">
      <header className="mission-hero">
        <div>
          <Link className="back-link" to="/">← 개발 현황으로</Link>
          <p className="react-stack-eyebrow">BADUK MISSION</p>
          <h1>판 위에서 직접 푸는 바둑미션</h1>
          <p>9·13·19줄 문제를 선택하고 교차점에 직접 착수해 보세요. 정답은 서버가 바둑 규칙과 등록 수순으로 판정합니다.</p>
        </div>
        <Link className="mission-admin-link" to="/admin/missions">문제 입력기</Link>
      </header>

      <nav className="mission-filters" aria-label="판 크기 필터">
        {([0, 9, 13, 19] as const).map((size) => (
          <button key={size} type="button" aria-pressed={boardSize === size} onClick={() => setBoardSize(size)}>
            {size === 0 ? '전체' : `${size}줄`}
          </button>
        ))}
      </nav>

      {linkedLessonId ? <p className="mission-linked-context">강의 {linkedLessonId}에 연결된 바둑미션입니다. <Link to="/missions">전체 미션 보기</Link></p> : null}

      <form className="mission-search-filters" aria-label="바둑미션 상세 검색" onSubmit={(event) => { event.preventDefault(); setAppliedFilters(filterDraft); }}>
        <label className="mission-search-field">검색어<input value={filterDraft.q} maxLength={80} onChange={(event) => setFilterDraft({ ...filterDraft, q: event.target.value })} placeholder="제목·지시문·카테고리" /></label>
        <label>과정<select value={filterDraft.level} onChange={(event) => setFilterDraft({ ...filterDraft, level: event.target.value })}><option value="">전체</option><option>입문</option><option>기초</option><option>기본</option></select></label>
        <label>권<input type="number" min="1" max="6" value={filterDraft.volume} onChange={(event) => setFilterDraft({ ...filterDraft, volume: event.target.value })} /></label>
        <label>강<input type="number" min="1" max="8" value={filterDraft.lessonNumber} onChange={(event) => setFilterDraft({ ...filterDraft, lessonNumber: event.target.value })} /></label>
        <label>문제군<select value={filterDraft.problemGroup} onChange={(event) => setFilterDraft({ ...filterDraft, problemGroup: event.target.value })}><option value="">전체</option><option>개념 확인</option><option>반복 훈련</option><option>도전</option></select></label>
        <label>카테고리<select value={filterDraft.category} onChange={(event) => setFilterDraft({ ...filterDraft, category: event.target.value })}><option value="">전체</option><option>따내기</option><option>포석</option><option>연결</option><option>끊기</option><option>사활</option></select></label>
        <label>유형<select value={filterDraft.missionType} onChange={(event) => setFilterDraft({ ...filterDraft, missionType: event.target.value })}><option value="">전체</option><option value="best_move">최선의 수</option><option value="capture">따내기</option><option value="escape">살리기</option><option value="life_and_death">사활</option></select></label>
        <label>난이도<select value={filterDraft.difficulty} onChange={(event) => setFilterDraft({ ...filterDraft, difficulty: event.target.value })}><option value="">전체</option>{[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
        <label>풀이 상태<select value={filterDraft.progress} onChange={(event) => setFilterDraft({ ...filterDraft, progress: event.target.value })}><option value="">전체</option><option value="not_started">미시작</option><option value="in_progress">진행 중</option><option value="completed">완료</option><option value="failed">실패</option></select></label>
        <label className="mission-favorite-filter"><input type="checkbox" checked={filterDraft.favorite} onChange={(event) => setFilterDraft({ ...filterDraft, favorite: event.target.checked })} /> 즐겨찾기만</label>
        <div className="mission-filter-actions"><button type="submit">검색 적용</button><button type="button" onClick={() => { const empty = { q: '', level: '', volume: '', lessonNumber: '', category: '', problemGroup: '', missionType: '', difficulty: '', progress: '', favorite: false }; setFilterDraft(empty); setAppliedFilters(empty); setBoardSize(0); }}>초기화</button></div>
      </form>

      {missionsQuery.isLoading ? <p role="status">바둑미션을 불러오고 있습니다.</p> : null}
      {[missionsQuery.error, favoriteMutation.error].find((error) => error instanceof ApiClientError) instanceof ApiClientError ? <p className="auth-error" role="alert">{([missionsQuery.error, favoriteMutation.error].find((error) => error instanceof ApiClientError) as ApiClientError).message}</p> : null}
      <section className="mission-card-grid" aria-label="바둑미션 목록">
        {missionsQuery.data?.items.map((mission) => (
          <MissionCard key={mission.id} mission={mission} onOpen={() => openMission(mission.id)} onToggleFavorite={() => favoriteMutation.mutate({ id: mission.id, isFavorite: Boolean(mission.isFavorite) })} favoritePending={favoriteMutation.isPending && favoriteMutation.variables?.id === mission.id} />
        ))}
      </section>
      {!missionsQuery.isLoading && missionsQuery.data?.items.length === 0 ? <p className="mission-empty">조건에 맞는 바둑미션이 없습니다.</p> : null}

      {selectedMission ? (
        <MissionDialog
          summary={selectedMission}
          source={linkedLessonId ? 'lesson' : 'mission_list'}
          onClose={closeMission}
        />
      ) : null}
    </main>
  );
}

function MissionCard({ mission, onOpen, onToggleFavorite, favoritePending }: { mission: MissionSummary; onOpen: () => void; onToggleFavorite: () => void; favoritePending: boolean }) {
  const board = useMemo(() => initialBoard(mission), [mission]);
  return (
    <article className="mission-card">
      <div className="mission-card-board" aria-hidden="true">
        <GoBoard board={board} disabled showCoordinates={false} />
      </div>
      <div className="mission-card-copy">
        <button type="button" className="mission-favorite-button" aria-pressed={mission.isFavorite} aria-label={mission.isFavorite ? `${mission.title} 즐겨찾기 해제` : `${mission.title} 즐겨찾기 추가`} onClick={onToggleFavorite} disabled={favoritePending}>{mission.isFavorite ? '★' : '☆'}</button>
        <div className="mission-badges">
          <span>{mission.boardSize}줄</span><span>난이도 {mission.difficulty}</span>
          <span>{mission.isFreeSample ? '무료 샘플' : '구독 전용'}</span>
          <span>완료 별 {mission.reward.quantity}</span>
        </div>
        <h2>{mission.title}</h2>
        <p>{mission.level} {mission.volume}권 {mission.lessonNumber}강 · {mission.problemGroup}</p>
        <p>{mission.instruction}</p>
        <button type="button" data-mission-card={mission.id} onClick={onOpen}>
          {mission.progress?.status === 'in_progress' ? '이어하기' : mission.progress ? '다시 풀기' : '시작하기'}
        </button>
      </div>
    </article>
  );
}

function MissionDialog({ summary, source, onClose }: { summary: MissionSummary; source: string; onClose: () => void }) {
  const dialogRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const startRequestIdRef = useRef<string | null>(null);
  const moveRequestIdRef = useRef<string | null>(null);
  const [resumeAttemptId] = useState(() => readStoredAttemptId(summary.id));
  const detailQuery = useQuery({
    queryKey: ['mission', summary.id, resumeAttemptId],
    queryFn: () => getMission(summary.id, resumeAttemptId),
  });
  const [attempt, setAttempt] = useState<MissionAttempt | null>(null);
  const [pendingPoint, setPendingPoint] = useState<Point | null>(null);
  const [feedback, setFeedback] = useState('교차점을 선택한 뒤 정답 확인을 눌러 주세요.');
  const [explanation, setExplanation] = useState<string | null>(null);
  const [hintText, setHintText] = useState<string | null>(null);
  const [hintPoint, setHintPoint] = useState<Point | null>(null);
  const [rewardText, setRewardText] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [clock, setClock] = useState(Date.now());
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [recoveryMessage, setRecoveryMessage] = useState<string | null>(null);
  const mission = detailQuery.data?.mission ?? summary;

  useEffect(() => {
    if (!detailQuery.data?.attempt) return;
    setAttempt(detailQuery.data.attempt);
    storeAttemptId(summary.id, detailQuery.data.attempt.id);
    if (resumeAttemptId) {
      setFeedback('중단했던 문제풀이를 서버의 최신 상태로 이어갑니다.');
      setRecoveryMessage('재접속이 완료되었습니다.');
    }
  }, [detailQuery.data?.attempt]);
  useEffect(() => {
    const handleOffline = () => setIsOnline(false);
    const handleOnline = async () => {
      setIsOnline(true);
      try {
        if (attempt) {
          const latest = await getMissionAttempt(attempt.id);
          setAttempt(latest.attempt);
          setPendingPoint(null);
          moveRequestIdRef.current = null;
          setFeedback('네트워크 복구 후 서버의 최신 진행 상태를 불러왔습니다.');
          setRecoveryMessage('온라인 재접속이 완료되었습니다.');
        } else {
          await detailQuery.refetch();
        }
      } catch {
        setRecoveryMessage('온라인 상태로 돌아왔지만 진행 상태 동기화에 실패했습니다.');
      }
    };
    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);
    return () => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  }, [attempt?.id]);
  useEffect(() => {
    if (!attempt || attempt.status !== 'in_progress' || mission.timeLimitSeconds === null) return;
    setClock(Date.now());
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [attempt?.id, attempt?.status, mission.timeLimitSeconds]);
  useEffect(() => {
    titleRef.current?.focus();
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )].filter((element) => !element.hasAttribute('hidden'));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialogRef.current.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const startMutation = useMutation({
    mutationFn: () => {
      startRequestIdRef.current ||= `attempt_${crypto.randomUUID().replaceAll('-', '')}`;
      return startMissionAttempt(summary.id, source, startRequestIdRef.current);
    },
    onSuccess: (result) => {
      startRequestIdRef.current = null;
      setAttempt(result.attempt);
      storeAttemptId(summary.id, result.attempt.id);
      setPendingPoint(null);
      setRecoveryMessage(null);
      setFeedback('문제를 시작했습니다. 교차점에 돌을 놓아 보세요.');
    },
  });
  const moveMutation = useMutation({
    mutationFn: () => {
      if (!attempt || !pendingPoint) throw new Error('move_not_ready');
      moveRequestIdRef.current ||= `move_${crypto.randomUUID().replaceAll('-', '')}`;
      return submitMissionMove(attempt, pendingPoint, moveRequestIdRef.current);
    },
    onSuccess: (result) => {
      if (!attempt) return;
      moveRequestIdRef.current = null;
      setAttempt({
        ...attempt,
        status: result.status,
        boardState: result.boardState,
        boardHash: result.boardHash,
        moveCount: result.moveCount,
        wrongMoveCount: result.wrongMoveCount,
        attemptCount: result.attemptCount,
        score: result.score,
      });
      setPendingPoint(null);
      setRecoveryMessage(null);
      if (result.status !== 'in_progress') removeStoredAttemptId(summary.id, attempt.id);
      setFeedback(result.feedback);
      setExplanation(result.explanation);
      setRewardText(result.reward
        ? `${result.reward.title} ${result.reward.quantity}개를 ${result.reward.newlyGranted ? '받았습니다.' : '이미 받았습니다.'}`
        : null);
    },
    onError: async (failure) => {
      if (!(failure instanceof ApiClientError) || !attempt
        || !['MISSION_STATE_CONFLICT', 'MISSION_ATTEMPT_FINISHED'].includes(failure.code)) return;
      try {
        const latest = await getMissionAttempt(attempt.id);
        setAttempt(latest.attempt);
        setPendingPoint(null);
        moveRequestIdRef.current = null;
        setFeedback('서버에서 최신 판 상태를 불러왔습니다. 이어서 진행해 주세요.');
        setRecoveryMessage('다른 요청에서 반영된 진행 상태로 자동 복구했습니다.');
        if (latest.attempt.status !== 'in_progress') removeStoredAttemptId(summary.id, attempt.id);
      } catch {
        setRecoveryMessage('최신 진행 상태를 자동으로 불러오지 못했습니다. 다시 접속해 주세요.');
      }
    },
  });
  const hintMutation = useMutation({
    mutationFn: () => {
      if (!attempt) throw new Error('attempt_not_ready');
      return useMissionHint(attempt.id);
    },
    onSuccess: (result) => {
      setAttempt((current) => current ? { ...current, hintLevel: result.hintLevel, score: result.score } : current);
      if (typeof result.hint === 'string') {
        setHintText(result.hint);
        setHintPoint(null);
      } else if (isPoint(result.hint)) {
        setHintText(`${coordinateLabel(result.hint, summary.boardSize)} 교차점을 살펴보세요.`);
        setHintPoint(result.hint);
      }
    },
  });
  const retryMutation = useMutation({
    mutationFn: () => {
      if (!attempt) throw new Error('attempt_not_ready');
      return retryMission(attempt.id);
    },
    onSuccess: (result) => {
      setAttempt(result.attempt);
      storeAttemptId(summary.id, result.attempt.id);
      setPendingPoint(null);
      moveRequestIdRef.current = null;
      setExplanation(null);
      setRewardText(null);
      setFeedback('처음 판으로 돌아왔습니다. 다시 도전해 보세요.');
    },
  });

  const board = attempt?.boardState ?? initialBoard(mission);
  const remainingSeconds = attempt && mission.timeLimitSeconds !== null
    ? Math.max(0, mission.timeLimitSeconds - Math.floor((clock - new Date(attempt.startedAt).getTime()) / 1_000))
    : null;
  const occupied = pendingPoint && board.stones.some((stone) => stone.x === pendingPoint.x && stone.y === pendingPoint.y);
  const error = [startMutation.error, moveMutation.error, hintMutation.error, retryMutation.error, detailQuery.error]
    .find((item) => item instanceof ApiClientError
      && !(item === moveMutation.error && recoveryMessage
        && ['MISSION_STATE_CONFLICT', 'MISSION_ATTEMPT_FINISHED'].includes(item.code))) as ApiClientError | undefined;

  return (
    <div className="mission-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={dialogRef} className="mission-dialog" role="dialog" aria-modal="true" aria-labelledby="mission-dialog-title">
        <header>
          <div>
            <p>{mission.level} {mission.volume}권 {mission.lessonNumber}강 · {mission.boardSize}줄</p>
            <h2 ref={titleRef} id="mission-dialog-title" tabIndex={-1}>{mission.title}</h2>
          </div>
          <button type="button" className="dialog-close" aria-label="바둑미션 닫기" onClick={onClose}>×</button>
        </header>
        <div className="mission-player-layout">
          <div className="mission-board-panel">
            <div className="board-zoom-controls" aria-label="바둑판 확대 조절">
              <button type="button" onClick={() => setZoom((value) => Math.max(0.8, value - 0.2))}>−</button>
              <button type="button" onClick={() => setZoom(1)}>화면 맞춤</button>
              <button type="button" onClick={() => setZoom((value) => Math.min(1.8, value + 0.2))}>＋</button>
            </div>
            <div className="mission-board-scale" style={{ width: `${zoom * 100}%` }}>
              <GoBoard
                board={board}
                pendingPoint={pendingPoint}
                pendingColor={mission.playerColor}
                hintPoint={hintPoint}
                disabled={!attempt || attempt.status !== 'in_progress' || moveMutation.isPending}
                onPointSelect={(point) => {
                  if (board.stones.some((stone) => stone.x === point.x && stone.y === point.y)) {
                    setFeedback('이미 돌이 놓인 자리입니다.');
                    return;
                  }
                  moveRequestIdRef.current = null;
                  setPendingPoint(point);
                  setFeedback(`${coordinateLabel(point, board.size)}에 둘 예정입니다. 정답 확인을 눌러 주세요.`);
                }}
              />
            </div>
          </div>
          <aside className="mission-problem-panel">
            {!isOnline ? <p className="mission-reconnect-status" role="status">오프라인입니다. 연결이 복구되면 최신 진행 상태를 자동으로 불러옵니다.</p> : null}
            {recoveryMessage ? <p className="mission-reconnect-status" role="status">{recoveryMessage}</p> : null}
            <div className="mission-badges"><span>{mission.playerColor === 'black' ? '흑' : '백'} 선수</span><span>{mission.category}</span></div>
            <h3>문제</h3>
            <p>{mission.instruction}</p>
            {!attempt ? (
              <button type="button" onClick={() => startMutation.mutate()} disabled={!isOnline || startMutation.isPending || detailQuery.isLoading}>
                {startMutation.isPending ? '준비 중…' : '문제 시작'}
              </button>
            ) : (
              <>
                <dl className="mission-stats">
                  <div><dt>점수</dt><dd>{attempt.score}</dd></div>
                  <div><dt>오답</dt><dd>{attempt.wrongMoveCount}</dd></div>
                  <div><dt>힌트</dt><dd>{attempt.hintLevel}</dd></div>
                  <div><dt>흑이 잡은 돌</dt><dd>{board.captures?.black ?? 0}</dd></div>
                  <div><dt>백이 잡은 돌</dt><dd>{board.captures?.white ?? 0}</dd></div>
                  {remainingSeconds !== null ? <div><dt>남은 시간</dt><dd>{remainingSeconds}초</dd></div> : null}
                </dl>
                <div className="mission-feedback" role="status"><p>{feedback}</p>{hintText ? <p>힌트: {hintText}</p> : null}{explanation ? <p><strong>해설:</strong> {explanation}</p> : null}{rewardText ? <p><strong>보상:</strong> {rewardText}</p> : null}</div>
                {attempt.status === 'in_progress' ? (
                  <div className="mission-controls">
                    <button type="button" onClick={() => { moveRequestIdRef.current = null; setPendingPoint(null); }} disabled={!pendingPoint}>현재 착수 되돌리기</button>
                    <button type="button" onClick={() => hintMutation.mutate()} disabled={!isOnline || hintMutation.isPending}>힌트 보기</button>
                    <button type="button" onClick={() => moveMutation.mutate()} disabled={!isOnline || !pendingPoint || Boolean(occupied) || moveMutation.isPending}>
                      {moveMutation.isPending ? '판정 중…' : '정답 확인'}
                    </button>
                  </div>
                ) : (
                  <button type="button" onClick={() => retryMutation.mutate()} disabled={!isOnline || retryMutation.isPending}>처음부터 다시 풀기</button>
                )}
              </>
            )}
            {error ? <p className="auth-error" role="alert">{error.message}</p> : null}
          </aside>
        </div>
      </section>
    </div>
  );
}

function initialBoard(mission: MissionSummary): BoardState {
  return {
    size: mission.boardSize,
    stones: [
      ...(mission.initialBlackStones ?? []).map((point) => ({ ...point, color: 'black' as const })),
      ...(mission.initialWhiteStones ?? []).map((point) => ({ ...point, color: 'white' as const })),
    ],
    previousPositionHash: null,
    lastMove: null,
  };
}

function isPoint(value: unknown): value is Point {
  return Boolean(value && typeof value === 'object'
    && Number.isInteger((value as Point).x) && Number.isInteger((value as Point).y));
}

function coordinateLabel(point: Point, size: number): string {
  return `${'ABCDEFGHJKLMNOPQRST'[point.x]}${size - point.y}`;
}

const MISSION_ATTEMPT_STORAGE_PREFIX = 'baduk-mission-attempt:';

function readStoredAttemptId(missionId: string) {
  try {
    const value = sessionStorage.getItem(`${MISSION_ATTEMPT_STORAGE_PREFIX}${missionId}`);
    if (value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)) return value;
    if (value) sessionStorage.removeItem(`${MISSION_ATTEMPT_STORAGE_PREFIX}${missionId}`);
  } catch {}
  return null;
}

function storeAttemptId(missionId: string, attemptId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(attemptId)) return;
  try { sessionStorage.setItem(`${MISSION_ATTEMPT_STORAGE_PREFIX}${missionId}`, attemptId); } catch {}
}

function removeStoredAttemptId(missionId: string, attemptId: string) {
  try {
    const key = `${MISSION_ATTEMPT_STORAGE_PREFIX}${missionId}`;
    if (sessionStorage.getItem(key) === attemptId) sessionStorage.removeItem(key);
  } catch {}
}
