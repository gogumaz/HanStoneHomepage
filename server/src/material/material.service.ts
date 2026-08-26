import { HttpStatus, Injectable } from "@nestjs/common";
import type { CurrentUser } from "../auth/auth.types.js";
import { ApiError } from "../common/api-error.js";
import { readInputObject, requiredString } from "../common/input-validation.js";
import { PrismaService } from "../database/prisma.service.js";
import {
  SubscriptionPaymentStatus,
  TeachingMaterialAccess,
  TeachingMaterialAssetStatus,
  TeachingMaterialStatus,
} from "../generated/prisma/enums.js";
import { ObjectStorageService } from "../storage/object-storage.service.js";

const ACCESS_INPUT = new Map<string, TeachingMaterialAccess>([
  ["public", TeachingMaterialAccess.PUBLIC], ["전체 공개", TeachingMaterialAccess.PUBLIC],
  ["subscriber", TeachingMaterialAccess.SUBSCRIBER], ["개인 유료", TeachingMaterialAccess.SUBSCRIBER],
  ["instructor", TeachingMaterialAccess.INSTRUCTOR], ["지도자", TeachingMaterialAccess.INSTRUCTOR],
  ["organization", TeachingMaterialAccess.ORGANIZATION], ["기관 회원", TeachingMaterialAccess.ORGANIZATION],
]);
const ACCESS_LABEL: Record<TeachingMaterialAccess, string> = {
  PUBLIC: "전체 공개",
  SUBSCRIBER: "개인 유료",
  INSTRUCTOR: "지도자",
  ORGANIZATION: "기관 회원",
};

@Injectable()
export class MaterialService {
  constructor(private readonly prisma: PrismaService, private readonly storage: ObjectStorageService) {}

  async listPublic(query: Record<string, unknown>, user?: CurrentUser) {
    return this.list(query, user, false);
  }

  async listAdmin(query: Record<string, unknown>, user: CurrentUser) {
    return this.list(query, user, true);
  }

  async create(user: CurrentUser, body: unknown, requestId?: string) {
    const input = createInput(body);
    const lesson = await this.prisma.lesson.findUnique({ where: { id: input.lessonId }, select: { id: true } });
    if (!lesson) throw new ApiError("LESSON_NOT_FOUND", "연결할 강의를 찾을 수 없습니다.", HttpStatus.BAD_REQUEST);
    const published = input.isPublished;
    const item = await this.prisma.$transaction(async (transaction) => {
      const asset = await transaction.teachingMaterialAsset.findFirst({
        where: { id: input.assetId, ownerUserId: user.id, materialId: null, status: TeachingMaterialAssetStatus.READY },
      });
      if (!asset) throw new ApiError("TEACHING_MATERIAL_ASSET_NOT_READY", "검사를 통과한 본인 파일을 선택해 주세요.", HttpStatus.CONFLICT);
      const created = await transaction.teachingMaterial.create({
        data: {
          category: input.category,
          title: input.title,
          content: input.content,
          lessonId: input.lessonId,
          version: input.version,
          accessLevel: input.accessLevel,
          status: published ? TeachingMaterialStatus.PUBLISHED : TeachingMaterialStatus.DRAFT,
          publishedAt: published ? new Date() : null,
          createdById: user.id,
          updatedById: user.id,
        },
      });
      const linked = await transaction.teachingMaterialAsset.updateMany({
        where: { id: asset.id, materialId: null, status: TeachingMaterialAssetStatus.READY },
        data: { materialId: created.id },
      });
      if (linked.count !== 1) throw new ApiError("TEACHING_MATERIAL_ASSET_ALREADY_USED", "이미 사용된 교재자료 파일입니다.", HttpStatus.CONFLICT);
      await transaction.auditLog.create({
        data: {
          actorId: user.id,
          action: "teaching_material.created",
          resourceType: "TeachingMaterial",
          resourceId: created.id,
          requestId: requestId ?? null,
          metadata: { status: created.status.toLowerCase(), accessLevel: created.accessLevel.toLowerCase(), assetId: asset.id },
        },
      });
      return { ...created, asset };
    });
    return { item: view(item, true, true) };
  }

  async update(user: CurrentUser, materialId: string, body: unknown, requestId?: string) {
    const input = updateInput(body);
    const existing = await this.requireMaterial(materialId);
    if (input.lessonId) {
      const lesson = await this.prisma.lesson.findUnique({ where: { id: input.lessonId }, select: { id: true } });
      if (!lesson) throw new ApiError("LESSON_NOT_FOUND", "연결할 강의를 찾을 수 없습니다.", HttpStatus.BAD_REQUEST);
    }
    const replacementAssetId = input.assetId && input.assetId !== existing.asset?.id ? input.assetId : null;
    const replacingAsset = replacementAssetId !== null;
    const changedFields = Object.keys(input);
    const item = await this.prisma.$transaction(async (transaction) => {
      if (replacingAsset) {
        const asset = await transaction.teachingMaterialAsset.findFirst({ where: {
          id: replacementAssetId,
          ownerUserId: user.id,
          materialId: null,
          status: TeachingMaterialAssetStatus.READY,
        } });
        if (!asset) throw new ApiError("TEACHING_MATERIAL_ASSET_NOT_READY", "검사를 통과한 본인 파일을 선택해 주세요.", HttpStatus.CONFLICT);
      }
      const updated = await transaction.teachingMaterial.updateMany({
        where: { id: existing.id, revision: existing.revision },
        data: {
          ...(input.category !== undefined ? { category: input.category } : {}),
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.content !== undefined ? { content: input.content } : {}),
          ...(input.lessonId !== undefined ? { lessonId: input.lessonId } : {}),
          ...(input.version !== undefined ? { version: input.version } : {}),
          ...(input.accessLevel !== undefined ? { accessLevel: input.accessLevel } : {}),
          revision: { increment: 1 },
          updatedById: user.id,
        },
      });
      if (updated.count !== 1) throw new ApiError("TEACHING_MATERIAL_EDIT_CONFLICT", "다른 사용자가 먼저 수정했습니다. 새로고침 후 다시 시도해 주세요.", HttpStatus.CONFLICT);
      await transaction.teachingMaterialRevision.create({ data: {
        materialId: existing.id,
        revision: existing.revision,
        snapshot: materialSnapshot(existing),
        changedById: user.id,
      } });
      if (replacingAsset) {
        const detachedAt = new Date();
        if (existing.asset) {
          await transaction.teachingMaterialAsset.update({ where: { id: existing.asset.id }, data: { materialId: null, detachedAt } });
        }
        const linked = await transaction.teachingMaterialAsset.updateMany({
          where: { id: replacementAssetId, ownerUserId: user.id, materialId: null, status: TeachingMaterialAssetStatus.READY },
          data: { materialId: existing.id, detachedAt: null },
        });
        if (linked.count !== 1) throw new ApiError("TEACHING_MATERIAL_ASSET_ALREADY_USED", "이미 사용된 교재자료 파일입니다.", HttpStatus.CONFLICT);
      }
      await transaction.auditLog.create({ data: {
        actorId: user.id,
        action: "teaching_material.updated",
        resourceType: "TeachingMaterial",
        resourceId: existing.id,
        requestId: requestId ?? null,
        metadata: { previousRevision: existing.revision, revision: existing.revision + 1, changedFields, assetReplaced: replacingAsset },
      } });
      return transaction.teachingMaterial.findUniqueOrThrow({ where: { id: existing.id }, include: { asset: true } });
    });
    return { item: view(item, true, true) };
  }

  async listRevisions(materialId: string) {
    const current = await this.requireMaterial(materialId);
    const revisions = await this.prisma.teachingMaterialRevision.findMany({
      where: { materialId },
      orderBy: { revision: "desc" },
      take: 100,
      select: { id: true, revision: true, snapshot: true, createdAt: true, changedBy: { select: { displayName: true } } },
    });
    const snapshots = new Map(revisions.map((revision) => [revision.revision, revision.snapshot]));
    snapshots.set(current.revision, materialSnapshot(current));
    return { items: revisions.map((revision) => {
      const next = snapshots.get(revision.revision + 1);
      return {
        id: revision.id,
        revision: revision.revision,
        snapshot: publicSnapshot(revision.snapshot),
        changedByLabel: revision.changedBy?.displayName ?? "탈퇴한 운영자",
        createdAt: revision.createdAt,
        changesToNext: next ? materialChanges(revision.snapshot, next) : { changedFields: [], assetChange: null },
      };
    }) };
  }

  async restoreRevision(user: CurrentUser, materialId: string, revisionValue: string, requestId?: string) {
    const revision = parseRevision(revisionValue);
    const [existing, target] = await Promise.all([
      this.requireMaterial(materialId),
      this.prisma.teachingMaterialRevision.findUnique({ where: { materialId_revision: { materialId, revision } } }),
    ]);
    if (!target) throw new ApiError("TEACHING_MATERIAL_REVISION_NOT_FOUND", "복원할 교재자료 버전을 찾을 수 없습니다.", HttpStatus.NOT_FOUND);
    const input = restoreInput(target.snapshot);
    const lesson = await this.prisma.lesson.findUnique({ where: { id: input.lessonId }, select: { id: true } });
    if (!lesson) throw new ApiError("LESSON_NOT_FOUND", "이전 버전에 연결된 강의를 찾을 수 없습니다.", HttpStatus.CONFLICT);
    const replacingAsset = input.assetId !== existing.asset?.id;
    const item = await this.prisma.$transaction(async (transaction) => {
      if (replacingAsset) {
        const asset = await transaction.teachingMaterialAsset.findFirst({ where: {
          id: input.assetId,
          materialId: null,
          status: TeachingMaterialAssetStatus.READY,
        } });
        if (!asset) throw new ApiError("TEACHING_MATERIAL_REVISION_ASSET_EXPIRED", "이전 버전 파일의 보존기간이 지났거나 이미 사용 중이어서 복원할 수 없습니다.", HttpStatus.CONFLICT);
      }
      const updated = await transaction.teachingMaterial.updateMany({
        where: { id: existing.id, revision: existing.revision },
        data: {
          category: input.category,
          title: input.title,
          content: input.content,
          lessonId: input.lessonId,
          version: input.version,
          accessLevel: input.accessLevel,
          revision: { increment: 1 },
          updatedById: user.id,
        },
      });
      if (updated.count !== 1) throw new ApiError("TEACHING_MATERIAL_EDIT_CONFLICT", "다른 사용자가 먼저 수정했습니다. 새로고침 후 다시 시도해 주세요.", HttpStatus.CONFLICT);
      await transaction.teachingMaterialRevision.create({ data: {
        materialId: existing.id,
        revision: existing.revision,
        snapshot: materialSnapshot(existing),
        changedById: user.id,
      } });
      if (replacingAsset) {
        const detachedAt = new Date();
        if (existing.asset) await transaction.teachingMaterialAsset.update({ where: { id: existing.asset.id }, data: { materialId: null, detachedAt } });
        const linked = await transaction.teachingMaterialAsset.updateMany({
          where: { id: input.assetId, materialId: null, status: TeachingMaterialAssetStatus.READY },
          data: { materialId: existing.id, detachedAt: null },
        });
        if (linked.count !== 1) throw new ApiError("TEACHING_MATERIAL_REVISION_ASSET_EXPIRED", "이전 버전 파일을 복원할 수 없습니다.", HttpStatus.CONFLICT);
      }
      await transaction.auditLog.create({ data: {
        actorId: user.id,
        action: "teaching_material.revision_restored",
        resourceType: "TeachingMaterial",
        resourceId: existing.id,
        requestId: requestId ?? null,
        metadata: { targetRevision: revision, previousRevision: existing.revision, revision: existing.revision + 1, assetRestored: replacingAsset },
      } });
      return transaction.teachingMaterial.findUniqueOrThrow({ where: { id: existing.id }, include: { asset: true } });
    });
    return { item: view(item, true, true) };
  }

  async publish(user: CurrentUser, materialId: string, requestId?: string) {
    const existing = await this.requireMaterial(materialId);
    if (!existing.asset || existing.asset.status !== TeachingMaterialAssetStatus.READY) {
      throw new ApiError("TEACHING_MATERIAL_ASSET_NOT_READY", "검사를 통과한 파일이 있어야 공개할 수 있습니다.", HttpStatus.CONFLICT);
    }
    if (existing.status === TeachingMaterialStatus.PUBLISHED) return { item: view(existing, true, true) };
    const updated = await this.changeStatus(user, existing, TeachingMaterialStatus.PUBLISHED, requestId);
    return { item: view(updated, true, true) };
  }

  async archive(user: CurrentUser, materialId: string, requestId?: string) {
    const existing = await this.requireMaterial(materialId);
    if (existing.status === TeachingMaterialStatus.ARCHIVED) return { item: view(existing, true, true) };
    const updated = await this.changeStatus(user, existing, TeachingMaterialStatus.ARCHIVED, requestId);
    return { item: view(updated, true, true) };
  }

  async download(materialId: string, user?: CurrentUser) {
    const item = await this.prisma.teachingMaterial.findFirst({
      where: { id: materialId, status: TeachingMaterialStatus.PUBLISHED, publishedAt: { lte: new Date() } },
      include: { asset: true },
    });
    if (!item?.asset || item.asset.status !== TeachingMaterialAssetStatus.READY) notFound();
    const entitled = await this.canDownload(item.accessLevel, user);
    if (!entitled) {
      if (!user) throw new ApiError("AUTH_REQUIRED", "로그인 후 다운로드할 수 있습니다.", HttpStatus.UNAUTHORIZED);
      throw new ApiError("MATERIAL_ACCESS_REQUIRED", "이 교재자료를 다운로드할 권한이 없습니다.", HttpStatus.FORBIDDEN);
    }
    return this.storage.signAssetUrl(item.asset.objectKey, {
      contentType: item.asset.contentType,
      fileName: item.asset.originalName,
      inline: false,
    });
  }

  private async list(query: Record<string, unknown>, user: CurrentUser | undefined, admin: boolean) {
    const category = queryString(query.category, 30);
    const lessonId = queryString(query.lessonId, 40);
    const search = queryString(query.q, 100);
    const now = new Date();
    const where = {
      ...(!admin ? { status: TeachingMaterialStatus.PUBLISHED, publishedAt: { lte: now } } : {}),
      ...(category ? { category } : {}),
      ...(lessonId ? { lessonId } : {}),
      ...(search ? { OR: [
        { title: { contains: search, mode: "insensitive" as const } },
        { content: { contains: search, mode: "insensitive" as const } },
      ] } : {}),
    };
    const items = await this.prisma.teachingMaterial.findMany({
      where,
      include: { asset: true },
      orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
      take: 100,
    });
    const entitlements = await this.entitlements(user);
    return { items: items.map((item) => {
      const allowed = admin || allowedBy(item.accessLevel, entitlements);
      return view(item, allowed, admin);
    }) };
  }

  private async canDownload(access: TeachingMaterialAccess, user?: CurrentUser) {
    return allowedBy(access, await this.entitlements(user));
  }

  private async entitlements(user?: CurrentUser): Promise<Entitlements> {
    if (!user) return { operator: false, subscriber: false, instructor: false, organization: false };
    const operator = user.roles.some((role) => role === "operator" || role === "admin");
    const subscriber = operator || Boolean(await this.prisma.accountSubscription.findFirst({
      where: {
        userId: user.id,
        paymentStatus: SubscriptionPaymentStatus.PAID,
        startsAt: { lte: new Date() },
        endsAt: { gt: new Date() },
      },
      select: { id: true },
    }));
    return {
      operator,
      subscriber,
      instructor: operator || user.roles.includes("instructor"),
      organization: operator || user.roles.includes("organization_admin"),
    };
  }

  private async requireMaterial(materialId: string) {
    const item = await this.prisma.teachingMaterial.findUnique({ where: { id: materialId }, include: { asset: true } });
    if (!item) notFound();
    return item;
  }

  private async changeStatus(user: CurrentUser, existing: MaterialWithAsset, status: TeachingMaterialStatus, requestId?: string) {
    return this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.teachingMaterial.update({
        where: { id: existing.id },
        data: { status, updatedById: user.id, ...(status === TeachingMaterialStatus.PUBLISHED ? { publishedAt: new Date() } : {}) },
        include: { asset: true },
      });
      await transaction.auditLog.create({
        data: {
          actorId: user.id,
          action: `teaching_material.${status.toLowerCase()}`,
          resourceType: "TeachingMaterial",
          resourceId: existing.id,
          requestId: requestId ?? null,
          metadata: { previousStatus: existing.status.toLowerCase(), status: status.toLowerCase() },
        },
      });
      return updated;
    });
  }
}

type Entitlements = { operator: boolean; subscriber: boolean; instructor: boolean; organization: boolean };
type MaterialWithAsset = Awaited<ReturnType<MaterialService["requireMaterial"]>>;

function allowedBy(access: TeachingMaterialAccess, rights: Entitlements) {
  if (rights.operator || access === TeachingMaterialAccess.PUBLIC) return true;
  if (access === TeachingMaterialAccess.SUBSCRIBER) return rights.subscriber;
  if (access === TeachingMaterialAccess.INSTRUCTOR) return rights.instructor;
  return rights.organization;
}

function view(item: MaterialWithAsset, canDownload: boolean, admin: boolean) {
  const ready = item.asset?.status === TeachingMaterialAssetStatus.READY;
  return {
    id: item.id,
    category: item.category,
    title: item.title,
    content: item.content,
    lessonId: item.lessonId,
    version: item.version,
    accessLevel: ACCESS_LABEL[item.accessLevel],
    authorLabel: "운영팀",
    publishedAt: item.publishedAt,
    status: item.status.toLowerCase(),
    revision: item.revision,
    attachment: item.asset ? {
      kind: "material",
      originalName: item.asset.originalName,
      contentType: item.asset.contentType,
      size: item.asset.size,
      status: item.asset.status.toLowerCase(),
      canDownload: ready && canDownload,
      downloadUrl: ready && canDownload ? `/api/v1/materials/${item.id}/download` : null,
    } : null,
    ...(admin ? { createdAt: item.createdAt, updatedAt: item.updatedAt } : {}),
  };
}

function createInput(body: unknown) {
  const input = readInputObject(body, ["category", "title", "content", "lessonId", "version", "accessLevel", "assetId", "isPublished"], "TEACHING_MATERIAL_INVALID", "교재자료 입력값을 확인해 주세요.");
  const category = requiredString(input, "category", { maxLength: 30 }, "TEACHING_MATERIAL_INVALID", "교재자료 입력값을 확인해 주세요.");
  const title = requiredString(input, "title", { maxLength: 160 }, "TEACHING_MATERIAL_INVALID", "교재자료 입력값을 확인해 주세요.");
  const content = requiredString(input, "content", { maxLength: 20_000 }, "TEACHING_MATERIAL_INVALID", "교재자료 입력값을 확인해 주세요.");
  const lessonId = requiredString(input, "lessonId", { maxLength: 40, pattern: /^[A-Za-z0-9_-]+$/u }, "TEACHING_MATERIAL_INVALID", "교재자료 입력값을 확인해 주세요.");
  const version = requiredString(input, "version", { maxLength: 30 }, "TEACHING_MATERIAL_INVALID", "교재자료 입력값을 확인해 주세요.");
  const assetId = requiredString(input, "assetId", { maxLength: 36, pattern: /^[0-9a-f-]{36}$/iu }, "TEACHING_MATERIAL_INVALID", "교재자료 입력값을 확인해 주세요.");
  const accessValue = requiredString(input, "accessLevel", { maxLength: 30 }, "TEACHING_MATERIAL_INVALID", "교재자료 입력값을 확인해 주세요.").toLowerCase();
  const accessLevel = ACCESS_INPUT.get(accessValue);
  if (!accessLevel || (input.isPublished !== undefined && typeof input.isPublished !== "boolean")) {
    throw new ApiError("TEACHING_MATERIAL_INVALID", "교재자료 입력값을 확인해 주세요.", HttpStatus.BAD_REQUEST);
  }
  return { category, title, content, lessonId, version, assetId, accessLevel, isPublished: input.isPublished !== false };
}

type UpdateMaterialInput = {
  category?: string;
  title?: string;
  content?: string;
  lessonId?: string;
  version?: string;
  accessLevel?: TeachingMaterialAccess;
  assetId?: string;
};

function updateInput(body: unknown): UpdateMaterialInput {
  const keys = ["category", "title", "content", "lessonId", "version", "accessLevel", "assetId"] as const;
  const input = readInputObject(body, keys, "TEACHING_MATERIAL_INVALID", "교재자료 입력값을 확인해 주세요.");
  if (Object.keys(input).length === 0) throw new ApiError("TEACHING_MATERIAL_INVALID", "수정할 항목을 입력해 주세요.", HttpStatus.BAD_REQUEST);
  const result: UpdateMaterialInput = {};
  const text = (key: keyof UpdateMaterialInput, maxLength: number, pattern?: RegExp) => {
    if (input[key] !== undefined) result[key] = requiredString(input, key, { maxLength, ...(pattern ? { pattern } : {}) }, "TEACHING_MATERIAL_INVALID", "교재자료 입력값을 확인해 주세요.") as never;
  };
  text("category", 30);
  text("title", 160);
  text("content", 20_000);
  text("lessonId", 40, /^[A-Za-z0-9_-]+$/u);
  text("version", 30);
  text("assetId", 36, /^[0-9a-f-]{36}$/iu);
  if (input.accessLevel !== undefined) {
    const value = requiredString(input, "accessLevel", { maxLength: 30 }, "TEACHING_MATERIAL_INVALID", "교재자료 입력값을 확인해 주세요.").toLowerCase();
    const accessLevel = ACCESS_INPUT.get(value);
    if (!accessLevel) throw new ApiError("TEACHING_MATERIAL_INVALID", "교재자료 입력값을 확인해 주세요.", HttpStatus.BAD_REQUEST);
    result.accessLevel = accessLevel;
  }
  return result;
}

function materialSnapshot(item: MaterialWithAsset) {
  return {
    category: item.category,
    title: item.title,
    content: item.content,
    lessonId: item.lessonId,
    version: item.version,
    accessLevel: item.accessLevel,
    status: item.status,
    publishedAt: item.publishedAt?.toISOString() ?? null,
    asset: item.asset ? {
      id: item.asset.id,
      objectKey: item.asset.objectKey,
      originalName: item.asset.originalName,
      contentType: item.asset.contentType,
      size: item.asset.size,
      status: item.asset.status,
    } : null,
  };
}

function publicSnapshot(snapshot: unknown) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return snapshot;
  const copy = { ...(snapshot as Record<string, unknown>) };
  if (copy.asset && typeof copy.asset === "object" && !Array.isArray(copy.asset)) {
    const { objectKey: _objectKey, ...asset } = copy.asset as Record<string, unknown>;
    copy.asset = asset;
  }
  return copy;
}

function materialChanges(beforeValue: unknown, afterValue: unknown) {
  const before = objectValue(beforeValue);
  const after = objectValue(afterValue);
  const fields = ["category", "title", "content", "lessonId", "version", "accessLevel"] as const;
  const changedFields = fields.filter((field) => !sameValue(before[field], after[field]));
  const beforeAsset = objectValue(before.asset);
  const afterAsset = objectValue(after.asset);
  const assetChange = sameValue(beforeAsset.id, afterAsset.id) ? null : {
    beforeName: stringValue(beforeAsset.originalName),
    afterName: stringValue(afterAsset.originalName),
  };
  return { changedFields, assetChange };
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : null;
}

function sameValue(left: unknown, right: unknown) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function restoreInput(snapshot: unknown) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) invalidRevision();
  const value = snapshot as Record<string, unknown>;
  const asset = value.asset;
  if (!asset || typeof asset !== "object" || Array.isArray(asset)) invalidRevision();
  try {
    return createInput({
      category: value.category,
      title: value.title,
      content: value.content,
      lessonId: value.lessonId,
      version: value.version,
      accessLevel: typeof value.accessLevel === "string" ? value.accessLevel.toLowerCase() : value.accessLevel,
      assetId: (asset as Record<string, unknown>).id,
      isPublished: false,
    });
  } catch {
    invalidRevision();
  }
}

function parseRevision(value: string) {
  if (!/^[1-9]\d{0,8}$/u.test(value)) throw new ApiError("TEACHING_MATERIAL_REVISION_INVALID", "교재자료 버전 번호를 확인해 주세요.", HttpStatus.BAD_REQUEST);
  return Number(value);
}

function invalidRevision(): never {
  throw new ApiError("TEACHING_MATERIAL_REVISION_INVALID", "저장된 교재자료 버전을 복원할 수 없습니다.", HttpStatus.CONFLICT);
}

function queryString(value: unknown, maxLength: number) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string" || value.trim().length > maxLength) throw new ApiError("MATERIAL_FILTER_INVALID", "교재자료 조회 조건을 확인해 주세요.", HttpStatus.BAD_REQUEST);
  return value.trim();
}

function notFound(): never {
  throw new ApiError("TEACHING_MATERIAL_NOT_FOUND", "교재자료를 찾을 수 없습니다.", HttpStatus.NOT_FOUND);
}
