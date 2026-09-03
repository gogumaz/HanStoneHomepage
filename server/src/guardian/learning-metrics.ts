const KOREA_OFFSET_MS = 9 * 60 * 60 * 1_000;
const DAY_MS = 24 * 60 * 60 * 1_000;

export type MissionLearningActivity = {
  missionId: string;
  status: string;
  wrongMoveCount: number;
  startedAt: Date;
  lastPlayedAt: Date;
};

export function koreanWeekWindow(now: Date): { start: Date; end: Date } {
  const koreaNow = new Date(now.getTime() + KOREA_OFFSET_MS);
  const daysSinceMonday = (koreaNow.getUTCDay() + 6) % 7;
  const koreaMonday = Date.UTC(
    koreaNow.getUTCFullYear(),
    koreaNow.getUTCMonth(),
    koreaNow.getUTCDate() - daysSinceMonday,
  );
  const start = new Date(koreaMonday - KOREA_OFFSET_MS);
  return { start, end: new Date(start.getTime() + 7 * DAY_MS) };
}

function koreanDateKey(value: Date): string {
  return new Date(value.getTime() + KOREA_OFFSET_MS).toISOString().slice(0, 10);
}

function within(value: Date, start: Date, end: Date): boolean {
  return value >= start && value < end;
}

export function calculateWeeklyLearningMetrics(input: {
  now: Date;
  lessonActivityAt: Date[];
  missionAttempts: MissionLearningActivity[];
}) {
  const { start, end } = koreanWeekWindow(input.now);
  const studyDates = new Set<string>();
  for (const activityAt of input.lessonActivityAt) {
    if (within(activityAt, start, end)) studyDates.add(koreanDateKey(activityAt));
  }
  for (const attempt of input.missionAttempts) {
    if (within(attempt.lastPlayedAt, start, end)) studyDates.add(koreanDateKey(attempt.lastPlayedAt));
  }

  const firstAttempts = new Map<string, MissionLearningActivity>();
  for (const attempt of [...input.missionAttempts].sort(
    (left, right) => left.startedAt.getTime() - right.startedAt.getTime(),
  )) {
    if (within(attempt.startedAt, start, end) && !firstAttempts.has(attempt.missionId)) {
      firstAttempts.set(attempt.missionId, attempt);
    }
  }
  const attempts = [...firstAttempts.values()];
  const correct = attempts.filter((attempt) =>
    attempt.status.toLowerCase() === 'completed' && attempt.wrongMoveCount === 0).length;

  return {
    periodStart: start,
    periodEnd: end,
    studyDays: studyDates.size,
    firstAttemptCorrectMissions: correct,
    firstAttemptMissions: attempts.length,
    firstAttemptAccuracy: attempts.length ? Math.round((correct / attempts.length) * 100) : 0,
  };
}
