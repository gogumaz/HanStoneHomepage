import { apiRequest } from '../../lib/api-client';

export type StoneColor = 'black' | 'white';
export type Point = { x: number; y: number };
export type Stone = Point & { color: StoneColor };
export type BoardState = {
  size: 9 | 13 | 19;
  stones: Stone[];
  previousPositionHash: string | null;
  lastMove: Stone | null;
  captures?: Record<StoneColor, number>;
};

export type MissionSummary = {
  id: string;
  eraId: string | null;
  version: number;
  title: string;
  instruction: string;
  level: string;
  volume: number;
  lessonNumber: number;
  problemGroup: string;
  category: string;
  difficulty: number;
  boardSize: 9 | 13 | 19;
  playerColor: StoneColor;
  missionType: string;
  baseScore: number;
  timeLimitSeconds: number | null;
  retryLimit: number | null;
  isFreeSample: boolean;
  reward: { id: string; quantity: number };
  isFavorite?: boolean;
  initialBlackStones?: Point[];
  initialWhiteStones?: Point[];
  hintsAvailable?: number;
  status?: string;
  progress?: { attemptId: string; status: string; score: number; lastPlayedAt: string } | null;
};

export type MissionAttempt = {
  id: string;
  missionId: string;
  missionVersion: number;
  source: string;
  status: 'in_progress' | 'completed' | 'failed';
  boardState: BoardState;
  boardHash: string;
  moveCount: number;
  wrongMoveCount: number;
  attemptCount: number;
  hintLevel: number;
  hintUseCount: number;
  score: number;
  startedAt: string;
  lastPlayedAt: string;
  completedAt: string | null;
};

export type MoveResult = {
  result: 'correct' | 'acceptable' | 'incorrect' | 'forbidden' | 'illegal' | 'timeout';
  reason: string | null;
  feedback: string;
  playerMove: (Stone & { capturedStones: Point[] }) | null;
  opponentMoves: Array<Stone & { capturedStones: Point[] }>;
  nextTurn: StoneColor | null;
  status: MissionAttempt['status'];
  score: number;
  boardState: BoardState;
  boardHash: string;
  moveCount: number;
  wrongMoveCount: number;
  attemptCount: number;
  explanation: string | null;
  reward: { id: string; type: 'star' | 'badge' | 'artifact_card'; title: string; quantity: number; newlyGranted: boolean } | null;
};

export type MyRewards = {
  totals: { stars: number; badges: number; artifactCards: number };
  items: Array<{
    id: string;
    reward: { id: string; type: 'star' | 'badge' | 'artifact_card'; title: string; quantity: number };
    source: { type: 'mission'; mission: { id: string; title: string; boardSize: number }; attemptId: string };
    grantedAt: string;
  }>;
};

export type AdminMission = MissionSummary & {
  status: 'draft' | 'pending_review' | 'scheduled' | 'published' | 'archived';
  displayOrder: number;
  eraId: string | null;
  lessonId: string | null;
  textbookPage: string | null;
  ruleset: string;
  initialBlackStones: Point[];
  initialWhiteStones: Point[];
  successCondition: unknown;
  solutionTree: unknown;
  hints: unknown[];
  correctExplanation: string;
  feedbacks: Record<string, string>;
  scheduledAt: string | null;
  publishedAt: string | null;
  rewardId: string;
  rewardQuantity: number;
};

export type AdminMissionPreview = {
  missionId: string;
  missionVersion: number;
  status: 'in_progress' | 'completed' | 'failed';
  currentNodeId: string;
  boardState: BoardState;
  boardHash: string;
  moveCount: number;
  wrongMoveCount: number;
  score: number;
  steps: Array<{
    number: number;
    point: Point;
    result: MoveResult['result'];
    reason: string | null;
    feedback: string;
    opponentMoves: MoveResult['opponentMoves'];
    status: 'in_progress' | 'completed' | 'failed';
  }>;
  explanation: string | null;
  persisted: false;
};

export type AdminMissionStatistics = {
  mission: { id: string; title: string; version: number; boardSize: number };
  summary: {
    totalAttempts: number;
    uniqueLearners: number;
    inProgress: number;
    completed: number;
    failed: number;
    completionRate: number;
    averageScore: number;
    averageWrongMoves: number;
    averageHintUses: number;
    averageSolveSeconds: number | null;
    submittedMoves: number;
  };
  resultCounts: Record<MoveResult['result'], number>;
  generatedAt: string;
};

export type MissionFilters = {
  q?: string;
  boardSize?: number;
  level?: string;
  volume?: number;
  lessonNumber?: number;
  category?: string;
  problemGroup?: string;
  missionType?: string;
  eraId?: string;
  lessonId?: string;
  difficulty?: number;
  progress?: 'not_started' | 'in_progress' | 'completed' | 'failed';
  favorite?: boolean;
};

export function listMissions(filters: MissionFilters = {}): Promise<{ items: MissionSummary[] }> {
  const search = new URLSearchParams();
  if (filters.q) search.set('q', filters.q);
  if (filters.boardSize) search.set('boardSize', String(filters.boardSize));
  if (filters.level) search.set('level', filters.level);
  if (filters.volume) search.set('volume', String(filters.volume));
  if (filters.lessonNumber) search.set('lessonNumber', String(filters.lessonNumber));
  if (filters.category) search.set('category', filters.category);
  if (filters.problemGroup) search.set('problemGroup', filters.problemGroup);
  if (filters.missionType) search.set('missionType', filters.missionType);
  if (filters.eraId) search.set('eraId', filters.eraId);
  if (filters.lessonId) search.set('lessonId', filters.lessonId);
  if (filters.difficulty) search.set('difficulty', String(filters.difficulty));
  if (filters.progress) search.set('progress', filters.progress);
  if (filters.favorite) search.set('favorite', 'true');
  const suffix = search.size ? `?${search}` : '';
  return apiRequest(`/missions${suffix}`);
}

export function addMissionFavorite(id: string): Promise<{ missionId: string; isFavorite: boolean }> {
  return apiRequest(`/me/mission-favorites/${encodeURIComponent(id)}`, { method: 'POST', body: '{}' });
}

export function removeMissionFavorite(id: string): Promise<{ missionId: string; isFavorite: boolean }> {
  return apiRequest(`/me/mission-favorites/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function getMission(id: string, attemptId?: string | null): Promise<{ mission: MissionSummary; attempt: MissionAttempt | null }> {
  const suffix = attemptId ? `?attemptId=${encodeURIComponent(attemptId)}` : '';
  return apiRequest(`/missions/${encodeURIComponent(id)}${suffix}`);
}

export function startMissionAttempt(id: string, source = 'mission_list', clientAttemptId = `attempt_${crypto.randomUUID().replaceAll('-', '')}`): Promise<{ mission: MissionSummary; attempt: MissionAttempt }> {
  return apiRequest(`/missions/${encodeURIComponent(id)}/attempts`, {
    method: 'POST',
    body: JSON.stringify({ source, clientAttemptId }),
  });
}

export function submitMissionMove(attempt: MissionAttempt, point: Point, clientMoveId = `move_${crypto.randomUUID().replaceAll('-', '')}`): Promise<MoveResult> {
  return apiRequest(`/mission-attempts/${attempt.id}/moves`, {
    method: 'POST',
    body: JSON.stringify({
      clientMoveId,
      missionVersion: attempt.missionVersion,
      expectedMoveNumber: attempt.moveCount,
      boardHash: attempt.boardHash,
      move: point,
    }),
  });
}

export function getMissionAttempt(attemptId: string): Promise<{ attempt: MissionAttempt; mission: MissionSummary }> {
  return apiRequest(`/mission-attempts/${encodeURIComponent(attemptId)}`);
}

export function useMissionHint(attemptId: string): Promise<{ hintLevel: number; hint: unknown; score: number }> {
  return apiRequest(`/mission-attempts/${attemptId}/hints`, { method: 'POST', body: '{}' });
}

export function retryMission(attemptId: string): Promise<{ attempt: MissionAttempt }> {
  return apiRequest(`/mission-attempts/${attemptId}/retry`, { method: 'POST', body: '{}' });
}

export function getMyRewards(): Promise<MyRewards> {
  return apiRequest('/me/rewards');
}

export function listAdminMissions(): Promise<{ items: AdminMission[] }> {
  return apiRequest('/admin/missions');
}

export function getAdminMission(id: string): Promise<{ mission: AdminMission }> {
  return apiRequest(`/admin/missions/${encodeURIComponent(id)}`);
}

export function createAdminMission(input: Record<string, unknown>): Promise<{ mission: AdminMission }> {
  return apiRequest('/admin/missions', { method: 'POST', body: JSON.stringify(input) });
}

export function updateAdminMission(id: string, input: Record<string, unknown>): Promise<{ mission: AdminMission }> {
  return apiRequest(`/admin/missions/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) });
}

export function validateAdminMission(id: string): Promise<{ valid: boolean; errors: string[]; checkedAt: string }> {
  return apiRequest(`/admin/missions/${encodeURIComponent(id)}/validate`, { method: 'POST', body: '{}' });
}

export function previewAdminMission(id: string, moves: Point[]): Promise<{ preview: AdminMissionPreview }> {
  return apiRequest(`/admin/missions/${encodeURIComponent(id)}/preview`, {
    method: 'POST',
    body: JSON.stringify({ moves }),
  });
}

export function getAdminMissionStatistics(id: string): Promise<AdminMissionStatistics> {
  return apiRequest(`/admin/missions/${encodeURIComponent(id)}/statistics`);
}

export function publishAdminMission(id: string): Promise<{ mission: AdminMission }> {
  return apiRequest(`/admin/missions/${encodeURIComponent(id)}/publish`, { method: 'POST', body: '{}' });
}
