import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ApiClientError } from '../../lib/api-client';
import { listEras } from '../content/api';
import { GoBoard } from './GoBoard';
import {
  createAdminMission,
  getAdminMissionStatistics,
  listAdminMissions,
  previewAdminMission,
  publishAdminMission,
  updateAdminMission,
  validateAdminMission,
  type AdminMission,
  type AdminMissionPreview,
  type BoardState,
  type Point,
} from './api';

type BoardTool = 'black' | 'white' | 'erase' | 'answer' | 'forbidden';
type EditorState = {
  id: string;
  eraId: string;
  title: string;
  instruction: string;
  level: string;
  volume: number;
  lessonNumber: number;
  problemGroup: string;
  category: string;
  difficulty: number;
  displayOrder: number;
  boardSize: 9 | 13 | 19;
  playerColor: 'black' | 'white';
  missionType: string;
  initialBlackStones: Point[];
  initialWhiteStones: Point[];
  solutionTreeText: string;
  hintsText: string;
  correctExplanation: string;
  incorrectFeedback: string;
  baseScore: number;
  timeLimitSeconds: number | null;
  retryLimit: number | null;
  isFreeSample: boolean;
  rewardId: string;
  rewardQuantity: number;
};

const emptyEditor: EditorState = {
  id: '',
  eraId: 'era_prehistoric',
  title: '',
  instruction: '',
  level: '입문',
  volume: 1,
  lessonNumber: 1,
  problemGroup: '개념 확인',
  category: '따내기',
  difficulty: 1,
  displayOrder: 0,
  boardSize: 9,
  playerColor: 'black',
  missionType: 'best_move',
  initialBlackStones: [],
  initialWhiteStones: [],
  solutionTreeText: JSON.stringify({
    rootNodeId: 'root',
    nodes: { root: { actor: 'player', acceptedMoves: [] }, done: { terminal: 'success' } },
  }, null, 2),
  hintsText: '',
  correctExplanation: '',
  incorrectFeedback: '다른 수를 생각해 보세요.',
  baseScore: 100,
  timeLimitSeconds: null,
  retryLimit: 3,
  isFreeSample: false,
  rewardId: 'mission-star',
  rewardQuantity: 1,
};

export function AdminMissionPage() {
  const queryClient = useQueryClient();
  const missionsQuery = useQuery({ queryKey: ['admin-missions'], queryFn: listAdminMissions, retry: false });
  const erasQuery = useQuery({ queryKey: ['eras'], queryFn: listEras, retry: false });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState>(emptyEditor);
  const [tool, setTool] = useState<BoardTool>('black');
  const [notice, setNotice] = useState('새 문제를 작성하거나 기존 문제를 선택하세요.');
  const [localError, setLocalError] = useState('');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewMoves, setPreviewMoves] = useState<Point[]>([]);
  const [preview, setPreview] = useState<AdminMissionPreview | null>(null);

  const selected = missionsQuery.data?.items.find((mission) => mission.id === selectedId);
  useEffect(() => {
    if (selected) setEditor(fromMission(selected));
    setPreviewOpen(false);
    setPreviewMoves([]);
    setPreview(null);
  }, [selected]);
  const statisticsQuery = useQuery({
    queryKey: ['admin-mission-statistics', selectedId],
    queryFn: () => getAdminMissionStatistics(selectedId!),
    enabled: Boolean(selectedId),
    retry: false,
  });

  const saveMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => selectedId
      ? updateAdminMission(selectedId, payload)
      : createAdminMission(payload),
    onSuccess: async (result) => {
      setSelectedId(result.mission.id);
      setEditor(fromMission(result.mission));
      await queryClient.invalidateQueries({ queryKey: ['admin-missions'] });
      setNotice('문제를 저장했습니다. 자동검수 후 게시할 수 있습니다.');
    },
  });
  const validationMutation = useMutation({
    mutationFn: () => {
      if (!selectedId) throw new Error('save_required');
      return validateAdminMission(selectedId);
    },
    onSuccess: (result) => setNotice(result.valid ? '자동검수를 통과했습니다.' : result.errors.join(' · ')),
  });
  const publishMutation = useMutation({
    mutationFn: () => {
      if (!selectedId) throw new Error('save_required');
      return publishAdminMission(selectedId);
    },
    onSuccess: async (result) => {
      setEditor(fromMission(result.mission));
      await queryClient.invalidateQueries({ queryKey: ['admin-missions'] });
      setNotice('바둑미션을 게시했습니다.');
    },
  });
  const previewMutation = useMutation({
    mutationFn: (moves: Point[]) => {
      if (!selectedId) throw new Error('save_required');
      return previewAdminMission(selectedId, moves);
    },
    onSuccess: (result) => setPreview(result.preview),
  });

  const board: BoardState = useMemo(() => ({
    size: editor.boardSize,
    stones: [
      ...editor.initialBlackStones.map((point) => ({ ...point, color: 'black' as const })),
      ...editor.initialWhiteStones.map((point) => ({ ...point, color: 'white' as const })),
    ],
    previousPositionHash: null,
    lastMove: null,
  }), [editor.boardSize, editor.initialBlackStones, editor.initialWhiteStones]);

  function submit(event: FormEvent) {
    event.preventDefault();
    setLocalError('');
    try {
      saveMutation.mutate(toPayload(editor));
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : '입력값을 확인해 주세요.');
    }
  }

  function changeBoardSize(size: 9 | 13 | 19) {
    const conflicts = [...editor.initialBlackStones, ...editor.initialWhiteStones]
      .filter((point) => point.x >= size || point.y >= size);
    if (conflicts.length) {
      setLocalError(`판 크기를 변경할 수 없습니다. 범위를 벗어나는 돌: ${conflicts.map((point) => `${point.x},${point.y}`).join(' / ')}`);
      return;
    }
    setEditor((current) => ({ ...current, boardSize: size }));
    setLocalError('');
  }

  function editBoard(point: Point) {
    if (tool === 'answer' || tool === 'forbidden') {
      try {
        const tree = JSON.parse(editor.solutionTreeText) as Record<string, any>;
        const rootId = String(tree.rootNodeId || 'root');
        tree.nodes ??= {};
        tree.nodes[rootId] ??= { actor: 'player', acceptedMoves: [] };
        if (tool === 'answer') {
          tree.nodes[rootId].actor = 'player';
          tree.nodes[rootId].acceptedMoves = [{ ...point, result: 'correct', nextNodeId: 'done' }];
          tree.nodes.done ??= { terminal: 'success' };
          setNotice('대표 정답 한 수를 등록했습니다. 여러 수·분기는 JSON 수순 트리에서 편집할 수 있습니다.');
        } else {
          const forbidden = Array.isArray(tree.nodes[rootId].forbiddenMoves) ? tree.nodes[rootId].forbiddenMoves : [];
          tree.nodes[rootId].forbiddenMoves = [...forbidden.filter((move: Point) => move.x !== point.x || move.y !== point.y), point];
          setNotice('금지 수를 추가했습니다. JSON에서 feedbackId를 지정할 수 있습니다.');
        }
        setEditor((current) => ({ ...current, solutionTreeText: JSON.stringify(tree, null, 2) }));
      } catch {
        setLocalError('수순 트리 JSON을 먼저 올바르게 수정해 주세요.');
      }
      return;
    }
    setEditor((current) => {
      const black = current.initialBlackStones.filter((stone) => stone.x !== point.x || stone.y !== point.y);
      const white = current.initialWhiteStones.filter((stone) => stone.x !== point.x || stone.y !== point.y);
      return {
        ...current,
        initialBlackStones: tool === 'black' ? [...black, point] : black,
        initialWhiteStones: tool === 'white' ? [...white, point] : white,
      };
    });
  }

  const error = [saveMutation.error, validationMutation.error, publishMutation.error, previewMutation.error, statisticsQuery.error, missionsQuery.error, erasQuery.error]
    .find((item) => item instanceof ApiClientError) as ApiClientError | undefined;

  return (
    <main className="admin-mission-page">
      <header className="admin-mission-header">
        <div><Link className="back-link" to="/missions">← 바둑미션으로</Link><p className="react-stack-eyebrow">MISSION CMS</p><h1>바둑문제 입력기</h1></div>
        <button type="button" onClick={() => { setSelectedId(null); setEditor(emptyEditor); setPreviewOpen(false); setNotice('새 문제를 작성합니다.'); }}>새 문제</button>
      </header>
      <div className="admin-mission-layout">
        <aside className="admin-mission-list" aria-label="등록된 바둑문제">
          <h2>문제은행</h2>
          {missionsQuery.data?.items.map((mission) => (
            <button key={mission.id} type="button" aria-pressed={selectedId === mission.id} onClick={() => setSelectedId(mission.id)}>
              <strong>{mission.title}</strong><small>{mission.boardSize}줄 · {mission.status} · v{mission.version}</small>
            </button>
          ))}
          {statisticsQuery.data ? (
            <section className="admin-mission-statistics" aria-label="선택 문제 통계">
              <h3>학습 통계</h3>
              <dl>
                <div><dt>전체 시도</dt><dd>{statisticsQuery.data.summary.totalAttempts}</dd></div>
                <div><dt>완료율</dt><dd>{statisticsQuery.data.summary.completionRate}%</dd></div>
                <div><dt>학습자</dt><dd>{statisticsQuery.data.summary.uniqueLearners}</dd></div>
                <div><dt>평균 점수</dt><dd>{statisticsQuery.data.summary.averageScore}</dd></div>
                <div><dt>평균 오답</dt><dd>{statisticsQuery.data.summary.averageWrongMoves}</dd></div>
                <div><dt>평균 힌트</dt><dd>{statisticsQuery.data.summary.averageHintUses}</dd></div>
                <div><dt>평균 시간</dt><dd>{statisticsQuery.data.summary.averageSolveSeconds === null ? '—' : `${statisticsQuery.data.summary.averageSolveSeconds}초`}</dd></div>
              </dl>
            </section>
          ) : null}
        </aside>
        <form className="mission-editor" onSubmit={submit}>
          <section className="mission-editor-section">
            <h2>1. 기본정보</h2>
            <div className="mission-form-grid">
              <label>문제 ID<input value={editor.id} onChange={(event) => setEditor({ ...editor, id: event.target.value })} placeholder="비우면 자동 생성" disabled={Boolean(selectedId)} /></label>
              <label>제목<input value={editor.title} onChange={(event) => setEditor({ ...editor, title: event.target.value })} required minLength={2} maxLength={120} /></label>
              <label className="span-2">문제 지시문<textarea value={editor.instruction} onChange={(event) => setEditor({ ...editor, instruction: event.target.value })} required maxLength={500} /></label>
              <label>시대<select required value={editor.eraId} onChange={(event) => setEditor({ ...editor, eraId: event.target.value })}><option value="">시대를 선택하세요</option>{erasQuery.data?.map((era) => <option value={era.id} key={era.id}>{era.name}</option>)}</select></label>
              <label>과정<select value={editor.level} onChange={(event) => setEditor({ ...editor, level: event.target.value })}><option>입문</option><option>기초</option><option>기본</option></select></label>
              <label>권<input type="number" min="1" max="6" value={editor.volume} onChange={(event) => setEditor({ ...editor, volume: Number(event.target.value) })} /></label>
              <label>강<input type="number" min="1" max="8" value={editor.lessonNumber} onChange={(event) => setEditor({ ...editor, lessonNumber: Number(event.target.value) })} /></label>
              <label>문제군<select value={editor.problemGroup} onChange={(event) => setEditor({ ...editor, problemGroup: event.target.value })}><option>개념 확인</option><option>반복 훈련</option><option>도전</option></select></label>
              <label>카테고리<input value={editor.category} onChange={(event) => setEditor({ ...editor, category: event.target.value })} /></label>
              <label>난이도<input type="number" min="1" max="5" value={editor.difficulty} onChange={(event) => setEditor({ ...editor, difficulty: Number(event.target.value) })} /></label>
              <label>착수 색<select value={editor.playerColor} onChange={(event) => setEditor({ ...editor, playerColor: event.target.value as 'black' | 'white' })}><option value="black">흑</option><option value="white">백</option></select></label>
              <label>문제 유형<select value={editor.missionType} onChange={(event) => setEditor({ ...editor, missionType: event.target.value })}><option value="best_move">최선의 수</option><option value="capture">따내기</option><option value="escape">살리기</option><option value="connect">연결</option><option value="cut">끊기</option><option value="life_and_death">사활</option></select></label>
              <label>노출 순서<input type="number" min="0" value={editor.displayOrder} onChange={(event) => setEditor({ ...editor, displayOrder: Number(event.target.value) })} /></label>
            </div>
          </section>

          <section className="mission-editor-section">
            <h2>2. 초기 판과 대표 정답</h2>
            <div className="board-size-tools">
              {([9, 13, 19] as const).map((size) => <button key={size} type="button" aria-pressed={editor.boardSize === size} onClick={() => changeBoardSize(size)}>{size}줄</button>)}
            </div>
            <div className="board-edit-tools" role="toolbar" aria-label="바둑판 편집 도구">
              {([['black', '흑돌'], ['white', '백돌'], ['erase', '삭제'], ['answer', '대표 정답'], ['forbidden', '금지 수']] as const)
                .map(([value, label]) => <button key={value} type="button" aria-pressed={tool === value} onClick={() => setTool(value)}>{label}</button>)}
              <button type="button" onClick={() => setEditor({ ...editor, initialBlackStones: [], initialWhiteStones: [] })}>초기 판 지우기</button>
            </div>
            <div className="mission-editor-board"><GoBoard board={board} onPointSelect={editBoard} ariaLabel="초기 판과 정답 편집 바둑판" /></div>
          </section>

          <section className="mission-editor-section">
            <h2>3. 정답 수순 트리</h2>
            <p>대표 정답 도구는 한 수 문제를 만듭니다. 상대 자동응수·복수 정답·허용 변화도는 아래 JSON에서 노드를 추가할 수 있습니다.</p>
            <label>수순 트리 JSON<textarea className="solution-tree-editor" value={editor.solutionTreeText} onChange={(event) => setEditor({ ...editor, solutionTreeText: event.target.value })} spellCheck={false} /></label>
          </section>

          <section className="mission-editor-section">
            <h2>4. 힌트·해설과 점수</h2>
            <div className="mission-form-grid">
              <label className="span-2">힌트(한 줄에 한 단계)<textarea value={editor.hintsText} onChange={(event) => setEditor({ ...editor, hintsText: event.target.value })} /></label>
              <label className="span-2">정답 해설<textarea value={editor.correctExplanation} onChange={(event) => setEditor({ ...editor, correctExplanation: event.target.value })} required /></label>
              <label className="span-2">기본 오답 피드백<textarea value={editor.incorrectFeedback} onChange={(event) => setEditor({ ...editor, incorrectFeedback: event.target.value })} /></label>
              <label>배점<input type="number" min="0" max="10000" value={editor.baseScore} onChange={(event) => setEditor({ ...editor, baseScore: Number(event.target.value) })} /></label>
              <label>제한시간(초)<input type="number" min="1" value={editor.timeLimitSeconds ?? ''} onChange={(event) => setEditor({ ...editor, timeLimitSeconds: event.target.value ? Number(event.target.value) : null })} /></label>
              <label>오답 제한<input type="number" min="1" value={editor.retryLimit ?? ''} onChange={(event) => setEditor({ ...editor, retryLimit: event.target.value ? Number(event.target.value) : null })} /></label>
              <label>완료 별 보상<input type="number" min="1" max="100" value={editor.rewardQuantity} onChange={(event) => setEditor({ ...editor, rewardQuantity: Number(event.target.value) })} /></label>
              <label className="checkbox-label"><input type="checkbox" checked={editor.isFreeSample} onChange={(event) => setEditor({ ...editor, isFreeSample: event.target.checked })} /> 무료 샘플</label>
            </div>
          </section>

          <div className="mission-editor-actions">
            <button type="submit" disabled={saveMutation.isPending}>{saveMutation.isPending ? '저장 중…' : '임시저장'}</button>
            <button type="button" disabled={!selectedId || validationMutation.isPending} onClick={() => validationMutation.mutate()}>자동검수</button>
            <button type="button" disabled={!selectedId || previewMutation.isPending} onClick={() => { setPreviewOpen(true); setPreviewMoves([]); previewMutation.mutate([]); }}>기록 없는 미리보기</button>
            <button type="button" disabled={!selectedId || publishMutation.isPending} onClick={() => publishMutation.mutate()}>게시</button>
          </div>
          {previewOpen ? (
            <section className="mission-editor-section mission-preview" aria-label="기록 없는 문제 미리보기">
              <div className="mission-preview-header">
                <div><h2>5. 기록 없는 미리보기</h2><p>저장된 문제 버전을 서버 규칙 엔진으로 실행합니다. 학습 시도·점수·보상은 저장되지 않습니다.</p></div>
                <button type="button" onClick={() => setPreviewOpen(false)}>미리보기 닫기</button>
              </div>
              {preview ? (
                <>
                  <div className="mission-editor-board">
                    <GoBoard
                      board={preview.boardState}
                      disabled={preview.status !== 'in_progress' || previewMutation.isPending}
                      onPointSelect={(point) => {
                        const moves = [...previewMoves, point];
                        setPreviewMoves(moves);
                        previewMutation.mutate(moves);
                      }}
                      ariaLabel="기록 없는 미리보기 바둑판"
                    />
                  </div>
                  <div className="mission-preview-result" role="status">
                    <strong>{preview.status === 'completed' ? '미션 성공' : preview.status === 'failed' ? '미션 실패' : '착수 대기'}</strong>
                    <span>점수 {preview.score} · 확정 수 {preview.moveCount} · 오답 {preview.wrongMoveCount}</span>
                    {preview.steps.at(-1) ? <p>{preview.steps.at(-1)?.feedback}</p> : <p>바둑판에 직접 착수해 수순을 확인하세요.</p>}
                    {preview.explanation ? <p>해설: {preview.explanation}</p> : null}
                  </div>
                  <button type="button" onClick={() => { setPreviewMoves([]); previewMutation.mutate([]); }}>처음부터 미리보기</button>
                </>
              ) : <p role="status">미리보기를 준비하고 있습니다.</p>}
            </section>
          ) : null}
          <p className="auth-notice" role="status">{notice}</p>
          {localError || error ? <p className="auth-error" role="alert">{localError || error?.message}</p> : null}
        </form>
      </div>
    </main>
  );
}

function toPayload(editor: EditorState): Record<string, unknown> {
  let solutionTree: unknown;
  try { solutionTree = JSON.parse(editor.solutionTreeText); } catch { throw new Error('수순 트리 JSON 형식을 확인해 주세요.'); }
  return {
    ...(editor.id ? { id: editor.id } : {}),
    eraId: editor.eraId,
    title: editor.title,
    instruction: editor.instruction,
    level: editor.level,
    volume: editor.volume,
    lessonNumber: editor.lessonNumber,
    problemGroup: editor.problemGroup,
    category: editor.category,
    difficulty: editor.difficulty,
    displayOrder: editor.displayOrder,
    boardSize: editor.boardSize,
    playerColor: editor.playerColor,
    missionType: editor.missionType,
    initialBlackStones: editor.initialBlackStones,
    initialWhiteStones: editor.initialWhiteStones,
    solutionTree,
    hints: editor.hintsText.split('\n').map((line) => line.trim()).filter(Boolean),
    correctExplanation: editor.correctExplanation,
    feedbacks: { incorrect: editor.incorrectFeedback },
    baseScore: editor.baseScore,
    timeLimitSeconds: editor.timeLimitSeconds,
    retryLimit: editor.retryLimit,
    isFreeSample: editor.isFreeSample,
    rewardId: editor.rewardId,
    rewardQuantity: editor.rewardQuantity,
  };
}

function fromMission(mission: AdminMission): EditorState {
  return {
    id: mission.id,
    eraId: mission.eraId ?? '',
    title: mission.title,
    instruction: mission.instruction,
    level: mission.level,
    volume: mission.volume,
    lessonNumber: mission.lessonNumber,
    problemGroup: mission.problemGroup,
    category: mission.category,
    difficulty: mission.difficulty,
    displayOrder: mission.displayOrder,
    boardSize: mission.boardSize,
    playerColor: mission.playerColor,
    missionType: mission.missionType,
    initialBlackStones: mission.initialBlackStones,
    initialWhiteStones: mission.initialWhiteStones,
    solutionTreeText: JSON.stringify(mission.solutionTree, null, 2),
    hintsText: mission.hints.filter((hint) => typeof hint === 'string').join('\n'),
    correctExplanation: mission.correctExplanation,
    incorrectFeedback: mission.feedbacks.incorrect ?? '',
    baseScore: mission.baseScore,
    timeLimitSeconds: mission.timeLimitSeconds,
    retryLimit: mission.retryLimit,
    isFreeSample: mission.isFreeSample,
    rewardId: mission.rewardId,
    rewardQuantity: mission.rewardQuantity,
  };
}
