export type LessonProgressSummaryItem = {
  progress: {
    status: string;
    completedSteps: number;
    totalSteps: number;
    lastActivityAt: Date | null;
  };
};

export function summarizeLessonProgress<T extends LessonProgressSummaryItem>(items: T[]) {
  const startedItems = items.filter((item) => item.progress.status !== "not_started");
  const completedItems = items.filter((item) => item.progress.status === "completed");
  const totalSteps = items.reduce((sum, item) => sum + item.progress.totalSteps, 0);
  const completedSteps = items.reduce((sum, item) => sum + item.progress.completedSteps, 0);
  const lastActivityAt = startedItems.reduce<Date | null>((latest, item) => {
    const current = item.progress.lastActivityAt;
    return current && (!latest || current > latest) ? current : latest;
  }, null);

  return {
    startedItems,
    completedItems,
    summary: {
      totalLessons: items.length,
      startedLessons: startedItems.length,
      completedLessons: completedItems.length,
      completionRate: items.length ? Math.round((completedItems.length / items.length) * 100) : 0,
      completedSteps,
      totalSteps,
      stepCompletionRate: totalSteps ? Math.round((completedSteps / totalSteps) * 100) : 0,
      lastActivityAt,
    },
  };
}
