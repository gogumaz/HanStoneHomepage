import { Injectable } from "@nestjs/common";
import type { CurrentUser } from "../auth/auth.types.js";
import { PrismaService } from "../database/prisma.service.js";
import {
  LessonStatus,
  SubscriptionPaymentStatus,
} from "../generated/prisma/enums.js";
import { calculateWeeklyLearningMetrics, koreanWeekWindow } from "../guardian/learning-metrics.js";
import { summarizeLessonProgress } from "../common/learning-summary.js";

@Injectable()
export class StudentDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboard(student: CurrentUser) {
    const now = new Date();
    const week = koreanWeekWindow(now);
    const [eras, subscription, stepActivities, missionAttempts] = await Promise.all([
      this.prisma.era.findMany({
        orderBy: { order: "asc" },
        include: {
          lessons: {
            where: { status: LessonStatus.PUBLISHED },
            orderBy: { order: "asc" },
            include: {
              _count: { select: { steps: true } },
              progress: {
                where: { userId: student.id },
                select: {
                  status: true,
                  startedAt: true,
                  completedAt: true,
                  updatedAt: true,
                  lastPositionSeconds: true,
                  _count: { select: { stepCompletions: true } },
                },
              },
            },
          },
        },
      }),
      this.prisma.accountSubscription.findFirst({
        where: {
          userId: student.id,
          paymentStatus: SubscriptionPaymentStatus.PAID,
          startsAt: { lte: now },
          endsAt: { gt: now },
        },
        orderBy: { endsAt: "desc" },
        select: { endsAt: true },
      }),
      this.prisma.lessonStepCompletion.findMany({
        where: {
          progress: { userId: student.id },
          completedAt: { gte: week.start, lt: week.end },
        },
        select: { completedAt: true },
      }),
      this.prisma.missionAttempt.findMany({
        where: {
          userId: student.id,
          lastPlayedAt: { gte: week.start, lt: week.end },
        },
        select: {
          missionId: true,
          status: true,
          wrongMoveCount: true,
          startedAt: true,
          lastPlayedAt: true,
        },
        orderBy: { startedAt: "asc" },
      }),
    ]);
    const hasActiveSubscription = Boolean(subscription);
    const lessonItems = eras.flatMap((era) => era.lessons.map((lesson) => {
      const progress = lesson.progress[0] ?? null;
      return {
        lesson: {
          id: lesson.id,
          era: { id: era.id, name: era.name, order: era.order },
          order: lesson.order,
          course: lesson.course,
          title: lesson.title,
          durationMinutes: lesson.durationMinutes,
          isFreeSample: lesson.isFreeSample,
          accessible: lesson.isFreeSample || hasActiveSubscription,
        },
        progress: {
          status: progress?.status.toLowerCase() ?? "not_started",
          completedSteps: progress?._count.stepCompletions ?? 0,
          totalSteps: lesson._count.steps,
          lastPositionSeconds: progress?.lastPositionSeconds ?? 0,
          startedAt: progress?.startedAt ?? null,
          completedAt: progress?.completedAt ?? null,
          lastActivityAt: progress?.updatedAt ?? null,
        },
      };
    }));
    const { startedItems, summary } = summarizeLessonProgress(lessonItems);
    const recentLessons = [...startedItems]
      .sort((left, right) =>
        (right.progress.lastActivityAt?.getTime() ?? 0) - (left.progress.lastActivityAt?.getTime() ?? 0))
      .slice(0, 5);
    const continuing = recentLessons.find((item) =>
      item.progress.status === "in_progress" && item.lesson.accessible);
    const nextUnstarted = lessonItems.find((item) =>
      item.progress.status === "not_started" && item.lesson.accessible);
    const recommended = continuing ?? nextUnstarted ?? null;
    const weekly = calculateWeeklyLearningMetrics({
      now,
      lessonActivityAt: [
        ...stepActivities.map((item) => item.completedAt),
        ...startedItems.flatMap((item) => item.progress.lastActivityAt ? [item.progress.lastActivityAt] : []),
      ],
      missionAttempts,
    });

    return {
      student: { id: student.id, displayName: student.displayName },
      generatedAt: now,
      access: {
        hasActiveSubscription,
        subscriptionEndsAt: subscription?.endsAt ?? null,
      },
      summary: {
        ...summary,
        weekly,
      },
      eras: eras.map((era) => {
        const items = lessonItems.filter((item) => item.lesson.era.id === era.id);
        const eraStarted = items.filter((item) => item.progress.status !== "not_started").length;
        const eraCompleted = items.filter((item) => item.progress.status === "completed").length;
        return {
          id: era.id,
          order: era.order,
          name: era.name,
          theme: era.theme,
          description: era.description,
          totalLessons: items.length,
          startedLessons: eraStarted,
          completedLessons: eraCompleted,
          completionRate: items.length ? Math.round((eraCompleted / items.length) * 100) : 0,
          status: items.length === 0
            ? "coming_soon" as const
            : eraCompleted === items.length
              ? "completed" as const
              : eraStarted > 0
                ? "in_progress" as const
                : "not_started" as const,
        };
      }),
      recentLessons,
      nextLesson: recommended ? {
        ...recommended,
        reason: continuing ? "continue" as const : "next" as const,
      } : null,
    };
  }
}
