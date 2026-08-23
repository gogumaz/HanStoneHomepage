import { HttpStatus, Injectable } from "@nestjs/common";
import type { CurrentUser } from "../auth/auth.types.js";
import { ApiError } from "../common/api-error.js";
import { PrismaService } from "../database/prisma.service.js";
import { LessonProgressStatus, LessonStatus } from "../generated/prisma/enums.js";
import type { LessonProgressView } from "./content.types.js";
import { LessonAccessService } from "./lesson-access.service.js";

@Injectable()
export class LessonProgressService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessService: LessonAccessService,
  ) {}

  async getProgress(user: CurrentUser, lessonId: string): Promise<LessonProgressView> {
    const lesson = await this.prisma.lesson.findFirst({
      where: { id: lessonId, status: LessonStatus.PUBLISHED },
      select: { id: true, _count: { select: { steps: true } } },
    });
    if (!lesson) {
      throw new ApiError("LESSON_NOT_FOUND", "공개된 강의를 찾을 수 없습니다.", HttpStatus.NOT_FOUND);
    }
    const progress = await this.prisma.lessonProgress.findUnique({
      where: { userId_lessonId: { userId: user.id, lessonId } },
      include: {
        stepCompletions: {
          select: { stepId: true },
          orderBy: { completedAt: "asc" },
        },
      },
    });
    if (!progress) {
      return {
        lessonId,
        status: "not_started",
        completedStepIds: [],
        completedSteps: 0,
        totalSteps: lesson._count.steps,
        lastPositionSeconds: 0,
        startedAt: null,
        completedAt: null,
      };
    }
    return {
      lessonId,
      status: progress.status.toLowerCase() as LessonProgressView["status"],
      completedStepIds: progress.stepCompletions.map((item) => item.stepId),
      completedSteps: progress.stepCompletions.length,
      totalSteps: lesson._count.steps,
      lastPositionSeconds: progress.lastPositionSeconds,
      startedAt: progress.startedAt,
      completedAt: progress.completedAt,
    };
  }

  async start(user: CurrentUser, lessonId: string, requestId?: string) {
    await this.accessService.requireLessonAccess(lessonId, user);
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.lessonProgress.upsert({
        where: { userId_lessonId: { userId: user.id, lessonId } },
        create: { userId: user.id, lessonId, startedAt: now },
        update: { updatedAt: now },
      }),
      this.prisma.auditLog.create({
        data: {
          actorId: user.id,
          action: "lesson.started",
          resourceType: "Lesson",
          resourceId: lessonId,
          requestId: requestId ?? null,
        },
      }),
    ]);
    return this.getProgress(user, lessonId);
  }

  async completeStep(
    user: CurrentUser,
    lessonId: string,
    stepId: string,
    requestId?: string,
  ): Promise<LessonProgressView> {
    await this.accessService.requireLessonAccess(lessonId, user);
    const step = await this.prisma.lessonStep.findFirst({
      where: { id: stepId, lessonId },
      select: { id: true },
    });
    if (!step) {
      throw new ApiError("LESSON_STEP_NOT_FOUND", "강의 단계를 찾을 수 없습니다.", HttpStatus.NOT_FOUND);
    }

    const now = new Date();
    await this.prisma.$transaction(async (transaction) => {
      const progress = await transaction.lessonProgress.upsert({
        where: { userId_lessonId: { userId: user.id, lessonId } },
        create: { userId: user.id, lessonId, startedAt: now },
        update: { updatedAt: now },
      });
      await transaction.lessonStepCompletion.upsert({
        where: { progressId_stepId: { progressId: progress.id, stepId } },
        create: { progressId: progress.id, stepId, completedAt: now },
        update: {},
      });
      await transaction.auditLog.create({
        data: {
          actorId: user.id,
          action: "lesson.step.completed",
          resourceType: "LessonStep",
          resourceId: stepId,
          requestId: requestId ?? null,
          metadata: { lessonId },
        },
      });
    });
    return this.getProgress(user, lessonId);
  }

  async completeLesson(
    user: CurrentUser,
    lessonId: string,
    requestId?: string,
  ): Promise<LessonProgressView> {
    await this.accessService.requireLessonAccess(lessonId, user);
    const [totalSteps, progress] = await Promise.all([
      this.prisma.lessonStep.count({ where: { lessonId } }),
      this.prisma.lessonProgress.findUnique({
        where: { userId_lessonId: { userId: user.id, lessonId } },
        include: { _count: { select: { stepCompletions: true } } },
      }),
    ]);
    if (!progress || totalSteps === 0 || progress._count.stepCompletions < totalSteps) {
      throw new ApiError("LESSON_STEPS_INCOMPLETE", "모든 강의 단계를 완료해 주세요.", HttpStatus.CONFLICT);
    }
    if (progress.status !== LessonProgressStatus.COMPLETED) {
      const completedAt = new Date();
      await this.prisma.$transaction([
        this.prisma.lessonProgress.update({
          where: { id: progress.id },
          data: { status: LessonProgressStatus.COMPLETED, completedAt },
        }),
        this.prisma.auditLog.create({
          data: {
            actorId: user.id,
            action: "lesson.completed",
            resourceType: "Lesson",
            resourceId: lessonId,
            requestId: requestId ?? null,
          },
        }),
      ]);
    }
    return this.getProgress(user, lessonId);
  }
}
