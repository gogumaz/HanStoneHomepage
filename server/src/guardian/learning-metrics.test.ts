import { describe, expect, it } from 'vitest';
import { calculateWeeklyLearningMetrics, koreanWeekWindow } from './learning-metrics.js';

const hour = 60 * 60 * 1_000;
const day = 24 * hour;

describe('weekly learning metrics', () => {
  it('uses the Korean Monday boundary, unique study dates, and first attempts only', () => {
    const now = new Date('2026-08-29T03:00:00.000Z');
    const { start, end } = koreanWeekWindow(now);
    expect(start.toISOString()).toBe('2026-08-23T15:00:00.000Z');
    expect(end.toISOString()).toBe('2026-08-30T15:00:00.000Z');

    const metrics = calculateWeeklyLearningMetrics({
      now,
      lessonActivityAt: [
        new Date(start.getTime() - 1),
        new Date(start.getTime() + 2 * hour),
        new Date(start.getTime() + 5 * hour),
        new Date(start.getTime() + day + 2 * hour),
      ],
      missionAttempts: [
        { missionId: 'A', status: 'COMPLETED', wrongMoveCount: 0, startedAt: new Date(start.getTime() + 2 * day), lastPlayedAt: new Date(start.getTime() + 2 * day + hour) },
        { missionId: 'A', status: 'COMPLETED', wrongMoveCount: 0, startedAt: new Date(start.getTime() + 3 * day), lastPlayedAt: new Date(start.getTime() + 3 * day + hour) },
        { missionId: 'B', status: 'COMPLETED', wrongMoveCount: 1, startedAt: new Date(start.getTime() + 4 * day), lastPlayedAt: new Date(start.getTime() + 4 * day + hour) },
        { missionId: 'C', status: 'IN_PROGRESS', wrongMoveCount: 0, startedAt: new Date(start.getTime() + 5 * day), lastPlayedAt: new Date(start.getTime() + 5 * day + hour) },
        { missionId: 'OUTSIDE', status: 'COMPLETED', wrongMoveCount: 0, startedAt: end, lastPlayedAt: end },
      ],
    });

    expect(metrics).toMatchObject({
      studyDays: 6,
      firstAttemptCorrectMissions: 1,
      firstAttemptMissions: 3,
      firstAttemptAccuracy: 33,
    });
  });
});
