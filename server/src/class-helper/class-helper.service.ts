import { HttpStatus, Injectable } from "@nestjs/common";
import type { CurrentUser } from "../auth/auth.types.js";
import { ApiError } from "../common/api-error.js";
import { readInputObject, requiredString } from "../common/input-validation.js";
import { PrismaService } from "../database/prisma.service.js";
import {
  BadukMissionStatus,
  ClassHelperAssetKind,
  ClassHelperAssetStatus,
  ClassHelperStatus,
  LessonStatus,
} from "../generated/prisma/enums.js";
import { ObjectStorageService } from "../storage/object-storage.service.js";
import { ASSET_FIELDS, kindField } from "./class-helper-asset.service.js";

const CATEGORIES = ["선사시대", "고조선", "삼국시대", "고려", "조선", "근현대"] as const;
const GRADES = ["초등 1~2학년", "초등 3~4학년", "초등 5~6학년", "전 학년"] as const;
const REQUIRED_KINDS = Object.values(ASSET_FIELDS);

@Injectable()
export class ClassHelperService {
  constructor(private readonly prisma: PrismaService, private readonly storage: ObjectStorageService) {}

  async listPublic(query: Record<string, unknown>) {
    return this.list(query, false);
  }

  async listAdmin(query: Record<string, unknown>) {
    return this.list(query, true);
  }

  async create(user: CurrentUser, body: unknown, requestId?: string) {
    const input = createInput(body);
    const now = new Date();
    const [lesson, mission] = await Promise.all([
      this.prisma.lesson.findFirst({
        where: { id: input.lessonId, status: LessonStatus.PUBLISHED },
        select: { id: true, videoAssetKey: true },
      }),
      this.prisma.badukMission.findFirst({
        where: {
          id: input.badukMissionId,
          lessonId: input.lessonId,
          OR: [
            { status: BadukMissionStatus.PUBLISHED },
            { status: BadukMissionStatus.SCHEDULED, scheduledAt: { lte: now } },
          ],
        },
        select: { id: true },
      }),
    ]);
    if (!lesson) throw new ApiError("CLASS_HELPER_LESSON_INVALID", "공개된 연결 강의를 찾을 수 없습니다.", HttpStatus.BAD_REQUEST);
    if (!lesson.videoAssetKey) throw new ApiError("CLASS_HELPER_VIDEO_REQUIRED", "연결 강의의 영상이 준비되어야 합니다.", HttpStatus.CONFLICT);
    if (!mission) throw new ApiError("CLASS_HELPER_MISSION_INVALID", "같은 강의에 연결된 공개 바둑미션을 찾을 수 없습니다.", HttpStatus.BAD_REQUEST);

    const assetIds = Object.values(input.assetIds);
    const item = await this.prisma.$transaction(async (transaction) => {
      const assets = await transaction.classHelperAsset.findMany({ where: {
        id: { in: assetIds },
        ownerUserId: user.id,
        classHelperId: null,
        status: ClassHelperAssetStatus.READY,
      } });
      if (assets.length !== REQUIRED_KINDS.length || new Set(assets.map((asset) => asset.kind)).size !== REQUIRED_KINDS.length) {
        throw new ApiError("CLASS_HELPER_ASSETS_NOT_READY", "6종 수업자료가 모두 안전 검사를 통과해야 합니다.", HttpStatus.CONFLICT);
      }
      for (const [field, kind] of Object.entries(ASSET_FIELDS)) {
        if (!assets.some((asset) => asset.id === input.assetIds[field as keyof typeof ASSET_FIELDS] && asset.kind === kind)) {
          throw new ApiError("CLASS_HELPER_ASSET_KIND_MISMATCH", "수업자료 종류와 파일이 일치하지 않습니다.", HttpStatus.CONFLICT);
        }
      }
      const published = input.isPublished;
      const created = await transaction.classHelper.create({ data: {
        category: input.category,
        title: input.title,
        lessonId: input.lessonId,
        badukMissionId: input.badukMissionId,
        targetGrade: input.targetGrade,
        lessonDuration: input.lessonDuration,
        content: input.content,
        introductionContent: input.introductionContent,
        conceptContent: input.conceptContent,
        problemContent: input.problemContent,
        quizContent: input.quizContent,
        wrapUpContent: input.wrapUpContent,
        status: published ? ClassHelperStatus.PUBLISHED : ClassHelperStatus.DRAFT,
        publishedAt: published ? now : null,
        createdById: user.id,
        updatedById: user.id,
      } });
      const linked = await transaction.classHelperAsset.updateMany({
        where: { id: { in: assetIds }, ownerUserId: user.id, classHelperId: null, status: ClassHelperAssetStatus.READY },
        data: { classHelperId: created.id },
      });
      if (linked.count !== REQUIRED_KINDS.length) throw new ApiError("CLASS_HELPER_ASSET_ALREADY_USED", "이미 사용된 수업자료 파일이 있습니다.", HttpStatus.CONFLICT);
      await transaction.auditLog.create({ data: {
        actorId: user.id,
        action: "class_helper.created",
        resourceType: "ClassHelper",
        resourceId: created.id,
        requestId: requestId ?? null,
        metadata: { lessonId: created.lessonId, badukMissionId: created.badukMissionId, status: created.status.toLowerCase(), assetCount: assets.length },
      } });
      return { ...created, assets, lesson };
    });
    return { item: view(item) };
  }

  async update(user: CurrentUser, helperId: string, body: unknown, requestId?: string) {
    const input = updateInput(body);
    const existing = await this.requireHelper(helperId);
    const nextLessonId = input.lessonId ?? existing.lessonId;
    const nextMissionId = input.badukMissionId ?? existing.badukMissionId;
    const now = new Date();
    const [lesson, mission] = await Promise.all([
      this.prisma.lesson.findFirst({
        where: { id: nextLessonId, status: LessonStatus.PUBLISHED },
        select: { id: true, videoAssetKey: true },
      }),
      this.prisma.badukMission.findFirst({
        where: {
          id: nextMissionId,
          lessonId: nextLessonId,
          OR: [
            { status: BadukMissionStatus.PUBLISHED },
            { status: BadukMissionStatus.SCHEDULED, scheduledAt: { lte: now } },
          ],
        },
        select: { id: true },
      }),
    ]);
    if (!lesson) throw new ApiError("CLASS_HELPER_LESSON_INVALID", "공개된 연결 강의를 찾을 수 없습니다.", HttpStatus.BAD_REQUEST);
    if (!lesson.videoAssetKey) throw new ApiError("CLASS_HELPER_VIDEO_REQUIRED", "연결 강의의 영상이 준비되어야 합니다.", HttpStatus.CONFLICT);
    if (!mission) throw new ApiError("CLASS_HELPER_MISSION_INVALID", "같은 강의에 연결된 공개 바둑미션을 찾을 수 없습니다.", HttpStatus.BAD_REQUEST);

    const replacements = input.assetIds ?? {};
    const replacementEntries = Object.entries(replacements) as Array<[keyof typeof ASSET_FIELDS, string]>;
    const changedFields = Object.keys(input).filter((key) => key !== "assetIds");
    changedFields.push(...replacementEntries.map(([field]) => `assetIds.${field}`));
    const item = await this.prisma.$transaction(async (transaction) => {
      if (replacementEntries.length > 0) {
        const replacementIds = replacementEntries.map(([, id]) => id);
        const assets = await transaction.classHelperAsset.findMany({ where: {
          id: { in: replacementIds }, ownerUserId: user.id, classHelperId: null, status: ClassHelperAssetStatus.READY,
        } });
        if (assets.length !== replacementEntries.length) {
          throw new ApiError("CLASS_HELPER_ASSETS_NOT_READY", "교체할 수업자료가 안전 검사를 통과하지 않았습니다.", HttpStatus.CONFLICT);
        }
        for (const [field, id] of replacementEntries) {
          if (!assets.some((asset) => asset.id === id && asset.kind === ASSET_FIELDS[field])) {
            throw new ApiError("CLASS_HELPER_ASSET_KIND_MISMATCH", "수업자료 종류와 파일이 일치하지 않습니다.", HttpStatus.CONFLICT);
          }
        }
      }
      const updated = await transaction.classHelper.updateMany({
        where: { id: existing.id, revision: existing.revision },
        data: {
          ...(input.category !== undefined ? { category: input.category } : {}),
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.lessonId !== undefined ? { lessonId: input.lessonId } : {}),
          ...(input.badukMissionId !== undefined ? { badukMissionId: input.badukMissionId } : {}),
          ...(input.targetGrade !== undefined ? { targetGrade: input.targetGrade } : {}),
          ...(input.lessonDuration !== undefined ? { lessonDuration: input.lessonDuration } : {}),
          ...(input.content !== undefined ? { content: input.content } : {}),
          ...(input.introductionContent !== undefined ? { introductionContent: input.introductionContent } : {}),
          ...(input.conceptContent !== undefined ? { conceptContent: input.conceptContent } : {}),
          ...(input.problemContent !== undefined ? { problemContent: input.problemContent } : {}),
          ...(input.quizContent !== undefined ? { quizContent: input.quizContent } : {}),
          ...(input.wrapUpContent !== undefined ? { wrapUpContent: input.wrapUpContent } : {}),
          revision: { increment: 1 },
          updatedById: user.id,
        },
      });
      if (updated.count !== 1) throw new ApiError("CLASS_HELPER_EDIT_CONFLICT", "다른 사용자가 먼저 수정했습니다. 새로고침 후 다시 시도해 주세요.", HttpStatus.CONFLICT);
      await transaction.classHelperRevision.create({ data: {
        classHelperId: existing.id,
        revision: existing.revision,
        snapshot: helperSnapshot(existing),
        changedById: user.id,
      } });
      for (const [field, assetId] of replacementEntries) {
        const current = existing.assets.find((asset) => asset.kind === ASSET_FIELDS[field]);
        if (current) await transaction.classHelperAsset.update({ where: { id: current.id }, data: { classHelperId: null, detachedAt: now } });
        const linked = await transaction.classHelperAsset.updateMany({
          where: { id: assetId, ownerUserId: user.id, classHelperId: null, status: ClassHelperAssetStatus.READY },
          data: { classHelperId: existing.id, detachedAt: null },
        });
        if (linked.count !== 1) throw new ApiError("CLASS_HELPER_ASSET_ALREADY_USED", "이미 사용된 수업자료 파일입니다.", HttpStatus.CONFLICT);
      }
      await transaction.auditLog.create({ data: {
        actorId: user.id,
        action: "class_helper.updated",
        resourceType: "ClassHelper",
        resourceId: existing.id,
        requestId: requestId ?? null,
        metadata: { previousRevision: existing.revision, revision: existing.revision + 1, changedFields, replacedAssetCount: replacementEntries.length },
      } });
      return transaction.classHelper.findUniqueOrThrow({
        where: { id: existing.id },
        include: { assets: true, lesson: { select: { id: true, videoAssetKey: true } } },
      });
    });
    return { item: view(item) };
  }

  async listRevisions(helperId: string) {
    const current = await this.requireHelper(helperId);
    const revisions = await this.prisma.classHelperRevision.findMany({
      where: { classHelperId: helperId },
      orderBy: { revision: "desc" },
      take: 100,
      select: { id: true, revision: true, snapshot: true, createdAt: true, changedBy: { select: { displayName: true } } },
    });
    const snapshots = new Map(revisions.map((revision) => [revision.revision, revision.snapshot]));
    snapshots.set(current.revision, helperSnapshot(current));
    return { items: revisions.map((revision) => {
      const next = snapshots.get(revision.revision + 1);
      return {
        id: revision.id,
        revision: revision.revision,
        snapshot: publicHelperSnapshot(revision.snapshot),
        changedByLabel: revision.changedBy?.displayName ?? "탈퇴한 운영자",
        createdAt: revision.createdAt,
        changesToNext: next ? helperChanges(revision.snapshot, next) : { changedFields: [], replacedAssets: [] },
      };
    }) };
  }

  async restoreRevision(user: CurrentUser, helperId: string, revisionValue: string, requestId?: string) {
    const revision = parseRevision(revisionValue);
    const [existing, target] = await Promise.all([
      this.requireHelper(helperId),
      this.prisma.classHelperRevision.findUnique({ where: { classHelperId_revision: { classHelperId: helperId, revision } } }),
    ]);
    if (!target) throw new ApiError("CLASS_HELPER_REVISION_NOT_FOUND", "복원할 수업 패키지 버전을 찾을 수 없습니다.", HttpStatus.NOT_FOUND);
    const input = restoreHelperInput(target.snapshot);
    const now = new Date();
    const [lesson, mission] = await Promise.all([
      this.prisma.lesson.findFirst({ where: { id: input.lessonId, status: LessonStatus.PUBLISHED }, select: { id: true, videoAssetKey: true } }),
      this.prisma.badukMission.findFirst({ where: {
        id: input.badukMissionId,
        lessonId: input.lessonId,
        OR: [{ status: BadukMissionStatus.PUBLISHED }, { status: BadukMissionStatus.SCHEDULED, scheduledAt: { lte: now } }],
      }, select: { id: true } }),
    ]);
    if (!lesson) throw new ApiError("CLASS_HELPER_LESSON_INVALID", "이전 버전에 연결된 공개 강의를 찾을 수 없습니다.", HttpStatus.CONFLICT);
    if (!lesson.videoAssetKey) throw new ApiError("CLASS_HELPER_VIDEO_REQUIRED", "이전 버전 연결 강의의 영상이 준비되어야 합니다.", HttpStatus.CONFLICT);
    if (!mission) throw new ApiError("CLASS_HELPER_MISSION_INVALID", "이전 버전에 연결된 공개 바둑미션을 찾을 수 없습니다.", HttpStatus.CONFLICT);

    const replacements = (Object.entries(input.assetIds) as Array<[keyof typeof ASSET_FIELDS, string]>).filter(([field, id]) =>
      existing.assets.find((asset) => asset.kind === ASSET_FIELDS[field])?.id !== id,
    );
    const item = await this.prisma.$transaction(async (transaction) => {
      if (replacements.length > 0) {
        const assets = await transaction.classHelperAsset.findMany({ where: {
          id: { in: replacements.map(([, id]) => id) },
          classHelperId: null,
          status: ClassHelperAssetStatus.READY,
        } });
        if (assets.length !== replacements.length || replacements.some(([field, id]) =>
          !assets.some((asset) => asset.id === id && asset.kind === ASSET_FIELDS[field]),
        )) {
          throw new ApiError("CLASS_HELPER_REVISION_ASSET_EXPIRED", "이전 버전 파일의 보존기간이 지났거나 이미 사용 중이어서 복원할 수 없습니다.", HttpStatus.CONFLICT);
        }
      }
      const updated = await transaction.classHelper.updateMany({
        where: { id: existing.id, revision: existing.revision },
        data: {
          category: input.category,
          title: input.title,
          lessonId: input.lessonId,
          badukMissionId: input.badukMissionId,
          targetGrade: input.targetGrade,
          lessonDuration: input.lessonDuration,
          content: input.content,
          introductionContent: input.introductionContent,
          conceptContent: input.conceptContent,
          problemContent: input.problemContent,
          quizContent: input.quizContent,
          wrapUpContent: input.wrapUpContent,
          revision: { increment: 1 },
          updatedById: user.id,
        },
      });
      if (updated.count !== 1) throw new ApiError("CLASS_HELPER_EDIT_CONFLICT", "다른 사용자가 먼저 수정했습니다. 새로고침 후 다시 시도해 주세요.", HttpStatus.CONFLICT);
      await transaction.classHelperRevision.create({ data: {
        classHelperId: existing.id,
        revision: existing.revision,
        snapshot: helperSnapshot(existing),
        changedById: user.id,
      } });
      for (const [field, assetId] of replacements) {
        const current = existing.assets.find((asset) => asset.kind === ASSET_FIELDS[field]);
        if (current) await transaction.classHelperAsset.update({ where: { id: current.id }, data: { classHelperId: null, detachedAt: now } });
        const linked = await transaction.classHelperAsset.updateMany({
          where: { id: assetId, classHelperId: null, status: ClassHelperAssetStatus.READY },
          data: { classHelperId: existing.id, detachedAt: null },
        });
        if (linked.count !== 1) throw new ApiError("CLASS_HELPER_REVISION_ASSET_EXPIRED", "이전 버전 파일을 복원할 수 없습니다.", HttpStatus.CONFLICT);
      }
      await transaction.auditLog.create({ data: {
        actorId: user.id,
        action: "class_helper.revision_restored",
        resourceType: "ClassHelper",
        resourceId: existing.id,
        requestId: requestId ?? null,
        metadata: { targetRevision: revision, previousRevision: existing.revision, revision: existing.revision + 1, restoredAssetCount: replacements.length },
      } });
      return transaction.classHelper.findUniqueOrThrow({
        where: { id: existing.id }, include: { assets: true, lesson: { select: { id: true, videoAssetKey: true } } },
      });
    });
    return { item: view(item) };
  }

  async publish(user: CurrentUser, helperId: string, requestId?: string) {
    const existing = await this.requireHelper(helperId);
    if (existing.assets.length !== REQUIRED_KINDS.length || !existing.lesson.videoAssetKey) {
      throw new ApiError("CLASS_HELPER_NOT_READY", "강의 영상과 6종 수업자료가 모두 준비되어야 공개할 수 있습니다.", HttpStatus.CONFLICT);
    }
    return { item: view(await this.changeStatus(user, existing, ClassHelperStatus.PUBLISHED, requestId)) };
  }

  async archive(user: CurrentUser, helperId: string, requestId?: string) {
    const existing = await this.requireHelper(helperId);
    return { item: view(await this.changeStatus(user, existing, ClassHelperStatus.ARCHIVED, requestId)) };
  }

  async download(helperId: string, field: string, user: CurrentUser) {
    const kind = ASSET_FIELDS[field as keyof typeof ASSET_FIELDS];
    if (!kind) notFound();
    const operator = user.roles.some((role) => role === "operator" || role === "admin");
    const helper = await this.prisma.classHelper.findFirst({
      where: { id: helperId, ...(!operator ? { status: ClassHelperStatus.PUBLISHED, publishedAt: { lte: new Date() } } : {}) },
      include: { assets: { where: { kind, status: ClassHelperAssetStatus.READY } } },
    });
    const asset = helper?.assets[0];
    if (!asset) notFound();
    return this.storage.signAssetUrl(asset.objectKey, { contentType: asset.contentType, fileName: asset.originalName, inline: false });
  }

  private async list(query: Record<string, unknown>, admin: boolean) {
    const category = queryString(query.category, 30);
    const lessonId = queryString(query.lessonId, 40);
    const search = queryString(query.q, 100);
    const where = {
      ...(!admin ? { status: ClassHelperStatus.PUBLISHED, publishedAt: { lte: new Date() } } : {}),
      ...(category ? { category } : {}),
      ...(lessonId ? { lessonId } : {}),
      ...(search ? { OR: [
        { title: { contains: search, mode: "insensitive" as const } },
        { content: { contains: search, mode: "insensitive" as const } },
      ] } : {}),
    };
    const items = await this.prisma.classHelper.findMany({
      where,
      include: { assets: true, lesson: { select: { id: true, videoAssetKey: true } } },
      orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
      take: 100,
    });
    return { items: items.map(view) };
  }

  private async requireHelper(helperId: string) {
    const item = await this.prisma.classHelper.findUnique({
      where: { id: helperId },
      include: { assets: true, lesson: { select: { id: true, videoAssetKey: true } } },
    });
    if (!item) notFound();
    return item;
  }

  private async changeStatus(user: CurrentUser, existing: HelperViewInput, status: ClassHelperStatus, requestId?: string) {
    if (existing.status === status) return existing;
    return this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.classHelper.update({
        where: { id: existing.id },
        data: { status, updatedById: user.id, ...(status === ClassHelperStatus.PUBLISHED ? { publishedAt: new Date() } : {}) },
        include: { assets: true, lesson: { select: { id: true, videoAssetKey: true } } },
      });
      await transaction.auditLog.create({ data: {
        actorId: user.id,
        action: `class_helper.${status.toLowerCase()}`,
        resourceType: "ClassHelper",
        resourceId: existing.id,
        requestId: requestId ?? null,
        metadata: { previousStatus: existing.status.toLowerCase(), status: status.toLowerCase() },
      } });
      return updated;
    });
  }
}

type HelperViewInput = {
  id: string; category: string; title: string; lessonId: string; badukMissionId: string; targetGrade: string;
  lessonDuration: string; content: string; introductionContent: string; conceptContent: string; problemContent: string;
  quizContent: string; wrapUpContent: string; status: ClassHelperStatus; revision: number; publishedAt: Date | null; createdAt: Date; updatedAt: Date;
  assets: Array<{ kind: ClassHelperAssetKind; originalName: string; contentType: string; size: number; status: ClassHelperAssetStatus }>;
  lesson: { id: string; videoAssetKey: string | null };
};

function view(item: HelperViewInput) {
  const response: Record<string, unknown> = {
    id: item.id,
    category: item.category,
    title: item.title,
    lessonId: item.lessonId,
    badukMissionId: item.badukMissionId,
    targetGrade: item.targetGrade,
    lessonDuration: item.lessonDuration,
    content: item.content,
    introductionContent: item.introductionContent,
    conceptContent: item.conceptContent,
    problemContent: item.problemContent,
    quizContent: item.quizContent,
    wrapUpContent: item.wrapUpContent,
    status: item.status.toLowerCase(),
    revision: item.revision,
    authorLabel: "운영팀",
    publishedAt: item.publishedAt,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    lessonVideo: { kind: "video", originalName: "연결 강의 영상", appUrl: `/lessons/${encodeURIComponent(item.lessonId)}` },
    missionUrl: `/missions?lessonId=${encodeURIComponent(item.lessonId)}&missionId=${encodeURIComponent(item.badukMissionId)}&mode=classroom`,
  };
  for (const asset of item.assets) {
    const field = kindField(asset.kind);
    response[field] = {
      kind: "material",
      originalName: asset.originalName,
      contentType: asset.contentType,
      size: asset.size,
      status: asset.status.toLowerCase(),
      downloadUrl: asset.status === ClassHelperAssetStatus.READY ? `/api/v1/class-helpers/${item.id}/assets/${field}` : null,
    };
  }
  return response;
}

function createInput(body: unknown) {
  const keys = ["category", "title", "lessonId", "badukMissionId", "targetGrade", "lessonDuration", "content", "introductionContent", "conceptContent", "problemContent", "quizContent", "wrapUpContent", "assetIds", "isPublished"] as const;
  const input = readInputObject(body, keys, "CLASS_HELPER_INVALID", "수업 패키지 입력값을 확인해 주세요.");
  const text = (key: typeof keys[number], maxLength: number) => requiredString(input, key, { maxLength }, "CLASS_HELPER_INVALID", "수업 패키지 입력값을 확인해 주세요.");
  const category = text("category", 30);
  const targetGrade = text("targetGrade", 30);
  const lessonId = requiredString(input, "lessonId", { maxLength: 40, pattern: /^[A-Za-z0-9_-]+$/u }, "CLASS_HELPER_INVALID", "수업 패키지 입력값을 확인해 주세요.");
  const badukMissionId = requiredString(input, "badukMissionId", { maxLength: 60, pattern: /^[A-Za-z0-9_-]+$/u }, "CLASS_HELPER_INVALID", "수업 패키지 입력값을 확인해 주세요.");
  if (!CATEGORIES.includes(category as typeof CATEGORIES[number]) || !GRADES.includes(targetGrade as typeof GRADES[number])) invalid();
  if (!input.assetIds || typeof input.assetIds !== "object" || Array.isArray(input.assetIds)) invalid();
  const assetInput = readInputObject(input.assetIds, Object.keys(ASSET_FIELDS), "CLASS_HELPER_INVALID", "6종 수업자료를 모두 선택해 주세요.");
  const assetIds = Object.fromEntries(Object.keys(ASSET_FIELDS).map((field) => [
    field,
    requiredString(assetInput, field, { maxLength: 36, pattern: /^[0-9a-f-]{36}$/iu }, "CLASS_HELPER_INVALID", "6종 수업자료를 모두 선택해 주세요."),
  ])) as Record<keyof typeof ASSET_FIELDS, string>;
  if (new Set(Object.values(assetIds)).size !== REQUIRED_KINDS.length || (input.isPublished !== undefined && typeof input.isPublished !== "boolean")) invalid();
  return {
    category,
    title: text("title", 160),
    lessonId,
    badukMissionId,
    targetGrade,
    lessonDuration: text("lessonDuration", 30),
    content: text("content", 20_000),
    introductionContent: text("introductionContent", 10_000),
    conceptContent: text("conceptContent", 10_000),
    problemContent: text("problemContent", 10_000),
    quizContent: text("quizContent", 10_000),
    wrapUpContent: text("wrapUpContent", 10_000),
    assetIds,
    isPublished: input.isPublished !== false,
  };
}

type UpdateClassHelperInput = {
  category?: string;
  title?: string;
  lessonId?: string;
  badukMissionId?: string;
  targetGrade?: string;
  lessonDuration?: string;
  content?: string;
  introductionContent?: string;
  conceptContent?: string;
  problemContent?: string;
  quizContent?: string;
  wrapUpContent?: string;
  assetIds?: Partial<Record<keyof typeof ASSET_FIELDS, string>>;
};

function updateInput(body: unknown): UpdateClassHelperInput {
  const keys = ["category", "title", "lessonId", "badukMissionId", "targetGrade", "lessonDuration", "content", "introductionContent", "conceptContent", "problemContent", "quizContent", "wrapUpContent", "assetIds"] as const;
  const input = readInputObject(body, keys, "CLASS_HELPER_INVALID", "수업 패키지 입력값을 확인해 주세요.");
  if (Object.keys(input).length === 0) invalid();
  const result: UpdateClassHelperInput = {};
  const text = (key: Exclude<keyof UpdateClassHelperInput, "assetIds">, maxLength: number, pattern?: RegExp) => {
    if (input[key] !== undefined) result[key] = requiredString(input, key, { maxLength, ...(pattern ? { pattern } : {}) }, "CLASS_HELPER_INVALID", "수업 패키지 입력값을 확인해 주세요.") as never;
  };
  text("category", 30);
  text("title", 160);
  text("lessonId", 40, /^[A-Za-z0-9_-]+$/u);
  text("badukMissionId", 60, /^[A-Za-z0-9_-]+$/u);
  text("targetGrade", 30);
  text("lessonDuration", 30);
  text("content", 20_000);
  text("introductionContent", 10_000);
  text("conceptContent", 10_000);
  text("problemContent", 10_000);
  text("quizContent", 10_000);
  text("wrapUpContent", 10_000);
  if (result.category && !CATEGORIES.includes(result.category as typeof CATEGORIES[number])) invalid();
  if (result.targetGrade && !GRADES.includes(result.targetGrade as typeof GRADES[number])) invalid();
  if (input.assetIds !== undefined) {
    if (!input.assetIds || typeof input.assetIds !== "object" || Array.isArray(input.assetIds)) invalid();
    const assets = readInputObject(input.assetIds, Object.keys(ASSET_FIELDS), "CLASS_HELPER_INVALID", "교체할 수업자료를 확인해 주세요.");
    if (Object.keys(assets).length === 0) invalid();
    result.assetIds = Object.fromEntries(Object.keys(assets).map((field) => [
      field,
      requiredString(assets, field, { maxLength: 36, pattern: /^[0-9a-f-]{36}$/iu }, "CLASS_HELPER_INVALID", "교체할 수업자료를 확인해 주세요."),
    ]));
    if (new Set(Object.values(result.assetIds)).size !== Object.keys(result.assetIds).length) invalid();
  }
  return result;
}

type HelperWithAssets = Awaited<ReturnType<ClassHelperService["requireHelper"]>>;

function helperSnapshot(item: HelperWithAssets) {
  return {
    category: item.category,
    title: item.title,
    lessonId: item.lessonId,
    badukMissionId: item.badukMissionId,
    targetGrade: item.targetGrade,
    lessonDuration: item.lessonDuration,
    content: item.content,
    introductionContent: item.introductionContent,
    conceptContent: item.conceptContent,
    problemContent: item.problemContent,
    quizContent: item.quizContent,
    wrapUpContent: item.wrapUpContent,
    status: item.status,
    publishedAt: item.publishedAt?.toISOString() ?? null,
    assets: item.assets.map((asset) => ({
      id: asset.id,
      kind: asset.kind,
      objectKey: asset.objectKey,
      originalName: asset.originalName,
      contentType: asset.contentType,
      size: asset.size,
      status: asset.status,
    })),
  };
}

function publicHelperSnapshot(snapshot: unknown) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return snapshot;
  const copy = { ...(snapshot as Record<string, unknown>) };
  if (Array.isArray(copy.assets)) {
    copy.assets = copy.assets.map((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return value;
      const { objectKey: _objectKey, ...asset } = value as Record<string, unknown>;
      return asset;
    });
  }
  return copy;
}

function helperChanges(beforeValue: unknown, afterValue: unknown) {
  const before = helperObject(beforeValue);
  const after = helperObject(afterValue);
  const fields = [
    "category", "title", "lessonId", "badukMissionId", "targetGrade", "lessonDuration", "content",
    "introductionContent", "conceptContent", "problemContent", "quizContent", "wrapUpContent",
  ] as const;
  const changedFields = fields.filter((field) => !helperSameValue(before[field], after[field]));
  const beforeAssets = helperAssetsByKind(before.assets);
  const afterAssets = helperAssetsByKind(after.assets);
  const replacedAssets = Object.entries(ASSET_FIELDS).flatMap(([field, kind]) => {
    const previous = beforeAssets.get(kind);
    const next = afterAssets.get(kind);
    return helperSameValue(previous?.id, next?.id) ? [] : [{
      field,
      beforeName: typeof previous?.originalName === "string" ? previous.originalName : null,
      afterName: typeof next?.originalName === "string" ? next.originalName : null,
    }];
  });
  return { changedFields, replacedAssets };
}

function helperAssetsByKind(value: unknown) {
  const result = new Map<string, Record<string, unknown>>();
  if (!Array.isArray(value)) return result;
  for (const item of value) {
    const asset = helperObject(item);
    if (typeof asset.kind === "string") result.set(asset.kind, asset);
  }
  return result;
}

function helperObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function helperSameValue(left: unknown, right: unknown) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function restoreHelperInput(snapshot: unknown) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) invalidRevision();
  const value = snapshot as Record<string, unknown>;
  if (!Array.isArray(value.assets)) invalidRevision();
  const assetIds: Record<string, unknown> = {};
  for (const rawAsset of value.assets) {
    if (!rawAsset || typeof rawAsset !== "object" || Array.isArray(rawAsset)) invalidRevision();
    const asset = rawAsset as Record<string, unknown>;
    if (typeof asset.kind !== "string" || !Object.values(ClassHelperAssetKind).includes(asset.kind as ClassHelperAssetKind)) invalidRevision();
    const field = kindField(asset.kind as ClassHelperAssetKind);
    if (!field || assetIds[field]) invalidRevision();
    assetIds[field] = asset.id;
  }
  try {
    return createInput({
      category: value.category,
      title: value.title,
      lessonId: value.lessonId,
      badukMissionId: value.badukMissionId,
      targetGrade: value.targetGrade,
      lessonDuration: value.lessonDuration,
      content: value.content,
      introductionContent: value.introductionContent,
      conceptContent: value.conceptContent,
      problemContent: value.problemContent,
      quizContent: value.quizContent,
      wrapUpContent: value.wrapUpContent,
      assetIds,
      isPublished: false,
    });
  } catch {
    invalidRevision();
  }
}

function parseRevision(value: string) {
  if (!/^[1-9]\d{0,8}$/u.test(value)) throw new ApiError("CLASS_HELPER_REVISION_INVALID", "수업 패키지 버전 번호를 확인해 주세요.", HttpStatus.BAD_REQUEST);
  return Number(value);
}

function invalidRevision(): never {
  throw new ApiError("CLASS_HELPER_REVISION_INVALID", "저장된 수업 패키지 버전을 복원할 수 없습니다.", HttpStatus.CONFLICT);
}

function queryString(value: unknown, maxLength: number) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string" || value.trim().length > maxLength) throw new ApiError("CLASS_HELPER_FILTER_INVALID", "수업 패키지 조회 조건을 확인해 주세요.", HttpStatus.BAD_REQUEST);
  return value.trim();
}

function invalid(): never {
  throw new ApiError("CLASS_HELPER_INVALID", "수업 패키지 입력값을 확인해 주세요.", HttpStatus.BAD_REQUEST);
}

function notFound(): never {
  throw new ApiError("CLASS_HELPER_NOT_FOUND", "수업 패키지를 찾을 수 없습니다.", HttpStatus.NOT_FOUND);
}
