import { HttpStatus, Injectable } from "@nestjs/common";
import type { CurrentUser } from "../auth/auth.types.js";
import { ApiError } from "../common/api-error.js";
import { PrismaService } from "../database/prisma.service.js";
import { LessonStatus, LessonStepType } from "../generated/prisma/enums.js";

const LESSON_ID = /^[A-Z0-9][A-Z0-9-]{2,39}$/;
const STATUS_INPUT: Record<string, LessonStatus> = {
  draft: LessonStatus.DRAFT,
  published: LessonStatus.PUBLISHED,
  archived: LessonStatus.ARCHIVED,
};
const STANDARD_STEPS = [
  [LessonStepType.HISTORY_STORY, "역사 이야기"],
  [LessonStepType.BADUK_CONCEPT, "오늘의 한 수"],
  [LessonStepType.BADUK_MISSION, "판 위의 미션"],
  [LessonStepType.HISTORY_MISSION, "역사 미션"],
  [LessonStepType.REFLECTION, "생각 한 수"],
  [LessonStepType.REWARD, "보상"],
] as const;
const EDITABLE_FIELDS = [
  "eraId",
  "order",
  "level",
  "course",
  "title",
  "summary",
  "instructor",
  "difficulty",
  "durationMinutes",
  "isFreeSample",
] as const;

type LessonFields = {
  eraId: string;
  order: number;
  level: string;
  course: string;
  title: string;
  summary: string;
  instructor: string;
  difficulty: string;
  durationMinutes: number;
  isFreeSample: boolean;
};

type LessonRecord = LessonFields & {
  id: string;
  status: LessonStatus;
  videoAssetKey: string | null;
  thumbnailKey: string | null;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function readObject(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ApiError("INVALID_LESSON", "강의 정보를 입력해 주세요.", HttpStatus.BAD_REQUEST);
  }
  return body as Record<string, unknown>;
}

function textValue(value: unknown, label: string, min: number, max: number): string {
  const result = typeof value === "string" ? value.trim() : "";
  if (result.length < min || result.length > max) {
    throw new ApiError(
      "INVALID_LESSON",
      `${label}은(는) ${min}자 이상 ${max}자 이하로 입력해 주세요.`,
      HttpStatus.BAD_REQUEST,
    );
  }
  return result;
}

function integerValue(value: unknown, label: string, min: number, max: number): number {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    throw new ApiError(
      "INVALID_LESSON",
      `${label}은(는) ${min} 이상 ${max} 이하의 정수여야 합니다.`,
      HttpStatus.BAD_REQUEST,
    );
  }
  return value as number;
}

function lessonFields(data: Record<string, unknown>): LessonFields {
  if (typeof data.isFreeSample !== "boolean") {
    throw new ApiError("INVALID_LESSON", "무료 공개 여부를 선택해 주세요.", HttpStatus.BAD_REQUEST);
  }
  return {
    eraId: textValue(data.eraId, "시대", 3, 40),
    order: integerValue(data.order, "강의 순서", 1, 999),
    level: textValue(data.level, "단계", 1, 80),
    course: textValue(data.course, "과정", 1, 120),
    title: textValue(data.title, "제목", 2, 160),
    summary: textValue(data.summary, "요약", 10, 2000),
    instructor: textValue(data.instructor, "강사", 2, 100),
    difficulty: textValue(data.difficulty, "난이도", 1, 80),
    durationMinutes: integerValue(data.durationMinutes, "예상 시간", 1, 600),
    isFreeSample: data.isFreeSample,
  };
}

function createInput(body: unknown): LessonFields & { id: string } {
  const data = readObject(body);
  const id = typeof data.id === "string" ? data.id.trim().toUpperCase() : "";
  if (!LESSON_ID.test(id)) {
    throw new ApiError(
      "INVALID_LESSON_ID",
      "강의 ID는 영문 대문자·숫자·하이픈 3~40자로 입력해 주세요.",
      HttpStatus.BAD_REQUEST,
    );
  }
  return { id, ...lessonFields(data) };
}

function updateInput(body: unknown, current: LessonFields): LessonFields & { changedFields: string[] } {
  const data = readObject(body);
  const changedFields = EDITABLE_FIELDS.filter((key) => data[key] !== undefined);
  if (changedFields.length === 0) {
    throw new ApiError("INVALID_LESSON", "수정할 강의 정보를 입력해 주세요.", HttpStatus.BAD_REQUEST);
  }
  const merged = Object.fromEntries(
    EDITABLE_FIELDS.map((key) => [key, data[key] === undefined ? current[key] : data[key]]),
  );
  return { ...lessonFields(merged), changedFields };
}

function statusInput(body: unknown): LessonStatus {
  const data = readObject(body);
  const value = typeof data.status === "string" ? data.status.trim().toLowerCase() : "";
  const status = STATUS_INPUT[value];
  if (!status) {
    throw new ApiError(
      "INVALID_LESSON_STATUS",
      "강의 상태는 draft, published, archived 중 하나여야 합니다.",
      HttpStatus.BAD_REQUEST,
    );
  }
  return status;
}

@Injectable()
export class LessonAdminService {
  constructor(private readonly prisma: PrismaService) {}

  async list(include?: string) {
    const statuses = this.parseStatuses(include);
    const [eras, lessons] = await Promise.all([
      this.prisma.era.findMany({ orderBy: { order: "asc" } }),
      this.prisma.lesson.findMany({
        where: { status: { in: statuses } },
        include: {
          era: { select: { id: true, name: true } },
          _count: { select: { steps: true } },
        },
        orderBy: [{ era: { order: "asc" } }, { order: "asc" }],
      }),
    ]);
    return {
      eras: eras.map(({ id, order, name }) => ({ id, order, name })),
      items: lessons.map((lesson) => this.view(lesson)),
    };
  }

  async create(user: CurrentUser, body: unknown, requestId?: string) {
    const input = createInput(body);
    const [era, existingId, occupiedOrder] = await Promise.all([
      this.prisma.era.findUnique({ where: { id: input.eraId }, select: { id: true, name: true } }),
      this.prisma.lesson.findUnique({ where: { id: input.id }, select: { id: true } }),
      this.prisma.lesson.findFirst({
        where: { eraId: input.eraId, order: input.order },
        select: { id: true },
      }),
    ]);
    if (!era) throw new ApiError("ERA_NOT_FOUND", "시대 정보를 찾을 수 없습니다.", HttpStatus.NOT_FOUND);
    if (existingId) throw new ApiError("LESSON_ID_EXISTS", "이미 사용 중인 강의 ID입니다.", HttpStatus.CONFLICT);
    if (occupiedOrder) {
      throw new ApiError("LESSON_ORDER_EXISTS", "해당 시대의 강의 순서가 이미 사용 중입니다.", HttpStatus.CONFLICT);
    }

    const lesson = await this.prisma.$transaction(async (transaction) => {
      const created = await transaction.lesson.create({
        data: { ...input, status: LessonStatus.DRAFT },
      });
      await transaction.lessonStep.createMany({
        data: STANDARD_STEPS.map(([type, title], index) => ({
          id: `${created.id}-${String(index + 1).padStart(2, "0")}`,
          lessonId: created.id,
          order: index + 1,
          type,
          title,
        })),
      });
      await transaction.auditLog.create({
        data: {
          actorId: user.id,
          action: "lesson.created",
          resourceType: "Lesson",
          resourceId: created.id,
          requestId: requestId ?? null,
          metadata: { eraId: created.eraId, order: created.order, status: "draft" },
        },
      });
      return created;
    });
    return this.view({ ...lesson, era, _count: { steps: STANDARD_STEPS.length } });
  }

  async update(user: CurrentUser, lessonId: string, body: unknown, requestId?: string) {
    const current = await this.findLesson(lessonId);
    const input = updateInput(body, current);
    const { changedFields, ...fields } = input;
    const [era, occupiedOrder] = await Promise.all([
      this.prisma.era.findUnique({ where: { id: input.eraId }, select: { id: true, name: true } }),
      this.prisma.lesson.findFirst({
        where: { eraId: input.eraId, order: input.order, NOT: { id: current.id } },
        select: { id: true },
      }),
    ]);
    if (!era) throw new ApiError("ERA_NOT_FOUND", "시대 정보를 찾을 수 없습니다.", HttpStatus.NOT_FOUND);
    if (occupiedOrder) {
      throw new ApiError("LESSON_ORDER_EXISTS", "해당 시대의 강의 순서가 이미 사용 중입니다.", HttpStatus.CONFLICT);
    }

    const updated = await this.prisma.$transaction(async (transaction) => {
      const saved = await transaction.lesson.update({ where: { id: current.id }, data: fields });
      await transaction.auditLog.create({
        data: {
          actorId: user.id,
          action: "lesson.updated",
          resourceType: "Lesson",
          resourceId: current.id,
          requestId: requestId ?? null,
          metadata: { changedFields },
        },
      });
      return saved;
    });
    return this.view({ ...updated, era, _count: current._count });
  }

  async changeStatus(user: CurrentUser, lessonId: string, body: unknown, requestId?: string) {
    const status = statusInput(body);
    const current = await this.findLesson(lessonId);
    if (status === LessonStatus.PUBLISHED && (!current.videoAssetKey || current._count.steps !== STANDARD_STEPS.length)) {
      throw new ApiError(
        "LESSON_NOT_READY_TO_PUBLISH",
        "영상과 6개 기본 단계가 준비된 강의만 공개할 수 있습니다.",
        HttpStatus.CONFLICT,
      );
    }
    if (current.status === status) return this.view(current);

    const updated = await this.prisma.$transaction(async (transaction) => {
      const saved = await transaction.lesson.update({
        where: { id: current.id },
        data: {
          status,
          ...(status === LessonStatus.PUBLISHED && !current.publishedAt
            ? { publishedAt: new Date() }
            : {}),
        },
      });
      await transaction.auditLog.create({
        data: {
          actorId: user.id,
          action: "lesson.status_changed",
          resourceType: "Lesson",
          resourceId: current.id,
          requestId: requestId ?? null,
          metadata: {
            previousStatus: current.status.toLowerCase(),
            status: status.toLowerCase(),
          },
        },
      });
      return saved;
    });
    return this.view({ ...updated, era: current.era, _count: current._count });
  }

  private parseStatuses(include?: string): LessonStatus[] {
    if (!include?.trim()) return Object.values(LessonStatus);
    const values = include.split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
    const mapped = values.map((value) => STATUS_INPUT[value]);
    if (mapped.some((status) => !status) || mapped.length === 0) {
      throw new ApiError("INVALID_LESSON_STATUS", "조회할 강의 상태를 확인해 주세요.", HttpStatus.BAD_REQUEST);
    }
    return [...new Set(mapped as LessonStatus[])];
  }

  private async findLesson(lessonId: string) {
    const lesson = await this.prisma.lesson.findUnique({
      where: { id: lessonId },
      include: {
        era: { select: { id: true, name: true } },
        _count: { select: { steps: true } },
      },
    });
    if (!lesson) throw new ApiError("LESSON_NOT_FOUND", "강의를 찾을 수 없습니다.", HttpStatus.NOT_FOUND);
    return lesson;
  }

  private view(lesson: LessonRecord & { era: { id: string; name: string }; _count: { steps: number } }) {
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
      status: lesson.status.toLowerCase(),
      isFreeSample: lesson.isFreeSample,
      hasVideo: Boolean(lesson.videoAssetKey),
      stepCount: lesson._count.steps,
      publishedAt: lesson.publishedAt,
      createdAt: lesson.createdAt,
      updatedAt: lesson.updatedAt,
    };
  }
}
