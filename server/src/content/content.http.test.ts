import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "../app.module.js";
import { ApiExceptionFilter } from "../common/api-exception.filter.js";
import { ApiResponseInterceptor } from "../common/api-response.interceptor.js";
import { RequestIdMiddleware } from "../common/request-id.middleware.js";
import { PrismaService } from "../database/prisma.service.js";
import { LessonStatus } from "../generated/prisma/enums.js";

const eras = [
  { id: "era_prehistoric", order: 1, name: "선사시대", theme: "주변을 살펴라", description: "첫 시대" },
  { id: "era_gojoseon", order: 2, name: "고조선", theme: "내 영역을 만들다", description: "두 번째 시대" },
  { id: "era_goryeo", order: 3, name: "고려", theme: "균형을 지켜라", description: "준비 중 시대" },
];
const lessons = [
  {
    id: "PRE-01", eraId: "era_prehistoric", order: 1, level: "입문", course: "입문 1권",
    title: "주먹도끼에서 배운 첫 수", summary: "첫 강의", instructor: "김바둑 선생님",
    difficulty: "처음 시작", durationMinutes: 8, status: LessonStatus.PUBLISHED,
    isFreeSample: true, thumbnailKey: "lesson-assets/thumb/source.webp",
    publishedAt: new Date("2026-08-01T00:00:00.000Z"),
  },
  {
    id: "PRE-DRAFT", eraId: "era_prehistoric", order: 2, level: "입문", course: "입문 1권",
    title: "공개 전 강의", summary: "숨겨야 함", instructor: "운영자",
    difficulty: "처음 시작", durationMinutes: 9, status: LessonStatus.DRAFT,
    isFreeSample: true, thumbnailKey: null, publishedAt: null,
  },
  {
    id: "GOJ-01", eraId: "era_gojoseon", order: 1, level: "입문", course: "입문 1권",
    title: "고조선의 첫 수", summary: "두 번째 공개 강의", instructor: "김바둑 선생님",
    difficulty: "처음 시작", durationMinutes: 10, status: LessonStatus.PUBLISHED,
    isFreeSample: false, thumbnailKey: null, publishedAt: new Date("2026-08-02T00:00:00.000Z"),
  },
];
const steps = [
  { id: "PRE-01-01", lessonId: "PRE-01", order: 1, type: "HISTORY_STORY", title: "역사 이야기" },
  { id: "PRE-01-02", lessonId: "PRE-01", order: 2, type: "BADUK_CONCEPT", title: "오늘의 한 수" },
];

function withCount(era: (typeof eras)[number]) {
  return {
    ...era,
    _count: {
      lessons: lessons.filter((lesson) =>
        lesson.eraId === era.id && lesson.status === LessonStatus.PUBLISHED).length,
    },
  };
}

function withEra(lesson: (typeof lessons)[number]) {
  const era = eras.find((item) => item.id === lesson.eraId);
  return {
    ...lesson,
    era: { id: era?.id ?? "", name: era?.name ?? "" },
    steps: steps.filter((step) => step.lessonId === lesson.id),
  };
}

function createPrismaMock(): PrismaService {
  return {
    era: {
      findMany: vi.fn(async () => eras.map(withCount)),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const era = eras.find((item) => item.id === where.id);
        return era ? withCount(era) : null;
      }),
    },
    lesson: {
      findMany: vi.fn(async ({ where }: { where: { status: LessonStatus; eraId?: string } }) =>
        lessons
          .filter((lesson) => lesson.status === where.status && (!where.eraId || lesson.eraId === where.eraId))
          .sort((a, b) => {
            const eraOrder = (eras.find((era) => era.id === a.eraId)?.order ?? 0)
              - (eras.find((era) => era.id === b.eraId)?.order ?? 0);
            return eraOrder || a.order - b.order;
          })
          .map(withEra)),
      findFirst: vi.fn(async ({ where }: { where: { id: string; status: LessonStatus } }) => {
        const lesson = lessons.find((item) => item.id === where.id && item.status === where.status);
        return lesson ? withEra(lesson) : null;
      }),
    },
    isReady: vi.fn(async () => true),
  } as unknown as PrismaService;
}

describe("public era and lesson HTTP API", () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5432/test";
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(createPrismaMock())
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    const requestId = new RequestIdMiddleware();
    app.use(requestId.use.bind(requestId));
    app.useGlobalFilters(new ApiExceptionFilter());
    app.useGlobalInterceptors(new ApiResponseInterceptor());
    await app.listen(0, "127.0.0.1");
    baseUrl = await app.getUrl();
  });

  afterAll(async () => app.close());

  it("orders eras and derives available or coming-soon status from published lessons", async () => {
    const response = await fetch(`${baseUrl}/api/v1/eras`);
    const body = await response.json() as {
      data: Array<{ id: string; status: string; totalLessons: number }>;
    };

    expect(response.status).toBe(200);
    expect(body.data.map((era) => era.id)).toEqual([
      "era_prehistoric", "era_gojoseon", "era_goryeo",
    ]);
    expect(body.data[0]).toMatchObject({ status: "available", totalLessons: 1 });
    expect(body.data[2]).toMatchObject({ status: "coming_soon", totalLessons: 0 });
  });

  it("returns only published lessons and hides draft details", async () => {
    const listResponse = await fetch(`${baseUrl}/api/v1/eras/era_prehistoric/lessons`);
    const list = await listResponse.json() as {
      data: { items: Array<{ id: string; access: string; hasThumbnail: boolean }> };
    };
    expect(listResponse.status).toBe(200);
    expect(list.data.items).toEqual([
      expect.objectContaining({ id: "PRE-01", access: "free_sample", hasThumbnail: true }),
    ]);

    const emptyResponse = await fetch(`${baseUrl}/api/v1/eras/era_goryeo/lessons`);
    const empty = await emptyResponse.json() as { data: { items: unknown[] } };
    expect(empty.data.items).toEqual([]);

    const detailResponse = await fetch(`${baseUrl}/api/v1/lessons/PRE-01`);
    const detail = await detailResponse.json() as { data: { id: string; isFreeSample: boolean } };
    expect(detailResponse.status).toBe(200);
    expect(detail.data).toMatchObject({ id: "PRE-01", isFreeSample: true });

    const draftResponse = await fetch(`${baseUrl}/api/v1/lessons/PRE-DRAFT`);
    const draft = await draftResponse.json() as { error: { code: string } };
    expect(draftResponse.status).toBe(404);
    expect(draft.error.code).toBe("LESSON_NOT_FOUND");
  });

  it("returns a structured error for an unknown era", async () => {
    const response = await fetch(`${baseUrl}/api/v1/eras/era_unknown/lessons`);
    const body = await response.json() as { error: { code: string; requestId: string } };
    expect(response.status).toBe(404);
    expect(body.error.code).toBe("ERA_NOT_FOUND");
    expect(body.error.requestId).toMatch(/^req_/);
  });
});
