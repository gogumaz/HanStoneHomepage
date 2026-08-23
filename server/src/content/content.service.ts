import { HttpStatus, Injectable } from "@nestjs/common";
import { ApiError } from "../common/api-error.js";
import { PrismaService } from "../database/prisma.service.js";
import { LessonStatus } from "../generated/prisma/enums.js";
import type { EraView, LessonView } from "./content.types.js";

@Injectable()
export class ContentService {
  constructor(private readonly prisma: PrismaService) {}

  async listEras(): Promise<EraView[]> {
    const eras = await this.prisma.era.findMany({
      orderBy: { order: "asc" },
      include: {
        _count: {
          select: {
            lessons: { where: { status: LessonStatus.PUBLISHED } },
          },
        },
      },
    });

    return eras.map((era) => ({
      id: era.id,
      order: era.order,
      name: era.name,
      theme: era.theme,
      description: era.description,
      status: era._count.lessons > 0 ? "available" : "coming_soon",
      completedLessons: 0,
      totalLessons: era._count.lessons,
    }));
  }

  async listLessons(eraId?: string): Promise<{ era: EraView | null; items: LessonView[] }> {
    let era: EraView | null = null;
    if (eraId) {
      const eraRecord = await this.prisma.era.findUnique({
        where: { id: eraId },
        include: {
          _count: {
            select: { lessons: { where: { status: LessonStatus.PUBLISHED } } },
          },
        },
      });
      if (!eraRecord) {
        throw new ApiError("ERA_NOT_FOUND", "시대 정보를 찾을 수 없습니다.", HttpStatus.NOT_FOUND);
      }
      era = {
        id: eraRecord.id,
        order: eraRecord.order,
        name: eraRecord.name,
        theme: eraRecord.theme,
        description: eraRecord.description,
        status: eraRecord._count.lessons > 0 ? "available" : "coming_soon",
        completedLessons: 0,
        totalLessons: eraRecord._count.lessons,
      };
    }

    const lessons = await this.prisma.lesson.findMany({
      where: {
        status: LessonStatus.PUBLISHED,
        ...(eraId ? { eraId } : {}),
      },
      include: {
        era: { select: { id: true, name: true } },
        steps: { orderBy: { order: "asc" } },
      },
      orderBy: [{ era: { order: "asc" } }, { order: "asc" }],
    });
    return { era, items: lessons.map((lesson) => this.toLessonView(lesson)) };
  }

  async getLesson(lessonId: string): Promise<LessonView> {
    const lesson = await this.prisma.lesson.findFirst({
      where: { id: lessonId, status: LessonStatus.PUBLISHED },
      include: {
        era: { select: { id: true, name: true } },
        steps: { orderBy: { order: "asc" } },
      },
    });
    if (!lesson) {
      throw new ApiError("LESSON_NOT_FOUND", "공개된 강의를 찾을 수 없습니다.", HttpStatus.NOT_FOUND);
    }
    return this.toLessonView(lesson);
  }

  private toLessonView(lesson: {
    id: string;
    order: number;
    level: string;
    course: string;
    title: string;
    summary: string;
    instructor: string;
    difficulty: string;
    durationMinutes: number;
    isFreeSample: boolean;
    thumbnailKey: string | null;
    publishedAt: Date | null;
    era: { id: string; name: string };
    steps: Array<{ id: string; order: number; type: string; title: string }>;
  }): LessonView {
    return {
      id: lesson.id,
      era: lesson.era,
      order: lesson.order,
      level: lesson.level,
      course: lesson.course,
      title: lesson.title,
      summary: lesson.summary,
      instructor: lesson.instructor,
      difficulty: lesson.difficulty,
      durationMinutes: lesson.durationMinutes,
      isFreeSample: lesson.isFreeSample,
      hasThumbnail: Boolean(lesson.thumbnailKey),
      access: lesson.isFreeSample ? "free_sample" : "subscription",
      publishedAt: lesson.publishedAt,
      steps: lesson.steps.map((step) => ({
        id: step.id,
        order: step.order,
        type: step.type.toLowerCase(),
        title: step.title,
      })),
    };
  }
}
