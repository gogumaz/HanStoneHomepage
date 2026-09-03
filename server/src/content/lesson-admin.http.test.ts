import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "../app.module.js";
import { hashSessionToken } from "../auth/session-cookie.js";
import { ApiExceptionFilter } from "../common/api-exception.filter.js";
import { ApiResponseInterceptor } from "../common/api-response.interceptor.js";
import { RequestIdMiddleware } from "../common/request-id.middleware.js";
import { PrismaService } from "../database/prisma.service.js";
import { listenForHttpTest } from "../test-utils/listen-test-app.js";
import { AccountStatus, LessonStatus, RoleType } from "../generated/prisma/enums.js";
import { ObjectStorageService } from "../storage/object-storage.service.js";
import { MalwareScannerService } from "../storage/malware-scanner.service.js";

type Value = Record<string, any>;

function createPrismaMock(): PrismaService {
  const era = {
    id: "era_prehistoric",
    order: 1,
    name: "선사시대",
    theme: "주변을 살펴라",
    description: "첫 시대",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const users = [
    { id: "student-1", email: "student@example.com", displayName: "학생", status: AccountStatus.ACTIVE, roles: [{ role: RoleType.STUDENT }] },
    { id: "operator-1", email: "operator@example.com", displayName: "운영자", status: AccountStatus.ACTIVE, roles: [{ role: RoleType.OPERATOR }] },
  ];
  const sessions = [
    ["student-token", "student-1"],
    ["operator-token", "operator-1"],
  ].map(([token, userId], index) => ({
    id: `session-${index}`,
    userId,
    tokenHash: hashSessionToken(token ?? ""),
    expiresAt: new Date(Date.now() + 60_000),
    revokedAt: null,
  }));
  const lessons: Value[] = [{
    id: "DRAFT-01",
    eraId: era.id,
    order: 1,
    level: "입문",
    course: "입문 1권",
    title: "공개 준비 강의",
    summary: "영상이 연결된 공개 준비 강의입니다.",
    instructor: "김바둑 선생님",
    difficulty: "처음 시작",
    durationMinutes: 10,
    status: LessonStatus.DRAFT,
    isFreeSample: false,
    videoAssetKey: "lesson-videos/draft.mp4",
    thumbnailKey: null,
    publishedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }];
  const steps: Value[] = Array.from({ length: 6 }, (_, index) => ({
    id: `DRAFT-01-${String(index + 1).padStart(2, "0")}`,
    lessonId: "DRAFT-01",
    order: index + 1,
  }));
  const assets: Value[] = [];

  const withRelations = (lesson: Value) => ({
    ...lesson,
    era: { id: era.id, name: era.name },
    _count: { steps: steps.filter((step) => step.lessonId === lesson.id).length },
  });

  const prisma = {
    session: {
      findUnique: vi.fn(async ({ where, include }: Value) => {
        const session = sessions.find((item) => item.tokenHash === where.tokenHash);
        return session && include
          ? { ...session, user: users.find((user) => user.id === session.userId) }
          : session ?? null;
      }),
    },
    era: {
      findMany: vi.fn(async () => [era]),
      findUnique: vi.fn(async ({ where }: Value) => where.id === era.id ? era : null),
    },
    lesson: {
      findMany: vi.fn(async ({ where }: Value) => lessons
        .filter((lesson) => where.status.in.includes(lesson.status))
        .map(withRelations)),
      findUnique: vi.fn(async ({ where, include }: Value) => {
        const lesson = lessons.find((item) => item.id === where.id);
        return lesson && include ? withRelations(lesson) : lesson ?? null;
      }),
      findFirst: vi.fn(async ({ where }: Value) => {
        if (where.status) {
          const lesson = lessons.find((item) => item.id === where.id && item.status === where.status);
          return lesson ? withRelations(lesson) : null;
        }
        return lessons.find((item) =>
          item.eraId === where.eraId
          && item.order === where.order
          && (!where.NOT || item.id !== where.NOT.id)) ?? null;
      }),
      create: vi.fn(async ({ data }: Value) => {
        const lesson = {
          ...data,
          videoAssetKey: null,
          thumbnailKey: null,
          publishedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        lessons.push(lesson);
        return lesson;
      }),
      update: vi.fn(async ({ where, data }: Value) => {
        const lesson = lessons.find((item) => item.id === where.id);
        Object.assign(lesson ?? {}, data, { updatedAt: new Date() });
        return lesson;
      }),
    },
    lessonStep: {
      createMany: vi.fn(async ({ data }: Value) => {
        steps.push(...data);
        return { count: data.length };
      }),
    },
    lessonAsset: {
      create: vi.fn(async ({ data }: Value) => {
        const asset = {
          ...data,
          scanProvider: null,
          scanResult: null,
          scannedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        assets.push(asset);
        return asset;
      }),
      findFirst: vi.fn(async ({ where }: Value) => assets.find((asset) =>
        asset.id === where.id && asset.lessonId === where.lessonId) ?? null),
      findMany: vi.fn(async ({ where }: Value) => assets.filter((asset) => asset.lessonId === where.lessonId)),
      update: vi.fn(async ({ where, data }: Value) => {
        const asset = assets.find((item) => item.id === where.id);
        Object.assign(asset ?? {}, data, { updatedAt: new Date() });
        return asset;
      }),
    },
    auditLog: { create: vi.fn(async () => ({ id: "audit" })) },
    isReady: vi.fn(async () => true),
    $transaction: vi.fn(async (callback: (transaction: typeof prisma) => unknown) => callback(prisma)),
  };
  return prisma as unknown as PrismaService;
}

describe("admin lesson CMS HTTP API", () => {
  let app: INestApplication;
  let baseUrl: string;
  const operatorHeaders = {
    cookie: "baduk_session=operator-token",
    "content-type": "application/json",
  };
  const malwareScan = vi.fn()
    .mockResolvedValueOnce({ clean: true, provider: "clamav", result: "OK" })
    .mockResolvedValueOnce({ clean: false, provider: "clamav", result: "Eicar-Signature" });

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5432/test";
    process.env.SESSION_COOKIE_NAME = "baduk_session";
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(createPrismaMock())
      .overrideProvider(ObjectStorageService)
      .useValue({
        getLessonAssetMaxBytes: () => 50 * 1024 * 1024,
        createLessonAssetUpload: vi.fn(async (input: Value) => ({
          method: "POST",
          url: "https://storage.example.test/private-media",
          fields: { key: `lesson-assets/${input.assetId}/source.${input.extension}` },
          objectKey: `lesson-assets/${input.assetId}/source.${input.extension}`,
          expiresAt: new Date(Date.now() + 300_000),
        })),
        inspectLessonAsset: vi.fn(async () => Uint8Array.from(Buffer.from("%PDF-1.7 test"))),
      })
      .overrideProvider(MalwareScannerService)
      .useValue({ scan: malwareScan })
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    const requestId = new RequestIdMiddleware();
    app.use(requestId.use.bind(requestId));
    app.useGlobalFilters(new ApiExceptionFilter());
    app.useGlobalInterceptors(new ApiResponseInterceptor());
    baseUrl = await listenForHttpTest(app);
  });

  afterAll(async () => app.close());

  it("requires an operator role to list draft and archived lessons", async () => {
    const guest = await fetch(`${baseUrl}/api/v1/admin/lessons`);
    expect(guest.status).toBe(401);

    const student = await fetch(`${baseUrl}/api/v1/admin/lessons`, {
      headers: { cookie: "baduk_session=student-token" },
    });
    expect(student.status).toBe(403);

    const operator = await fetch(`${baseUrl}/api/v1/admin/lessons`, { headers: operatorHeaders });
    const body = await operator.json() as { data: { items: Array<{ id: string; status: string; hasVideo: boolean }> } };
    expect(operator.status).toBe(200);
    expect(body.data.items).toEqual([
      expect.objectContaining({ id: "DRAFT-01", status: "draft", hasVideo: true }),
    ]);
  });

  it("creates a draft with six standard steps and rejects duplicate ordering", async () => {
    const input = {
      id: "DRAFT-02",
      eraId: "era_prehistoric",
      order: 2,
      level: "입문",
      course: "입문 1권",
      title: "두 번째 선사 강의",
      summary: "관리자 CMS에서 새로 등록한 두 번째 강의입니다.",
      instructor: "김바둑 선생님",
      difficulty: "처음 시작",
      durationMinutes: 12,
      isFreeSample: false,
    };
    const created = await fetch(`${baseUrl}/api/v1/admin/lessons`, {
      method: "POST", headers: operatorHeaders, body: JSON.stringify(input),
    });
    const body = await created.json() as { data: { id: string; status: string; stepCount: number } };
    expect(created.status).toBe(201);
    expect(body.data).toMatchObject({ id: "DRAFT-02", status: "draft", stepCount: 6 });

    const duplicate = await fetch(`${baseUrl}/api/v1/admin/lessons`, {
      method: "POST",
      headers: operatorHeaders,
      body: JSON.stringify({ ...input, id: "DRAFT-03" }),
    });
    const duplicateBody = await duplicate.json() as { error: { code: string } };
    expect(duplicate.status).toBe(409);
    expect(duplicateBody.error.code).toBe("LESSON_ORDER_EXISTS");
  });

  it("updates lesson metadata and enforces publication readiness", async () => {
    const updated = await fetch(`${baseUrl}/api/v1/admin/lessons/DRAFT-01`, {
      method: "PATCH",
      headers: operatorHeaders,
      body: JSON.stringify({ title: "수정된 공개 준비 강의", isFreeSample: true }),
    });
    const updatedBody = await updated.json() as { data: { title: string; isFreeSample: boolean } };
    expect(updated.status).toBe(200);
    expect(updatedBody.data).toMatchObject({ title: "수정된 공개 준비 강의", isFreeSample: true });

    const notReady = await fetch(`${baseUrl}/api/v1/admin/lessons/DRAFT-02/status`, {
      method: "PATCH", headers: operatorHeaders, body: JSON.stringify({ status: "published" }),
    });
    const notReadyBody = await notReady.json() as { error: { code: string } };
    expect(notReady.status).toBe(409);
    expect(notReadyBody.error.code).toBe("LESSON_NOT_READY_TO_PUBLISH");

    const published = await fetch(`${baseUrl}/api/v1/admin/lessons/DRAFT-01/status`, {
      method: "PATCH", headers: operatorHeaders, body: JSON.stringify({ status: "published" }),
    });
    const publishedBody = await published.json() as { data: { status: string; publishedAt: string } };
    expect(published.status).toBe(200);
    expect(publishedBody.data.status).toBe("published");
    expect(publishedBody.data.publishedAt).toBeTruthy();

    const archived = await fetch(`${baseUrl}/api/v1/admin/lessons/DRAFT-01/status`, {
      method: "PATCH", headers: operatorHeaders, body: JSON.stringify({ status: "archived" }),
    });
    expect(archived.status).toBe(200);
    expect((await archived.json() as { data: { status: string } }).data.status).toBe("archived");
  });

  it("keeps lesson materials quarantined until signature and malware scans pass", async () => {
    const start = async (fileName: string) => fetch(
      `${baseUrl}/api/v1/admin/lessons/DRAFT-01/assets/uploads`,
      {
        method: "POST",
        headers: operatorHeaders,
        body: JSON.stringify({
          kind: "material",
          fileName,
          contentType: "application/pdf",
          size: 13,
        }),
      },
    );

    const cleanStart = await start("activity.pdf");
    const cleanStarted = await cleanStart.json() as { data: { asset: { id: string; status: string } } };
    expect(cleanStart.status).toBe(201);
    expect(cleanStarted.data.asset.status).toBe("quarantined");
    const cleanComplete = await fetch(
      `${baseUrl}/api/v1/admin/lessons/DRAFT-01/assets/${cleanStarted.data.asset.id}/complete`,
      { method: "POST", headers: operatorHeaders },
    );
    const clean = await cleanComplete.json() as { data: { status: string; scanProvider: string } };
    expect(cleanComplete.status).toBe(201);
    expect(clean.data).toMatchObject({ status: "ready", scanProvider: "clamav" });

    const infectedStart = await start("infected.pdf");
    const infectedStarted = await infectedStart.json() as { data: { asset: { id: string } } };
    const infectedComplete = await fetch(
      `${baseUrl}/api/v1/admin/lessons/DRAFT-01/assets/${infectedStarted.data.asset.id}/complete`,
      { method: "POST", headers: operatorHeaders },
    );
    const infected = await infectedComplete.json() as { error: { code: string } };
    expect(infectedComplete.status).toBe(422);
    expect(infected.error.code).toBe("MALWARE_DETECTED");

    const list = await fetch(`${baseUrl}/api/v1/admin/lessons/DRAFT-01/assets`, { headers: operatorHeaders });
    const listed = await list.json() as { data: { items: Array<{ status: string }> } };
    expect(listed.data.items.map((asset) => asset.status)).toEqual(["ready", "rejected"]);
  });

  it("normalizes HWP MIME aliases and rejects an extension/MIME mismatch", async () => {
    const hwp = await fetch(`${baseUrl}/api/v1/admin/lessons/DRAFT-01/assets/uploads`, {
      method: "POST",
      headers: operatorHeaders,
      body: JSON.stringify({
        kind: "material",
        fileName: "activity.hwp",
        contentType: "application/octet-stream",
        size: 1024,
      }),
    });
    expect(hwp.status).toBe(201);

    const list = await fetch(`${baseUrl}/api/v1/admin/lessons/DRAFT-01/assets`, { headers: operatorHeaders });
    const listed = await list.json() as { data: { items: Array<{ originalName: string; contentType: string }> } };
    expect(listed.data.items).toContainEqual(expect.objectContaining({
      originalName: "activity.hwp",
      contentType: "application/x-hwp",
    }));

    const mismatch = await fetch(`${baseUrl}/api/v1/admin/lessons/DRAFT-01/assets/uploads`, {
      method: "POST",
      headers: operatorHeaders,
      body: JSON.stringify({
        kind: "material",
        fileName: "renamed.docx",
        contentType: "application/pdf",
        size: 1024,
      }),
    });
    expect(mismatch.status).toBe(400);
  });
});
