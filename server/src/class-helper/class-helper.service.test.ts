import { describe, expect, it, vi } from "vitest";
import type { CurrentUser } from "../auth/auth.types.js";
import {
  ClassHelperAssetKind,
  ClassHelperAssetStatus,
  ClassHelperStatus,
} from "../generated/prisma/enums.js";
import { ClassHelperAssetService } from "./class-helper-asset.service.js";
import { ClassHelperService } from "./class-helper.service.js";

const operator: CurrentUser = {
  id: "00000000-0000-4000-8000-000000000901",
  email: "operator@example.test",
  emailVerified: true,
  displayName: "수업 운영자",
  roles: ["operator"],
};
const now = new Date("2026-08-24T00:00:00.000Z");
const kinds = Object.values(ClassHelperAssetKind);
const ids = kinds.map((_, index) => `00000000-0000-4000-8000-${String(910 + index).padStart(12, "0")}`);

function assets(linked = true) {
  return kinds.map((kind, index) => ({
    id: ids[index]!,
    ownerUserId: operator.id,
    classHelperId: linked ? "00000000-0000-4000-8000-000000000920" : null,
    kind,
    objectKey: `class-helper-assets/${ids[index]}/source.pdf`,
    originalName: `${kind.toLowerCase()}.pdf`,
    contentType: "application/pdf",
    size: 100,
    status: ClassHelperAssetStatus.READY,
    scanProvider: "clamav",
    scanResult: "OK",
    scannedAt: now,
    detachedAt: null,
    createdAt: now,
    updatedAt: now,
  }));
}

function helperRecord() {
  return {
    id: "00000000-0000-4000-8000-000000000920",
    category: "선사시대",
    title: "선사시대 수업 패키지",
    lessonId: "PRE-01",
    badukMissionId: "MISSION-PRE-01-01",
    targetGrade: "초등 3~4학년",
    lessonDuration: "25~30분",
    content: "수업 목표와 활용 안내입니다.",
    introductionContent: "역사 장면을 소개합니다.",
    conceptContent: "바둑 개념을 설명합니다.",
    problemContent: "바둑미션을 풉니다.",
    quizContent: "역사 퀴즈를 풉니다.",
    wrapUpContent: "수업을 정리합니다.",
    status: ClassHelperStatus.PUBLISHED,
    publishedAt: now,
    createdById: operator.id,
    updatedById: operator.id,
    revision: 1,
    createdAt: now,
    updatedAt: now,
    assets: assets(),
    lesson: { id: "PRE-01", videoAssetKey: "lesson-videos/pre-01.mp4" },
  };
}

function setup(options: { hasVideo?: boolean; mission?: boolean } = {}) {
  const record = helperRecord();
  const prisma: Record<string, any> = {
    lesson: { findFirst: vi.fn(async () => ({ id: "PRE-01", videoAssetKey: options.hasVideo === false ? null : "lesson-videos/pre-01.mp4" })) },
    badukMission: { findFirst: vi.fn(async () => options.mission === false ? null : { id: "MISSION-PRE-01-01" }) },
    classHelper: {
      findMany: vi.fn(async () => [record]),
      findFirst: vi.fn(async () => record),
      findUnique: vi.fn(async () => record),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...record, ...data, assets: undefined, lesson: undefined })),
      update: vi.fn(async () => record),
      updateMany: vi.fn(async () => ({ count: 1 })),
      findUniqueOrThrow: vi.fn(async () => ({ ...record, revision: 2 })),
    },
    classHelperAsset: {
      findMany: vi.fn(async () => assets(false)),
      update: vi.fn(async () => ({})),
      updateMany: vi.fn(async ({ where }: { where: { id?: unknown } }) => ({ count: typeof where.id === "string" ? 1 : 6 })),
    },
    classHelperRevision: {
      create: vi.fn(async () => ({})),
      findUnique: vi.fn(async () => null),
      findMany: vi.fn(async () => [{
        id: "revision-1", revision: 1, changedById: operator.id, createdAt: now,
        changedBy: { displayName: "수업 운영자" },
        snapshot: { title: "이전 수업", assets: [{ id: "00000000-0000-4000-8000-000000000997", kind: kinds[0], objectKey: "private/old.pptx", originalName: "old.pptx" }] },
      }]),
    },
    auditLog: { create: vi.fn(async () => ({ id: "audit" })) },
  };
  prisma.$transaction = vi.fn(async (callback: (transaction: typeof prisma) => unknown) => callback(prisma));
  const storage = {
    signAssetUrl: vi.fn(async () => ({ url: "https://assets.example.test/signed", expiresAt: now })),
    getCommunityAttachmentMaxBytes: vi.fn(() => 20 * 1024 * 1024),
  };
  return { service: new ClassHelperService(prisma as never, storage as never), prisma, storage };
}

function createBody() {
  return {
    category: "선사시대",
    title: "선사시대 수업 패키지",
    lessonId: "PRE-01",
    badukMissionId: "MISSION-PRE-01-01",
    targetGrade: "초등 3~4학년",
    lessonDuration: "25~30분",
    content: "수업 목표와 활용 안내입니다.",
    introductionContent: "역사 장면을 소개합니다.",
    conceptContent: "바둑 개념을 설명합니다.",
    problemContent: "바둑미션을 풉니다.",
    quizContent: "역사 퀴즈를 풉니다.",
    wrapUpContent: "수업을 정리합니다.",
    assetIds: Object.fromEntries([
      "projectorPpt", "activityPdf", "historyQuizFile", "problemMissionFile", "answerFile", "teacherGuideFile",
    ].map((field, index) => [field, ids[index]])),
  };
}

describe("ClassHelperService", () => {
  it("returns the linked lesson video, mission route and six signed-download routes without object keys", async () => {
    const result = await setup().service.listPublic({});
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      lessonVideo: { appUrl: "/lessons/PRE-01" },
      missionUrl: "/missions?lessonId=PRE-01&missionId=MISSION-PRE-01-01",
      activityPdf: { downloadUrl: expect.stringContaining("/assets/activityPdf") },
    });
    expect(JSON.stringify(result)).not.toContain("objectKey");
  });

  it("atomically creates a package only with the exact six ready assets", async () => {
    const test = setup();
    const result = await test.service.create(operator, createBody(), "request-class-helper");
    expect(result.item).toMatchObject({ lessonId: "PRE-01", status: "published" });
    expect(test.prisma.classHelperAsset.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { classHelperId: helperRecord().id },
    }));
    expect(test.prisma.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      action: "class_helper.created", metadata: expect.objectContaining({ assetCount: 6 }),
    }) });
  });

  it("requires the linked published lesson to have a ready video", async () => {
    await expect(setup({ hasVideo: false }).service.create(operator, createBody())).rejects.toMatchObject({ code: "CLASS_HELPER_VIDEO_REQUIRED" });
  });

  it("requires a public mission linked to the same lesson", async () => {
    await expect(setup({ mission: false }).service.create(operator, createBody())).rejects.toMatchObject({ code: "CLASS_HELPER_MISSION_INVALID" });
  });

  it("signs only a known ready package asset", async () => {
    const test = setup();
    await expect(test.service.download(helperRecord().id, "activityPdf", operator)).resolves.toEqual({
      url: "https://assets.example.test/signed", expiresAt: now,
    });
    expect(test.storage.signAssetUrl).toHaveBeenCalledWith(expect.stringContaining("class-helper-assets/"), expect.objectContaining({ inline: false }));
    await expect(test.service.download(helperRecord().id, "unknown", operator)).rejects.toMatchObject({ code: "CLASS_HELPER_NOT_FOUND" });
  });

  it("rejects executable or HTML uploads before touching storage", async () => {
    const test = setup();
    const service = new ClassHelperAssetService(test.prisma as never, test.storage as never, { scan: vi.fn() } as never);
    await expect(service.startUpload(operator, {
      kind: "historyQuizFile", fileName: "quiz.html", contentType: "text/html", size: 100,
    })).rejects.toMatchObject({ code: "CLASS_HELPER_ASSET_INVALID" });
    expect(test.prisma.classHelperAsset.findMany).not.toHaveBeenCalled();
  });

  it("updates selected fields and replaces only the selected package asset", async () => {
    const test = setup();
    const replacementId = "00000000-0000-4000-8000-000000000999";
    test.prisma.classHelperAsset.findMany.mockResolvedValueOnce([{
      ...assets(false)[0], id: replacementId, kind: ClassHelperAssetKind.PROJECTOR_PPT,
    }]);
    const result = await test.service.update(operator, helperRecord().id, {
      title: "수정된 수업 패키지",
      assetIds: { projectorPpt: replacementId },
    }, "request-update");
    expect(result.item.revision).toBe(2);
    expect(test.prisma.classHelperRevision.create).toHaveBeenCalledWith({ data: expect.objectContaining({ revision: 1 }) });
    expect(test.prisma.classHelperAsset.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ classHelperId: null, detachedAt: expect.any(Date) }),
    }));
    expect(test.prisma.classHelperAsset.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: replacementId, classHelperId: null }),
      data: { classHelperId: helperRecord().id, detachedAt: null },
    }));
  });

  it("removes private object keys from package revision history", async () => {
    const test = setup();
    test.prisma.classHelper.findUnique.mockResolvedValueOnce({ ...helperRecord(), revision: 2 });
    const result = await test.service.listRevisions(helperRecord().id);
    expect(result.items[0]?.snapshot).toMatchObject({ assets: [{ originalName: "old.pptx" }] });
    expect(result.items[0]).toMatchObject({
      changedByLabel: "수업 운영자",
      changesToNext: { changedFields: expect.arrayContaining(["title"]) },
    });
    expect(result.items[0]?.changesToNext.replacedAssets).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "projectorPpt", beforeName: "old.pptx" }),
    ]));
    expect(JSON.stringify(result)).not.toContain("objectKey");
    expect(JSON.stringify(result)).not.toContain("private/old.pptx");
  });

  it("restores an earlier package and reconnects only changed retained assets", async () => {
    const test = setup();
    const previousProjectorId = "00000000-0000-4000-8000-000000000998";
    const snapshot = helperRecord();
    test.prisma.classHelperRevision.findUnique.mockResolvedValueOnce({
      revision: 1,
      snapshot: {
        ...snapshot,
        title: "이전 수업 패키지",
        assets: snapshot.assets.map((asset, index) => ({ ...asset, id: index === 0 ? previousProjectorId : asset.id })),
      },
    });
    test.prisma.classHelperAsset.findMany.mockResolvedValueOnce([{
      ...assets(false)[0], id: previousProjectorId, kind: ClassHelperAssetKind.PROJECTOR_PPT,
    }]);
    const result = await test.service.restoreRevision(operator, snapshot.id, "1", "request-restore");
    expect(result.item.revision).toBe(2);
    expect(test.prisma.classHelper.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      title: "이전 수업 패키지", revision: { increment: 1 },
    }) }));
    expect(test.prisma.classHelperAsset.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: previousProjectorId, classHelperId: null }),
    }));
    expect(test.prisma.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      action: "class_helper.revision_restored", metadata: expect.objectContaining({ targetRevision: 1, restoredAssetCount: 1 }),
    }) });
  });
});
