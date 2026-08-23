import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "../app.module.js";
import { hashSessionToken } from "../auth/session-cookie.js";
import { ApiExceptionFilter } from "../common/api-exception.filter.js";
import { ApiResponseInterceptor } from "../common/api-response.interceptor.js";
import { RequestIdMiddleware } from "../common/request-id.middleware.js";
import { PrismaService } from "../database/prisma.service.js";
import { ObjectStorageService } from "../storage/object-storage.service.js";
import {
  AccountStatus,
  LessonAssetKind,
  LessonAssetStatus,
  LessonProgressStatus,
  LessonStatus,
  LessonVideoAssetStatus,
  RoleType,
  SubscriptionPaymentStatus,
} from "../generated/prisma/enums.js";

type Value = Record<string, any>;

function createPrismaMock(): PrismaService {
  const users: Value[] = [
    { id: "student-free", email: "free@example.com", displayName: "무료 학생", status: AccountStatus.ACTIVE, roles: [{ role: RoleType.STUDENT }] },
    { id: "student-active", email: "active@example.com", displayName: "구독 학생", status: AccountStatus.ACTIVE, roles: [{ role: RoleType.STUDENT }] },
    { id: "student-expired", email: "expired@example.com", displayName: "만료 학생", status: AccountStatus.ACTIVE, roles: [{ role: RoleType.STUDENT }] },
    { id: "operator-1", email: "operator@example.com", displayName: "운영자", status: AccountStatus.ACTIVE, roles: [{ role: RoleType.OPERATOR }] },
  ];
  const sessions = [
    ["free-token", "student-free"],
    ["active-token", "student-active"],
    ["expired-token", "student-expired"],
    ["operator-token", "operator-1"],
  ].map(([token, userId], index) => ({
    id: `session-${index + 1}`,
    userId,
    tokenHash: hashSessionToken(token ?? ""),
    expiresAt: new Date(Date.now() + 60_000),
    revokedAt: null,
  }));
  const lessons: Value[] = [
    {
      id: "FREE-01", status: LessonStatus.PUBLISHED, isFreeSample: true, videoAssetKey: null,
      thumbnailKey: "lesson-assets/thumb-free/source.webp", eraId: "era_prehistoric", order: 1,
      course: "입문 1권", title: "무료 첫 강의", durationMinutes: 8,
    },
    {
      id: "PAID-01", status: LessonStatus.PUBLISHED, isFreeSample: false,
      videoAssetKey: "lesson-videos/paid.mp4", thumbnailKey: null,
      eraId: "era_prehistoric", order: 2, course: "입문 1권", title: "구독 강의", durationMinutes: 10,
    },
  ];
  const lessonAssets: Value[] = [
    {
      id: "thumb-free", lessonId: "FREE-01", kind: LessonAssetKind.THUMBNAIL,
      status: LessonAssetStatus.READY, objectKey: "lesson-assets/thumb-free/source.webp",
      originalName: "대표 이미지.webp", contentType: "image/webp", size: 2048, createdAt: new Date(),
    },
    {
      id: "material-free", lessonId: "FREE-01", kind: LessonAssetKind.MATERIAL,
      status: LessonAssetStatus.READY, objectKey: "lesson-assets/material-free/source.pdf",
      originalName: "무료 활동지.pdf", contentType: "application/pdf", size: 4096, createdAt: new Date(),
    },
    {
      id: "material-paid", lessonId: "PAID-01", kind: LessonAssetKind.MATERIAL,
      status: LessonAssetStatus.READY, objectKey: "lesson-assets/material-paid/source.pdf",
      originalName: "구독 활동지.pdf", contentType: "application/pdf", size: 8192, createdAt: new Date(),
    },
    {
      id: "material-quarantined", lessonId: "FREE-01", kind: LessonAssetKind.MATERIAL,
      status: LessonAssetStatus.QUARANTINED, objectKey: "lesson-assets/material-quarantined/source.pdf",
      originalName: "검사 중.pdf", contentType: "application/pdf", size: 1024, createdAt: new Date(),
    },
  ];
  const lessonVideoAssets: Value[] = [];
  const steps: Value[] = [
    { id: "FREE-01-01", lessonId: "FREE-01", order: 1, title: "첫 단계" },
    { id: "FREE-01-02", lessonId: "FREE-01", order: 2, title: "둘째 단계" },
  ];
  const progresses: Value[] = [{
    id: "progress-active-seed",
    userId: "student-active",
    lessonId: "FREE-01",
    status: LessonProgressStatus.IN_PROGRESS,
    lastPositionSeconds: 90,
    startedAt: new Date(Date.now() - 120_000),
    completedAt: null,
    updatedAt: new Date(Date.now() - 60_000),
  }];
  const completions: Value[] = [{
    id: "completion-active-seed",
    progressId: "progress-active-seed",
    stepId: "FREE-01-01",
  }];
  const plans = [
    { id: "subscription-1m", label: "1개월", months: 1, price: 10000, active: true, recommended: false },
    { id: "subscription-3m", label: "3개월", months: 3, price: 30000, active: true, recommended: false },
    { id: "subscription-6m", label: "6개월", months: 6, price: 50000, active: true, recommended: true },
    { id: "subscription-12m", label: "12개월", months: 12, price: 100000, active: true, recommended: false },
  ];
  const subscriptions = [
    {
      userId: "student-active", paymentStatus: SubscriptionPaymentStatus.PAID,
      startsAt: new Date(Date.now() - 60_000), endsAt: new Date(Date.now() + 60_000),
    },
    {
      userId: "student-expired", paymentStatus: SubscriptionPaymentStatus.PAID,
      startsAt: new Date(Date.now() - 120_000), endsAt: new Date(Date.now() - 60_000),
    },
  ];

  function progressResult(progress: Value, include: Value): Value {
    const ownCompletions = completions.filter((item) => item.progressId === progress.id);
    if (include?.stepCompletions) {
      return { ...progress, stepCompletions: ownCompletions.map(({ stepId }) => ({ stepId })) };
    }
    if (include?._count) return { ...progress, _count: { stepCompletions: ownCompletions.length } };
    return progress;
  }

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
      findMany: vi.fn(async () => [
        {
          id: "era_prehistoric", order: 1, name: "선사시대", theme: "주변을 살펴라", description: "첫 시대",
          lessons: lessons.map((lesson) => {
            const progress = progresses.find((item) => item.userId === "student-active" && item.lessonId === lesson.id);
            const completedSteps = progress
              ? completions.filter((item) => item.progressId === progress.id).length
              : 0;
            return {
              ...lesson,
              _count: { steps: steps.filter((step) => step.lessonId === lesson.id).length },
              progress: progress ? [{ ...progress, _count: { stepCompletions: completedSteps } }] : [],
            };
          }),
        },
        {
          id: "era_goryeo", order: 2, name: "고려", theme: "균형을 지켜라", description: "준비 중",
          lessons: [],
        },
      ]),
    },
    lesson: {
      findFirst: vi.fn(async ({ where, select }: Value) => {
        const lesson = lessons.find((item) => item.id === where.id && item.status === where.status);
        if (!lesson) return null;
        if (select?._count) {
          return { id: lesson.id, _count: { steps: steps.filter((step) => step.lessonId === lesson.id).length } };
        }
        return lesson;
      }),
      findUnique: vi.fn(async ({ where }: Value) =>
        lessons.find((item) => item.id === where.id) ?? null),
      update: vi.fn(async ({ where, data }: Value) => {
        const lesson = lessons.find((item) => item.id === where.id);
        Object.assign(lesson ?? {}, data);
        return lesson;
      }),
    },
    lessonStep: {
      findFirst: vi.fn(async ({ where }: Value) =>
        steps.find((step) => step.id === where.id && step.lessonId === where.lessonId) ?? null),
      count: vi.fn(async ({ where }: Value) => steps.filter((step) => step.lessonId === where.lessonId).length),
    },
    lessonAsset: {
      findFirst: vi.fn(async ({ where }: Value) => lessonAssets.find((asset) =>
        asset.lessonId === where.lessonId
        && (!where.id || asset.id === where.id)
        && (!where.kind || asset.kind === where.kind)
        && (!where.status || asset.status === where.status)
        && (!where.objectKey || asset.objectKey === where.objectKey)) ?? null),
      findMany: vi.fn(async ({ where }: Value) => lessonAssets.filter((asset) =>
        asset.lessonId === where.lessonId
        && (!where.kind || asset.kind === where.kind)
        && (!where.status || asset.status === where.status))),
    },
    lessonVideoAsset: {
      create: vi.fn(async ({ data }: Value) => {
        const asset = {
          id: `video-asset-${lessonVideoAssets.length + 1}`,
          actualSize: null,
          status: LessonVideoAssetStatus.UPLOADING,
          scanProvider: null,
          scanResult: null,
          scannedAt: null,
          attachedAt: null,
          attempts: 0,
          nextAttemptAt: null,
          lockedAt: null,
          lastError: null,
          previousAssetKey: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        lessonVideoAssets.push(asset);
        return asset;
      }),
      findFirst: vi.fn(async ({ where }: Value) => lessonVideoAssets.find((asset) =>
        (!where.id || asset.id === where.id)
        && (!where.lessonId || asset.lessonId === where.lessonId)
        && (!where.objectKey || asset.objectKey === where.objectKey)) ?? null),
      findMany: vi.fn(async ({ where, take }: Value) => lessonVideoAssets
        .filter((asset) => asset.lessonId === where.lessonId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, take ?? lessonVideoAssets.length)),
      update: vi.fn(async ({ where, data }: Value) => {
        const asset = lessonVideoAssets.find((item) => item.id === where.id);
        Object.assign(asset ?? {}, data, { updatedAt: new Date() });
        return asset;
      }),
    },
    objectDeletionJob: {
      upsert: vi.fn(async ({ create, update }: Value) => ({ id: "deletion-hls-replaced", ...create, ...update })),
    },
    accountSubscription: {
      findFirst: vi.fn(async ({ where }: Value) => subscriptions.find((item) =>
        item.userId === where.userId
        && item.paymentStatus === where.paymentStatus
        && item.startsAt <= where.startsAt.lte
        && item.endsAt > where.endsAt.gt) ?? null),
    },
    subscriptionPlan: {
      findMany: vi.fn(async () => plans.filter((plan) => plan.active).sort((a, b) => a.months - b.months)),
    },
    lessonProgress: {
      findUnique: vi.fn(async ({ where, include }: Value) => {
        const key = where.userId_lessonId;
        const progress = key
          ? progresses.find((item) => item.userId === key.userId && item.lessonId === key.lessonId)
          : progresses.find((item) => item.id === where.id);
        return progress ? progressResult(progress, include) : null;
      }),
      upsert: vi.fn(async ({ where, create, update }: Value) => {
        const key = where.userId_lessonId;
        const existing = progresses.find((item) => item.userId === key.userId && item.lessonId === key.lessonId);
        let progress: Value;
        if (existing) {
          Object.assign(existing, update);
          progress = existing;
        } else {
          progress = {
            id: `progress-${progresses.length + 1}`,
            status: LessonProgressStatus.IN_PROGRESS,
            lastPositionSeconds: 0,
            completedAt: null,
            updatedAt: new Date(),
            ...create,
          };
          progresses.push(progress);
        }
        return progress;
      }),
      update: vi.fn(async ({ where, data }: Value) => {
        const progress = progresses.find((item) => item.id === where.id);
        Object.assign(progress ?? {}, data);
        return progress;
      }),
    },
    lessonStepCompletion: {
      upsert: vi.fn(async ({ where, create }: Value) => {
        const key = where.progressId_stepId;
        const existing = completions.find((item) => item.progressId === key.progressId && item.stepId === key.stepId);
        if (existing) return existing;
        const completion: Value = { id: `completion-${completions.length + 1}`, ...create };
        completions.push(completion);
        return completion;
      }),
    },
    auditLog: { create: vi.fn(async () => ({ id: "audit" })) },
    isReady: vi.fn(async () => true),
    $transaction: vi.fn(async (input: unknown) => {
      if (typeof input === "function") return (input as (transaction: typeof prisma) => unknown)(prisma);
      return Promise.all(input as Promise<unknown>[]);
    }),
  };
  return prisma as unknown as PrismaService;
}

describe("lesson access and progress HTTP API", () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5432/test";
    process.env.SESSION_COOKIE_NAME = "baduk_session";
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(createPrismaMock())
      .overrideProvider(ObjectStorageService)
      .useValue({
        isConfigured: () => true,
        getPlaybackExpiresAt: () => new Date(Date.now() + 300_000),
        getVideoUploadMaxBytes: () => 10 * 1024 * 1024,
        createVideoUpload: vi.fn(async (lessonId: string, expectedSize: number) => ({
          method: "POST",
          url: "https://storage.example.test/private-media",
          fields: {
            key: "lesson-videos/uploaded.mp4",
            "Content-Type": "video/mp4",
            "x-amz-meta-lesson-id": lessonId,
            "x-amz-meta-expected-size": String(expectedSize),
          },
          assetKey: "lesson-videos/uploaded.mp4",
          expiresAt: new Date(Date.now() + 300_000),
        })),
        inspectVideoUpload: vi.fn(async (assetKey: string) => ({
          assetKey,
          contentType: "video/mp4",
          size: 1024,
        })),
        signPlaybackUrl: vi.fn(async () => ({
          url: "https://media.example.test/private/video.mp4?X-Amz-Signature=signed",
          expiresAt: new Date(Date.now() + 300_000),
        })),
        readHlsManifest: vi.fn(async (objectKey: string) => objectKey.endsWith("master.m3u8")
          ? "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\n720p/index.m3u8"
          : "#EXTM3U\n#EXTINF:6,\nsegment-001.m4s\n#EXT-X-ENDLIST"),
        signHlsAssetUrl: vi.fn(async (objectKey: string) => ({
          url: `https://media.example.test/${objectKey}?X-Amz-Signature=hls`,
          expiresAt: new Date(Date.now() + 300_000),
        })),
        signAssetUrl: vi.fn(async (_objectKey: string, options: { inline: boolean }) => ({
          url: options.inline
            ? "https://media.example.test/signed-thumbnail?X-Amz-Signature=signed"
            : "https://media.example.test/signed-material?X-Amz-Signature=signed",
          expiresAt: new Date(Date.now() + 300_000),
        })),
      })
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

  it("allows a free sample, blocks missing or expired subscriptions, and allows operator preview", async () => {
    const free = await fetch(`${baseUrl}/api/v1/lessons/FREE-01/playback`);
    const freeBody = await free.json() as { data: { access: { source: string }; playback: { status: string } } };
    expect(free.status).toBe(200);
    expect(freeBody.data.access.source).toBe("free_sample");
    expect(freeBody.data.playback.status).toBe("asset_pending");

    const guestPaid = await fetch(`${baseUrl}/api/v1/lessons/PAID-01/playback`);
    expect(guestPaid.status).toBe(401);

    const expired = await fetch(`${baseUrl}/api/v1/lessons/PAID-01/playback`, {
      headers: { cookie: "baduk_session=expired-token" },
    });
    const expiredBody = await expired.json() as { error: { code: string } };
    expect(expired.status).toBe(403);
    expect(expiredBody.error.code).toBe("SUBSCRIPTION_REQUIRED");

    const active = await fetch(`${baseUrl}/api/v1/lessons/PAID-01/playback`, {
      headers: { cookie: "baduk_session=active-token" },
    });
    const activeBody = await active.json() as {
      data: {
        access: { source: string; subscriptionEndsAt: string };
        playback: { status: string; format: string; url: string; expiresAt: string };
      };
    };
    expect(active.status).toBe(200);
    expect(active.headers.get("cache-control")).toBe("private, no-store");
    expect(active.headers.get("vary")).toContain("Cookie");
    expect(activeBody.data.access.source).toBe("subscription");
    expect(activeBody.data.access.subscriptionEndsAt).toBeTruthy();
    expect(activeBody.data.playback.status).toBe("ready");
    expect(activeBody.data.playback.format).toBe("mp4");
    expect(activeBody.data.playback.url).toContain("X-Amz-Signature=signed");
    expect(activeBody.data.playback.expiresAt).toBeTruthy();
    expect(JSON.stringify(activeBody)).not.toContain("videoAssetKey");

    const operator = await fetch(`${baseUrl}/api/v1/lessons/PAID-01/playback`, {
      headers: { cookie: "baduk_session=operator-token" },
    });
    const operatorBody = await operator.json() as { data: { access: { source: string } } };
    expect(operatorBody.data.access.source).toBe("operator_preview");
  });

  it("signs only the current ready thumbnail and permission-checked ready materials", async () => {
    const thumbnail = await fetch(`${baseUrl}/api/v1/lessons/FREE-01/thumbnail`);
    const thumbnailBody = await thumbnail.json() as { data: { url: string; expiresAt: string } };
    expect(thumbnail.status).toBe(200);
    expect(thumbnail.headers.get("cache-control")).toBe("private, no-store");
    expect(thumbnailBody.data.url).toContain("signed-thumbnail");
    expect(thumbnailBody.data.expiresAt).toBeTruthy();

    const free = await fetch(`${baseUrl}/api/v1/lessons/FREE-01/materials`);
    const freeBody = await free.json() as {
      data: { access: { source: string }; items: Array<{ id: string; url: string }> };
    };
    expect(free.status).toBe(200);
    expect(free.headers.get("cache-control")).toBe("private, no-store");
    expect(free.headers.get("vary")).toContain("Cookie");
    expect(freeBody.data.access.source).toBe("free_sample");
    expect(freeBody.data.items).toEqual([
      expect.objectContaining({ id: "material-free", url: expect.stringContaining("signed-material") }),
    ]);
    expect(JSON.stringify(freeBody)).not.toContain("objectKey");
    expect(JSON.stringify(freeBody)).not.toContain("material-quarantined");

    expect((await fetch(`${baseUrl}/api/v1/lessons/PAID-01/materials`)).status).toBe(401);
    expect((await fetch(`${baseUrl}/api/v1/lessons/PAID-01/materials`, {
      headers: { cookie: "baduk_session=expired-token" },
    })).status).toBe(403);

    const active = await fetch(`${baseUrl}/api/v1/lessons/PAID-01/materials`, {
      headers: { cookie: "baduk_session=active-token" },
    });
    const activeBody = await active.json() as { data: { access: { source: string }; items: unknown[] } };
    expect(active.status).toBe(200);
    expect(activeBody.data.access.source).toBe("subscription");
    expect(activeBody.data.items).toHaveLength(1);

    const operator = await fetch(`${baseUrl}/api/v1/lessons/PAID-01/materials`, {
      headers: { cookie: "baduk_session=operator-token" },
    });
    expect((await operator.json() as { data: { access: { source: string } } }).data.access.source)
      .toBe("operator_preview");
  });

  it("activates a prepared HLS package and protects every rewritten manifest", async () => {
    const manifestKey = "lesson-hls/PAID-01/version-1/master.m3u8";
    const activated = await fetch(`${baseUrl}/api/v1/admin/lessons/PAID-01/hls-source`, {
      method: "POST",
      headers: { cookie: "baduk_session=operator-token", "content-type": "application/json" },
      body: JSON.stringify({ manifestKey }),
    });
    expect(activated.status).toBe(201);
    expect(await activated.json()).toMatchObject({ data: { format: "hls", manifestKey } });

    const playback = await fetch(`${baseUrl}/api/v1/lessons/PAID-01/playback`, {
      headers: { cookie: "baduk_session=active-token" },
    });
    expect(await playback.json()).toMatchObject({
      data: { playback: { status: "ready", format: "hls", url: "/api/v1/lessons/PAID-01/hls-manifest" } },
    });

    expect((await fetch(`${baseUrl}/api/v1/lessons/PAID-01/hls-manifest`)).status).toBe(401);
    const master = await fetch(`${baseUrl}/api/v1/lessons/PAID-01/hls-manifest`, {
      headers: { cookie: "baduk_session=active-token" },
    });
    expect(master.status).toBe(200);
    expect(master.headers.get("content-type")).toContain("application/vnd.apple.mpegurl");
    expect(await master.text()).toContain("/api/v1/lessons/PAID-01/hls-manifest?path=720p%2Findex.m3u8");

    const media = await fetch(`${baseUrl}/api/v1/lessons/PAID-01/hls-manifest?path=720p%2Findex.m3u8`, {
      headers: { cookie: "baduk_session=active-token" },
    });
    expect(await media.text()).toContain("segment-001.m4s?X-Amz-Signature=hls");
  });

  it("builds a student-only journey dashboard and recommends an accessible next lesson", async () => {
    expect((await fetch(`${baseUrl}/api/v1/me/dashboard`)).status).toBe(401);
    expect((await fetch(`${baseUrl}/api/v1/me/dashboard`, {
      headers: { cookie: "baduk_session=operator-token" },
    })).status).toBe(403);

    const response = await fetch(`${baseUrl}/api/v1/me/dashboard`, {
      headers: { cookie: "baduk_session=active-token" },
    });
    const body = await response.json() as {
      data: {
        access: { hasActiveSubscription: boolean; subscriptionEndsAt: string };
        summary: { totalLessons: number; startedLessons: number; completedLessons: number };
        eras: Array<{ id: string; status: string; totalLessons: number }>;
        nextLesson: { lesson: { id: string; accessible: boolean }; reason: string };
      };
    };
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toContain("Cookie");
    expect(body.data.access.hasActiveSubscription).toBe(true);
    expect(body.data.access.subscriptionEndsAt).toBeTruthy();
    expect(body.data.summary).toMatchObject({ totalLessons: 2, startedLessons: 1, completedLessons: 0 });
    expect(body.data.eras).toEqual([
      expect.objectContaining({ id: "era_prehistoric", status: "in_progress", totalLessons: 2 }),
      expect.objectContaining({ id: "era_goryeo", status: "coming_soon", totalLessons: 0 }),
    ]);
    expect(body.data.nextLesson).toMatchObject({
      lesson: { id: "FREE-01", accessible: true },
      reason: "continue",
    });
  });

  it("returns the fixed subscription plans from the server", async () => {
    const response = await fetch(`${baseUrl}/api/v1/subscription-plans`);
    const body = await response.json() as { data: { items: Array<{ months: number; price: number }> } };
    expect(body.data.items.map(({ months, price }) => [months, price])).toEqual([
      [1, 10000], [3, 30000], [6, 50000], [12, 100000],
    ]);
  });

  it("allows only operators to upload an MP4 and queues it without exposing it before scanning", async () => {
    const input = JSON.stringify({ fileName: "lesson.mp4", contentType: "video/mp4", size: 1024 });
    const forbidden = await fetch(`${baseUrl}/api/v1/admin/lessons/FREE-01/video-upload`, {
      method: "POST",
      headers: { cookie: "baduk_session=free-token", "content-type": "application/json" },
      body: input,
    });
    expect(forbidden.status).toBe(403);

    const invalid = await fetch(`${baseUrl}/api/v1/admin/lessons/FREE-01/video-upload`, {
      method: "POST",
      headers: { cookie: "baduk_session=operator-token", "content-type": "application/json" },
      body: JSON.stringify({ fileName: "lesson.mov", contentType: "video/quicktime", size: 1024 }),
    });
    expect(invalid.status).toBe(400);

    const started = await fetch(`${baseUrl}/api/v1/admin/lessons/FREE-01/video-upload`, {
      method: "POST",
      headers: { cookie: "baduk_session=operator-token", "content-type": "application/json" },
      body: input,
    });
    const startedBody = await started.json() as {
      data: { upload: { method: string; url: string; assetKey: string; fields: Record<string, string> } };
    };
    expect(started.status).toBe(201);
    expect(startedBody.data.upload).toMatchObject({
      method: "POST",
      assetKey: "lesson-videos/uploaded.mp4",
    });
    expect(startedBody.data.upload.fields["x-amz-meta-lesson-id"]).toBe("FREE-01");

    const completed = await fetch(`${baseUrl}/api/v1/admin/lessons/FREE-01/video-upload/complete`, {
      method: "POST",
      headers: { cookie: "baduk_session=operator-token", "content-type": "application/json" },
      body: JSON.stringify({ assetKey: startedBody.data.upload.assetKey }),
    });
    const completedBody = await completed.json() as {
      data: { status: string; assetKey: string; size: number };
    };
    expect(completed.status).toBe(201);
    expect(completedBody.data).toMatchObject({
      status: "quarantined",
      size: 1024,
      isCurrent: false,
    });

    const uploads = await fetch(`${baseUrl}/api/v1/admin/lessons/FREE-01/video-uploads`, {
      headers: { cookie: "baduk_session=operator-token" },
    });
    const uploadsBody = await uploads.json() as { data: { items: Array<{ status: string; fileName: string }> } };
    expect(uploads.status).toBe(200);
    expect(uploadsBody.data.items[0]).toMatchObject({ status: "quarantined", fileName: "lesson.mp4" });

    const playback = await fetch(`${baseUrl}/api/v1/lessons/FREE-01/playback`);
    const playbackBody = await playback.json() as { data: { playback: { status: string } } };
    expect(playbackBody.data.playback.status).toBe("asset_pending");
  });

  it("stores step completion idempotently and completes only after every step", async () => {
    const cookie = { cookie: "baduk_session=free-token" };
    const start = await fetch(`${baseUrl}/api/v1/lessons/FREE-01/start`, {
      method: "POST", headers: cookie,
    });
    const started = await start.json() as { data: { status: string; completedSteps: number } };
    expect(start.status).toBe(201);
    expect(started.data).toMatchObject({ status: "in_progress", completedSteps: 0 });

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const step = await fetch(`${baseUrl}/api/v1/lessons/FREE-01/steps/FREE-01-01/complete`, {
        method: "POST", headers: cookie,
      });
      const stepBody = await step.json() as { data: { completedSteps: number } };
      expect(stepBody.data.completedSteps).toBe(1);
    }

    const tooEarly = await fetch(`${baseUrl}/api/v1/lessons/FREE-01/complete`, {
      method: "POST", headers: cookie,
    });
    const tooEarlyBody = await tooEarly.json() as { error: { code: string } };
    expect(tooEarly.status).toBe(409);
    expect(tooEarlyBody.error.code).toBe("LESSON_STEPS_INCOMPLETE");

    await fetch(`${baseUrl}/api/v1/lessons/FREE-01/steps/FREE-01-02/complete`, {
      method: "POST", headers: cookie,
    });
    const complete = await fetch(`${baseUrl}/api/v1/lessons/FREE-01/complete`, {
      method: "POST", headers: cookie,
    });
    const completed = await complete.json() as { data: { status: string; completedSteps: number } };
    expect(completed.data).toMatchObject({ status: "completed", completedSteps: 2 });

    const progress = await fetch(`${baseUrl}/api/v1/me/lessons/FREE-01/progress`, {
      headers: cookie,
    });
    const progressBody = await progress.json() as { data: { status: string; completedStepIds: string[] } };
    expect(progressBody.data.status).toBe("completed");
    expect(progressBody.data.completedStepIds).toEqual(["FREE-01-01", "FREE-01-02"]);
  });
});
