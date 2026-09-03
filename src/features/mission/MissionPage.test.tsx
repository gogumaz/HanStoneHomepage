import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminMissionPage } from './AdminMissionPage';
import { MissionPage } from './MissionPage';
import type { Point } from './api';

const mission = {
  id: 'MISSION-UI-9',
  version: 1,
  title: '9줄 마지막 활로',
  instruction: '백돌의 마지막 활로를 막으세요.',
  level: '입문',
  volume: 1,
  lessonNumber: 1,
  problemGroup: '개념 확인',
  category: '따내기',
  difficulty: 1,
  boardSize: 9,
  playerColor: 'black',
  missionType: 'capture',
  baseScore: 100,
  timeLimitSeconds: null,
  retryLimit: 3,
  isFreeSample: true,
  reward: { id: 'mission-star', quantity: 1 },
  isFavorite: false,
  initialBlackStones: [{ x: 3, y: 4 }, { x: 4, y: 3 }, { x: 5, y: 4 }],
  initialWhiteStones: [{ x: 4, y: 4 }],
  hintsAvailable: 2,
  progress: null,
};

function renderWithQuery(element: React.ReactNode, initialEntries = ['/']) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={queryClient}><MemoryRouter initialEntries={initialEntries}>{element}</MemoryRouter></QueryClientProvider>);
}

describe('Mission UI', () => {
  afterEach(() => {
    cleanup();
    sessionStorage.clear();
    vi.unstubAllGlobals();
  });

  it('keeps a move pending until confirmation and then shows the server result', async () => {
    const boardHash = 'a'.repeat(64);
    const completedHash = 'b'.repeat(64);
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/v1/missions') {
        return response({ items: [mission] });
      }
      if (url === '/api/v1/missions/MISSION-UI-9' && !init?.method) {
        return response({ mission, attempt: null });
      }
      if (url.endsWith('/attempts')) {
        return response({ mission, attempt: {
          id: 'attempt-ui-1', missionId: mission.id, missionVersion: 1, source: 'mission_list', status: 'in_progress',
          boardState: initialBoard(), boardHash, moveCount: 0, wrongMoveCount: 0, attemptCount: 0,
          hintLevel: 0, hintUseCount: 0, score: 0, startedAt: new Date().toISOString(), lastPlayedAt: new Date().toISOString(), completedAt: null,
        } }, 201);
      }
      if (url.endsWith('/moves')) {
        return response({
          result: 'correct', reason: null, feedback: '정답입니다.',
          playerMove: { color: 'black', x: 4, y: 5, capturedStones: [{ x: 4, y: 4 }] },
          opponentMoves: [], nextTurn: null, status: 'completed', score: 100,
          boardState: {
            ...initialBoard(),
            stones: [...initialBoard().stones.filter((stone) => stone.x !== 4 || stone.y !== 4), { color: 'black', x: 4, y: 5 }],
            lastMove: { color: 'black', x: 4, y: 5 },
            captures: { black: 1, white: 0 },
          },
          boardHash: completedHash, moveCount: 1, wrongMoveCount: 0, attemptCount: 1,
          explanation: '백돌의 마지막 활로를 막았습니다.',
          reward: { id: 'mission-star', type: 'star', title: '미션 별', quantity: 1, newlyGranted: true },
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWithQuery(<MissionPage />);

    fireEvent.click(await screen.findByRole('button', { name: '시작하기' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(await within(dialog).findByRole('button', { name: '문제 시작' }));
    fireEvent.click(await within(dialog).findByRole('button', { name: 'E4 교차점' }));
    expect(screen.getByText(/E4에 둘 예정/)).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/moves'))).toHaveLength(0);

    fireEvent.click(within(dialog).getByRole('button', { name: '정답 확인' }));
    expect(await screen.findByText('정답입니다.')).toBeInTheDocument();
    expect(screen.getByText(/백돌의 마지막 활로를 막았습니다/)).toBeInTheDocument();
    expect(screen.getByText(/미션 별 1개를 받았습니다/)).toBeInTheDocument();
    expect(within(screen.getByText('흑이 잡은 돌').closest('div') as HTMLElement).getByText('1')).toBeInTheDocument();
    expect(within(screen.getByText('백이 잡은 돌').closest('div') as HTMLElement).getByText('0')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/mission-attempts/attempt-ui-1/moves',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    );
  });

  it('locks consecutive move submissions and reuses the idempotency key after an interrupted response', async () => {
    const attemptId = '00000000-0000-4000-8000-000000000325';
    const attempt = {
      id: attemptId, missionId: mission.id, missionVersion: 1, source: 'mission_list', status: 'in_progress' as const,
      boardState: initialBoard(), boardHash: '3'.repeat(64), moveCount: 0, wrongMoveCount: 0, attemptCount: 0,
      hintLevel: 0, hintUseCount: 0, score: 100, startedAt: new Date().toISOString(), lastPlayedAt: new Date().toISOString(), completedAt: null,
    };
    const moveBodies: Array<Record<string, unknown>> = [];
    let interruptFirstMove: (() => void) | undefined;
    const interruptedResponse = new Promise<Response>((_resolve, reject) => {
      interruptFirstMove = () => reject(new TypeError('Failed to fetch'));
    });
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/v1/missions') return response({ items: [mission] });
      if (url === `/api/v1/missions/${mission.id}` && !init?.method) return response({ mission, attempt });
      if (url === `/api/v1/mission-attempts/${attemptId}/moves`) {
        moveBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        if (moveBodies.length === 1) return interruptedResponse;
        return response({
          result: 'correct', reason: null, feedback: '정답입니다.',
          playerMove: { color: 'black', x: 4, y: 5, capturedStones: [{ x: 4, y: 4 }] },
          opponentMoves: [], nextTurn: null, status: 'completed', score: 100,
          boardState: {
            ...initialBoard(),
            stones: [...initialBoard().stones.filter((stone) => stone.x !== 4 || stone.y !== 4), { color: 'black', x: 4, y: 5 }],
            lastMove: { color: 'black', x: 4, y: 5 }, captures: { black: 1, white: 0 },
          },
          boardHash: '4'.repeat(64), moveCount: 1, wrongMoveCount: 0, attemptCount: 1,
          explanation: '백돌의 마지막 활로를 막았습니다.', reward: null,
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWithQuery(<MissionPage />);

    fireEvent.click(await screen.findByRole('button', { name: '시작하기' }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText('오답');
    fireEvent.click(await within(dialog).findByRole('button', { name: 'E4 교차점' }));
    const confirmButton = within(dialog).getByRole('button', { name: '정답 확인' });
    fireEvent.click(confirmButton);
    await waitFor(() => expect(moveBodies).toHaveLength(1));
    expect(confirmButton).toBeDisabled();

    fireEvent.click(confirmButton);
    expect(moveBodies).toHaveLength(1);

    interruptFirstMove?.();
    await waitFor(() => expect(confirmButton).toBeEnabled());
    fireEvent.click(confirmButton);

    expect(await within(dialog).findByText('정답입니다.')).toBeInTheDocument();
    expect(moveBodies).toHaveLength(2);
    expect(moveBodies[0]?.clientMoveId).toMatch(/^move_[0-9a-f]{32}$/u);
    expect(moveBodies[1]?.clientMoveId).toBe(moveBodies[0]?.clientMoveId);
    expect(moveBodies[1]).toMatchObject({
      missionVersion: 1,
      expectedMoveNumber: 0,
      boardHash: '3'.repeat(64),
      move: { x: 4, y: 5 },
    });
  });

  it('resumes a browser-held anonymous attempt after reopening the mission', async () => {
    const attemptId = '00000000-0000-4000-8000-000000000321';
    sessionStorage.setItem(`${'baduk-mission-attempt:'}${mission.id}`, attemptId);
    const resumedAttempt = {
      id: attemptId, missionId: mission.id, missionVersion: 1, source: 'mission_list', status: 'in_progress' as const,
      boardState: initialBoard(), boardHash: 'd'.repeat(64), moveCount: 0, wrongMoveCount: 1, attemptCount: 1,
      hintLevel: 0, hintUseCount: 0, score: 90, startedAt: new Date().toISOString(), lastPlayedAt: new Date().toISOString(), completedAt: null,
    };
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/v1/missions') return response({ items: [mission] });
      if (url === `/api/v1/missions/${mission.id}?attemptId=${attemptId}`) return response({ mission, attempt: resumedAttempt });
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWithQuery(<MissionPage />);

    fireEvent.click(await screen.findByRole('button', { name: '시작하기' }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('재접속이 완료되었습니다.')).toBeInTheDocument();
    expect(within(screen.getByText('오답').closest('div') as HTMLElement).getByText('1')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/missions/${mission.id}?attemptId=${attemptId}`,
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('opens the classroom display with the same stored attempt and server board state', async () => {
    const attemptId = '00000000-0000-4000-8000-000000000326';
    sessionStorage.setItem(`baduk-mission-attempt:${mission.id}`, attemptId);
    const classroomAttempt = {
      id: attemptId, missionId: mission.id, missionVersion: 1, source: 'mission_list', status: 'in_progress' as const,
      boardState: { ...initialBoard(), captures: { black: 2, white: 0 } }, boardHash: '5'.repeat(64),
      moveCount: 2, wrongMoveCount: 1, attemptCount: 3, hintLevel: 1, hintUseCount: 1, score: 80,
      startedAt: new Date().toISOString(), lastPlayedAt: new Date().toISOString(), completedAt: null,
    };
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/v1/missions?lessonId=PRE-01') return response({ items: [mission] });
      if (url === `/api/v1/missions/${mission.id}?attemptId=${attemptId}`) return response({ mission, attempt: classroomAttempt });
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWithQuery(<MissionPage />, [`/missions?lessonId=PRE-01&missionId=${mission.id}&mode=classroom`]);

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAttribute('data-display-mode', 'classroom');
    expect(within(dialog).getByText('지도자 수업 화면')).toBeInTheDocument();
    expect(screen.getByText(/기존 문제풀이의 판과 시도 상태를 그대로 이어갑니다/)).toBeInTheDocument();
    expect(await within(dialog).findByText('재접속이 완료되었습니다.')).toBeInTheDocument();
    expect(within(screen.getByText('점수').closest('div') as HTMLElement).getByText('80')).toBeInTheDocument();
    expect(within(screen.getByText('흑이 잡은 돌').closest('div') as HTMLElement).getByText('2')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/missions/${mission.id}?attemptId=${attemptId}`,
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('reuses the same attempt idempotency key when a start response is interrupted', async () => {
    const attemptBodies: Array<Record<string, string>> = [];
    let startCalls = 0;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/v1/missions') return response({ items: [mission] });
      if (url === `/api/v1/missions/${mission.id}` && !init?.method) return response({ mission, attempt: null });
      if (url.endsWith('/attempts')) {
        attemptBodies.push(JSON.parse(String(init?.body)) as Record<string, string>);
        startCalls += 1;
        if (startCalls === 1) return new Response(JSON.stringify({ error: { code: 'TEMPORARY_ERROR', message: '연결이 끊겼습니다.' } }), { status: 503, headers: { 'content-type': 'application/json' } });
        return response({ mission, attempt: {
          id: '00000000-0000-4000-8000-000000000322', missionId: mission.id, missionVersion: 1, source: 'mission_list', status: 'in_progress',
          boardState: initialBoard(), boardHash: 'e'.repeat(64), moveCount: 0, wrongMoveCount: 0, attemptCount: 0,
          hintLevel: 0, hintUseCount: 0, score: 0, startedAt: new Date().toISOString(), lastPlayedAt: new Date().toISOString(), completedAt: null,
        } }, 201);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWithQuery(<MissionPage />);

    fireEvent.click(await screen.findByRole('button', { name: '시작하기' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(await within(dialog).findByRole('button', { name: '문제 시작' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('연결이 끊겼습니다.');
    fireEvent.click(within(dialog).getByRole('button', { name: '문제 시작' }));
    await waitFor(() => expect(attemptBodies).toHaveLength(2));
    expect(attemptBodies[0]?.clientAttemptId).toBe(attemptBodies[1]?.clientAttemptId);
    expect(sessionStorage.getItem(`baduk-mission-attempt:${mission.id}`)).toBe('00000000-0000-4000-8000-000000000322');
  });

  it('automatically reloads the latest board after a concurrent-state conflict', async () => {
    const attemptId = '00000000-0000-4000-8000-000000000323';
    const attempt = {
      id: attemptId, missionId: mission.id, missionVersion: 1, source: 'mission_list', status: 'in_progress' as const,
      boardState: initialBoard(), boardHash: 'f'.repeat(64), moveCount: 0, wrongMoveCount: 0, attemptCount: 0,
      hintLevel: 0, hintUseCount: 0, score: 100, startedAt: new Date().toISOString(), lastPlayedAt: new Date().toISOString(), completedAt: null,
    };
    const latest = { ...attempt, boardHash: '1'.repeat(64), wrongMoveCount: 2, attemptCount: 2, score: 80 };
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/v1/missions') return response({ items: [mission] });
      if (url === `/api/v1/missions/${mission.id}` && !init?.method) return response({ mission, attempt });
      if (url === `/api/v1/mission-attempts/${attemptId}/moves`) {
        return new Response(JSON.stringify({ error: { code: 'MISSION_STATE_CONFLICT', message: '진행 상태가 변경되었습니다.' } }), { status: 409, headers: { 'content-type': 'application/json' } });
      }
      if (url === `/api/v1/mission-attempts/${attemptId}`) return response({ attempt: latest, mission, moves: [] });
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWithQuery(<MissionPage />);

    fireEvent.click(await screen.findByRole('button', { name: '시작하기' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(await within(dialog).findByRole('button', { name: 'E4 교차점' }));
    fireEvent.click(within(dialog).getByRole('button', { name: '정답 확인' }));
    expect(await within(dialog).findByText('다른 요청에서 반영된 진행 상태로 자동 복구했습니다.')).toBeInTheDocument();
    expect(within(screen.getByText('오답').closest('div') as HTMLElement).getByText('2')).toBeInTheDocument();
    expect(within(dialog).queryByText('진행 상태가 변경되었습니다.')).not.toBeInTheDocument();
  });

  it('locks write actions offline and synchronizes the attempt when connectivity returns', async () => {
    const attemptId = '00000000-0000-4000-8000-000000000324';
    const attempt = {
      id: attemptId, missionId: mission.id, missionVersion: 1, source: 'mission_list', status: 'in_progress' as const,
      boardState: initialBoard(), boardHash: '2'.repeat(64), moveCount: 0, wrongMoveCount: 0, attemptCount: 0,
      hintLevel: 0, hintUseCount: 0, score: 100, startedAt: new Date().toISOString(), lastPlayedAt: new Date().toISOString(), completedAt: null,
    };
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/v1/missions') return response({ items: [mission] });
      if (url === `/api/v1/missions/${mission.id}` && !init?.method) return response({ mission, attempt });
      if (url === `/api/v1/mission-attempts/${attemptId}`) return response({ attempt, mission, moves: [] });
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWithQuery(<MissionPage />);

    fireEvent.click(await screen.findByRole('button', { name: '시작하기' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent(window, new Event('offline'));
    expect(await within(dialog).findByText(/오프라인입니다/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'E4 교차점' }));
    expect(within(dialog).getByRole('button', { name: '정답 확인' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: '힌트 보기' })).toBeDisabled();

    fireEvent(window, new Event('online'));
    expect(await within(dialog).findByText('온라인 재접속이 완료되었습니다.')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/mission-attempts/${attemptId}`,
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('applies detailed search filters and adds a mission favorite', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/v1/missions')) return response({ items: [mission] });
      if (url === `/api/v1/me/mission-favorites/${mission.id}` && init?.method === 'POST') {
        return response({ missionId: mission.id, isFavorite: true }, 201);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWithQuery(<MissionPage />);
    await screen.findByRole('button', { name: `${mission.title} 즐겨찾기 추가` });

    fireEvent.change(screen.getByLabelText('검색어'), { target: { value: '마지막 활로' } });
    fireEvent.change(screen.getByLabelText('유형'), { target: { value: 'capture' } });
    fireEvent.change(screen.getByLabelText('난이도'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: '검색 적용' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => {
      const value = String(url);
      return value.includes('q=%EB%A7%88%EC%A7%80%EB%A7%89+%ED%99%9C%EB%A1%9C')
        && value.includes('missionType=capture') && value.includes('difficulty=1');
    })).toBe(true));

    const favoriteButton = await screen.findByRole('button', { name: `${mission.title} 즐겨찾기 추가` });
    fireEvent.click(favoriteButton);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/me/mission-favorites/${mission.id}`,
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    ));
  });

  it('opens a lesson-linked mission directly and records the lesson entry source', async () => {
    const boardHash = 'c'.repeat(64);
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/v1/missions?lessonId=PRE-01') return response({ items: [mission] });
      if (url === `/api/v1/missions/${mission.id}` && !init?.method) return response({ mission, attempt: null });
      if (url.endsWith('/attempts')) return response({ mission, attempt: {
        id: 'attempt-lesson-1', missionId: mission.id, missionVersion: 1, source: 'lesson', status: 'in_progress',
        boardState: initialBoard(), boardHash, moveCount: 0, wrongMoveCount: 0, attemptCount: 0,
        hintLevel: 0, hintUseCount: 0, score: 0, startedAt: new Date().toISOString(), lastPlayedAt: new Date().toISOString(), completedAt: null,
      } }, 201);
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWithQuery(<MissionPage />, [`/missions?lessonId=PRE-01&missionId=${mission.id}`]);

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: mission.title })).toBeInTheDocument();
    expect(screen.getByText(/강의 PRE-01에 연결된 바둑미션/)).toBeInTheDocument();
    const startButton = within(dialog).getByRole('button', { name: '문제 시작' });
    await waitFor(() => expect(startButton).toBeEnabled());
    fireEvent.click(startButton);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/missions/${mission.id}/attempts`,
      expect.objectContaining({ method: 'POST', body: expect.stringContaining('"source":"lesson"') }),
    ));
  });

  it('blocks a board-size change that would discard existing stones in the editor', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ items: [] })));
    renderWithQuery(<AdminMissionPage />);

    fireEvent.click(await screen.findByRole('button', { name: '19줄' }));
    fireEvent.click(screen.getByRole('button', { name: '흑돌' }));
    fireEvent.click(screen.getByRole('button', { name: 'T1 교차점' }));
    fireEvent.click(screen.getByRole('button', { name: '9줄' }));

    expect(screen.getByRole('alert')).toHaveTextContent('판 크기를 변경할 수 없습니다');
    expect(screen.getByRole('button', { name: '19줄' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows mission statistics and runs an admin preview without creating an attempt', async () => {
    const adminItem = {
      ...mission,
      status: 'published', displayOrder: 1, eraId: null, lessonId: null, textbookPage: null,
      ruleset: 'japanese_simple_ko', successCondition: null,
      solutionTree: {
        rootNodeId: 'root',
        nodes: { root: { actor: 'player', acceptedMoves: [{ x: 4, y: 5, result: 'correct', nextNodeId: 'done' }] }, done: { terminal: 'success' } },
      },
      hints: ['활로를 보세요.'], correctExplanation: '백돌을 잡았습니다.', feedbacks: { incorrect: '다시 보세요.' },
      scheduledAt: null, publishedAt: new Date().toISOString(), rewardId: 'mission-star', rewardQuantity: 1,
    };
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/v1/admin/missions') return response({ items: [adminItem] });
      if (url.endsWith('/statistics')) return response({
        mission: { id: mission.id, title: mission.title, version: 1, boardSize: 9 },
        summary: {
          totalAttempts: 8, uniqueLearners: 6, inProgress: 1, completed: 5, failed: 2,
          completionRate: 62.5, averageScore: 84, averageWrongMoves: 1.2, averageHintUses: 0.5,
          averageSolveSeconds: 33.4, submittedMoves: 16,
        },
        resultCounts: { correct: 5, acceptable: 0, incorrect: 7, forbidden: 1, illegal: 3, timeout: 1 },
        generatedAt: new Date().toISOString(),
      });
      if (url.endsWith('/preview')) {
        const moves = JSON.parse(String(init?.body)).moves as Point[];
        const completed = moves.length > 0;
        return response({ preview: {
          missionId: mission.id, missionVersion: 1, status: completed ? 'completed' : 'in_progress', currentNodeId: completed ? 'done' : 'root',
          boardState: completed ? {
            ...initialBoard(),
            stones: [...initialBoard().stones.filter((stone) => stone.x !== 4 || stone.y !== 4), { color: 'black', x: 4, y: 5 }],
            lastMove: { color: 'black', x: 4, y: 5 },
          } : initialBoard(),
          boardHash: (completed ? 'b' : 'a').repeat(64), moveCount: completed ? 1 : 0, wrongMoveCount: 0, score: 100,
          steps: completed ? [{ number: 1, point: moves[0], result: 'correct', reason: null, feedback: '정답입니다.', opponentMoves: [], status: 'completed' }] : [],
          explanation: completed ? '백돌을 잡았습니다.' : null, persisted: false,
        } });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWithQuery(<AdminMissionPage />);

    fireEvent.click(await screen.findByRole('button', { name: new RegExp(mission.title) }));
    expect(await screen.findByText('62.5%')).toBeInTheDocument();
    expect(screen.getByText('33.4초')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '기록 없는 미리보기' }));
    const previewRegion = await screen.findByRole('region', { name: '기록 없는 문제 미리보기' });
    fireEvent.click(await within(previewRegion).findByRole('button', { name: 'E4 교차점' }));
    expect(await within(previewRegion).findByText('미션 성공')).toBeInTheDocument();
    expect(within(previewRegion).getByText('정답입니다.')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/attempts'))).toBe(false);
  });
});

function initialBoard() {
  return {
    size: 9 as const,
    stones: [
      ...mission.initialBlackStones.map((point) => ({ ...point, color: 'black' as const })),
      ...mission.initialWhiteStones.map((point) => ({ ...point, color: 'white' as const })),
    ],
    previousPositionHash: null,
    lastMove: null,
  };
}

function response(data: unknown, status = 200) {
  return new Response(JSON.stringify({ data }), { status, headers: { 'content-type': 'application/json' } });
}
