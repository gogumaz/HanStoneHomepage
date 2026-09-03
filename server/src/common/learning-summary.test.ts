import { describe, expect, it } from "vitest";
import { summarizeLessonProgress } from "./learning-summary.js";

describe("lesson progress summary", () => {
  it("produces the shared student and guardian progress figures", () => {
    const result = summarizeLessonProgress([
      {
        id: "lesson-1",
        progress: {
          status: "in_progress",
          completedSteps: 1,
          totalSteps: 2,
          lastActivityAt: new Date("2026-08-28T03:00:00.000Z"),
        },
      },
      {
        id: "lesson-2",
        progress: {
          status: "completed",
          completedSteps: 2,
          totalSteps: 2,
          lastActivityAt: new Date("2026-08-27T03:00:00.000Z"),
        },
      },
      {
        id: "lesson-3",
        progress: {
          status: "not_started",
          completedSteps: 0,
          totalSteps: 2,
          lastActivityAt: null,
        },
      },
    ]);

    expect(result.summary).toEqual({
      totalLessons: 3,
      startedLessons: 2,
      completedLessons: 1,
      completionRate: 33,
      completedSteps: 3,
      totalSteps: 6,
      stepCompletionRate: 50,
      lastActivityAt: new Date("2026-08-28T03:00:00.000Z"),
    });
  });
});
