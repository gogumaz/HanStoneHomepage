import { describe, expect, it, vi } from "vitest";
import type { CurrentUser } from "../auth/auth.types.js";
import { ApiError } from "../common/api-error.js";
import {
  TeachingMaterialAccess,
  TeachingMaterialAssetStatus,
  TeachingMaterialStatus,
} from "../generated/prisma/enums.js";
import { MaterialService } from "./material.service.js";

const now = new Date("2026-08-24T00:00:00.000Z");

function material(accessLevel: TeachingMaterialAccess, id = accessLevel.toLowerCase()) {
  return {
    id,
    category: "활동지",
    title: `${id} 자료`,
    content: "수업에서 사용하는 교재자료입니다.",
    lessonId: "PRE-01",
    version: "1.0",
    accessLevel,
    status: TeachingMaterialStatus.PUBLISHED,
    publishedAt: now,
    createdById: null,
    updatedById: null,
    revision: 1,
    createdAt: now,
    updatedAt: now,
    asset: {
      id: `asset-${id}`,
      ownerUserId: operator.id,
      materialId: id,
      objectKey: `teaching-material-assets/${id}/source.pdf`,
      originalName: `${id}.pdf`,
      contentType: "application/pdf",
      size: 100,
      status: TeachingMaterialAssetStatus.READY,
      scanProvider: "clamav",
      scanResult: "OK",
      scannedAt: now,
      detachedAt: null,
      createdAt: now,
      updatedAt: now,
    },
  };
}

const operator = user("00000000-0000-0000-0000-000000000801", ["operator"]);
const student = user("00000000-0000-0000-0000-000000000802", ["student"]);
const instructor = user("00000000-0000-0000-0000-000000000803", ["instructor"]);
const organizationAdmin = user("00000000-0000-0000-0000-000000000804", ["organization_admin"]);

function user(id: string, roles: CurrentUser["roles"]): CurrentUser {
  return { id, email: `${id.slice(-3)}@example.test`, emailVerified: true, displayName: "테스트 사용자", roles };
}

function setup(activeSubscriber = false) {
  const items = [
    material(TeachingMaterialAccess.PUBLIC),
    material(TeachingMaterialAccess.SUBSCRIBER),
    material(TeachingMaterialAccess.INSTRUCTOR),
    material(TeachingMaterialAccess.ORGANIZATION),
  ];
  const prisma = {
    teachingMaterial: {
      findMany: vi.fn(async () => items),
      findFirst: vi.fn(async ({ where }: { where: { id: string } }) => items.find((item) => item.id === where.id) ?? null),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => items.find((item) => item.id === where.id) ?? null),
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => ({ ...items.find((item) => item.id === where.id)!, revision: 2 })),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    lesson: { findUnique: vi.fn(async () => ({ id: "PRE-01" })) },
    teachingMaterialAsset: {
      findFirst: vi.fn(async ({ where }: { where: { id: string } }): Promise<any> => ({ ...items[0]!.asset, id: where.id, materialId: null })),
      update: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    teachingMaterialRevision: {
      create: vi.fn(async () => ({})),
      findUnique: vi.fn(async (): Promise<any> => null),
      findMany: vi.fn(async () => [{
        id: "revision-1", revision: 1, changedById: operator.id, createdAt: now,
        changedBy: { displayName: "교재 운영자" },
        snapshot: { title: "이전 제목", asset: { id: "old", objectKey: "private/old.pdf", originalName: "old.pdf" } },
      }]),
    },
    auditLog: { create: vi.fn(async () => ({})) },
    accountSubscription: { findFirst: vi.fn(async () => activeSubscriber ? { id: "subscription" } : null) },
  };
  (prisma as Record<string, any>).$transaction = vi.fn(async (callback: (transaction: typeof prisma) => unknown) => callback(prisma));
  const storage = { signAssetUrl: vi.fn(async () => ({ url: "https://assets.example.test/signed", expiresAt: now })) };
  return { service: new MaterialService(prisma as never, storage as never), prisma, storage };
}

describe("MaterialService", () => {
  it("lists every published material but exposes a download URL only when the guest is entitled", async () => {
    const { service } = setup();
    const result = await service.listPublic({}, undefined);
    expect(result.items).toHaveLength(4);
    expect(result.items.map((item) => item.attachment?.canDownload)).toEqual([true, false, false, false]);
    expect(result.items[0]?.attachment?.downloadUrl).toBe("/api/v1/materials/public/download");
    expect(result.items[1]?.attachment?.downloadUrl).toBeNull();
    expect(JSON.stringify(result)).not.toContain("objectKey");
  });

  it("uses a paid active subscription for subscriber-only downloads", async () => {
    const { service, prisma } = setup(true);
    const result = await service.listPublic({}, student);
    expect(result.items.map((item) => item.attachment?.canDownload)).toEqual([true, true, false, false]);
    expect(prisma.accountSubscription.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ userId: student.id }),
    }));
  });

  it("keeps instructor and organization entitlements separate", async () => {
    const instructorResult = await setup().service.listPublic({}, instructor);
    const organizationResult = await setup().service.listPublic({}, organizationAdmin);
    expect(instructorResult.items.map((item) => item.attachment?.canDownload)).toEqual([true, false, true, false]);
    expect(organizationResult.items.map((item) => item.attachment?.canDownload)).toEqual([true, false, false, true]);
  });

  it("rejects a restricted guest download and redirects an entitled role through a short signed URL", async () => {
    const { service, storage } = setup();
    await expect(service.download("instructor", undefined)).rejects.toMatchObject({ code: "AUTH_REQUIRED" } satisfies Partial<ApiError>);
    await expect(service.download("instructor", instructor)).resolves.toEqual({
      url: "https://assets.example.test/signed",
      expiresAt: now,
    });
    expect(storage.signAssetUrl).toHaveBeenCalledWith(
      "teaching-material-assets/instructor/source.pdf",
      expect.objectContaining({ fileName: "instructor.pdf", inline: false }),
    );
  });

  it("grants operators every download entitlement", async () => {
    const result = await setup().service.listPublic({}, operator);
    expect(result.items.every((item) => item.attachment?.canDownload)).toBe(true);
  });

  it("stores the previous revision and safely replaces an attached file", async () => {
    const test = setup();
    const replacementId = "00000000-0000-4000-8000-000000000899";
    const result = await test.service.update(operator, "public", { title: "수정된 자료", assetId: replacementId }, "request-update");
    expect(result.item.revision).toBe(2);
    expect(test.prisma.teachingMaterialRevision.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      materialId: "public", revision: 1, changedById: operator.id,
    }) });
    expect(test.prisma.teachingMaterialAsset.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ materialId: null, detachedAt: expect.any(Date) }),
    }));
    expect(test.prisma.teachingMaterialAsset.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: replacementId, materialId: null }),
      data: { materialId: "public", detachedAt: null },
    }));
  });

  it("never exposes object storage keys in revision history", async () => {
    const test = setup();
    test.prisma.teachingMaterial.findUnique.mockResolvedValueOnce({ ...material(TeachingMaterialAccess.PUBLIC), revision: 2 });
    const result = await test.service.listRevisions("public");
    expect(result.items[0]?.snapshot).toMatchObject({ asset: { originalName: "old.pdf" } });
    expect(result.items[0]).toMatchObject({
      changedByLabel: "교재 운영자",
      changesToNext: { changedFields: expect.arrayContaining(["title"]), assetChange: { beforeName: "old.pdf", afterName: "public.pdf" } },
    });
    expect(JSON.stringify(result)).not.toContain("objectKey");
    expect(JSON.stringify(result)).not.toContain("private/old.pdf");
  });

  it("restores metadata and a retained previous file as a new revision", async () => {
    const test = setup();
    const oldAssetId = "00000000-0000-4000-8000-000000000898";
    test.prisma.teachingMaterialRevision.findUnique.mockResolvedValueOnce({
      revision: 1,
      snapshot: {
        category: "정답·해설", title: "이전 자료", content: "이전 설명", lessonId: "PRE-01",
        version: "0.9", accessLevel: "PUBLIC", asset: { id: oldAssetId },
      },
    });
    const result = await test.service.restoreRevision(operator, "public", "1", "request-restore");
    expect(result.item.revision).toBe(2);
    expect(test.prisma.teachingMaterial.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      title: "이전 자료", version: "0.9", revision: { increment: 1 },
    }) }));
    expect(test.prisma.teachingMaterialAsset.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: oldAssetId, materialId: null }),
    }));
    expect(test.prisma.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      action: "teaching_material.revision_restored", metadata: expect.objectContaining({ targetRevision: 1 }),
    }) });
  });

  it("rejects restoration when the retained file is no longer available", async () => {
    const test = setup();
    test.prisma.teachingMaterialRevision.findUnique.mockResolvedValueOnce({
      revision: 1,
      snapshot: {
        category: "활동지", title: "이전 자료", content: "이전 설명", lessonId: "PRE-01",
        version: "0.9", accessLevel: "PUBLIC", asset: { id: "00000000-0000-4000-8000-000000000897" },
      },
    });
    test.prisma.teachingMaterialAsset.findFirst.mockResolvedValueOnce(null);
    await expect(test.service.restoreRevision(operator, "public", "1")).rejects.toMatchObject({ code: "TEACHING_MATERIAL_REVISION_ASSET_EXPIRED" });
    expect(test.prisma.teachingMaterial.updateMany).not.toHaveBeenCalled();
  });
});
