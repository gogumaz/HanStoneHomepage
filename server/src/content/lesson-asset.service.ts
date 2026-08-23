import { randomUUID } from "node:crypto";
import { HttpStatus, Injectable } from "@nestjs/common";
import type { CurrentUser } from "../auth/auth.types.js";
import { ApiError } from "../common/api-error.js";
import { PrismaService } from "../database/prisma.service.js";
import { LessonAssetKind, LessonAssetStatus, LessonStatus } from "../generated/prisma/enums.js";
import { MalwareScannerService } from "../storage/malware-scanner.service.js";
import { ObjectStorageService } from "../storage/object-storage.service.js";
import { LessonAccessService } from "./lesson-access.service.js";
import { isValidLessonAssetSignature } from "./lesson-asset-signature.js";

type AssetKindInput = "thumbnail" | "material";
type FileRule = {
  kind: AssetKindInput;
  extension: string;
  contentType: string;
  acceptedContentTypes?: string[];
};

const FILE_RULES: FileRule[] = [
  { kind: "thumbnail", extension: "jpg", contentType: "image/jpeg" },
  { kind: "thumbnail", extension: "jpeg", contentType: "image/jpeg" },
  { kind: "thumbnail", extension: "png", contentType: "image/png" },
  { kind: "thumbnail", extension: "webp", contentType: "image/webp" },
  { kind: "material", extension: "pdf", contentType: "application/pdf" },
  { kind: "material", extension: "ppt", contentType: "application/vnd.ms-powerpoint" },
  {
    kind: "material",
    extension: "pptx",
    contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  },
  { kind: "material", extension: "doc", contentType: "application/msword" },
  {
    kind: "material",
    extension: "docx",
    contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  },
  {
    kind: "material",
    extension: "hwp",
    contentType: "application/x-hwp",
    acceptedContentTypes: ["application/x-hwp", "application/vnd.hancom.hwp", "application/haansofthwp", "application/octet-stream", ""],
  },
  {
    kind: "material",
    extension: "hwpx",
    contentType: "application/hwp+zip",
    acceptedContentTypes: ["application/hwp+zip", "application/hwpx+zip", "application/octet-stream", ""],
  },
];

function readObject(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ApiError("INVALID_LESSON_ASSET", "업로드할 파일 정보를 입력해 주세요.", HttpStatus.BAD_REQUEST);
  }
  return body as Record<string, unknown>;
}

function uploadInput(body: unknown, maxBytes: number) {
  const data = readObject(body);
  const kind = typeof data.kind === "string" ? data.kind.trim().toLowerCase() as AssetKindInput : "";
  const fileName = typeof data.fileName === "string" ? data.fileName.trim() : "";
  const contentType = typeof data.contentType === "string" ? data.contentType.trim().toLowerCase() : "";
  const size = data.size;
  const extension = fileName.includes(".") ? fileName.split(".").pop()?.toLowerCase() ?? "" : "";
  const rule = FILE_RULES.find((item) => item.kind === kind
    && item.extension === extension
    && (item.acceptedContentTypes ?? [item.contentType]).includes(contentType));
  if (
    !rule
    || !fileName
    || fileName.length > 255
    || fileName.includes("/")
    || fileName.includes("\\")
    || !Number.isSafeInteger(size)
    || (size as number) <= 0
    || (size as number) > maxBytes
  ) {
    throw new ApiError(
      "INVALID_LESSON_ASSET",
      `썸네일은 JPG·PNG·WebP, 학습자료는 PDF·PPT·PPTX·DOC·DOCX·HWP·HWPX 형식으로 최대 ${Math.floor(maxBytes / 1024 / 1024)}MB까지 업로드할 수 있습니다.`,
      HttpStatus.BAD_REQUEST,
    );
  }
  return { kind, fileName, contentType: rule.contentType, size: size as number, extension: rule.extension };
}

@Injectable()
export class LessonAssetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorageService,
    private readonly scanner: MalwareScannerService,
    private readonly accessService: LessonAccessService,
  ) {}

  async getThumbnail(lessonId: string) {
    const lesson = await this.prisma.lesson.findFirst({
      where: { id: lessonId, status: LessonStatus.PUBLISHED },
      select: { id: true, thumbnailKey: true },
    });
    if (!lesson) throw new ApiError("LESSON_NOT_FOUND", "공개된 강의를 찾을 수 없습니다.", HttpStatus.NOT_FOUND);
    if (!lesson.thumbnailKey) {
      throw new ApiError("LESSON_THUMBNAIL_NOT_FOUND", "강의 썸네일이 아직 준비되지 않았습니다.", HttpStatus.NOT_FOUND);
    }
    const asset = await this.prisma.lessonAsset.findFirst({
      where: {
        lessonId,
        kind: LessonAssetKind.THUMBNAIL,
        status: LessonAssetStatus.READY,
        objectKey: lesson.thumbnailKey,
      },
      select: { objectKey: true, originalName: true, contentType: true },
    });
    if (!asset) {
      throw new ApiError("LESSON_THUMBNAIL_NOT_FOUND", "강의 썸네일이 아직 준비되지 않았습니다.", HttpStatus.NOT_FOUND);
    }
    const signed = await this.storage.signAssetUrl(asset.objectKey, {
      contentType: asset.contentType,
      fileName: asset.originalName,
      inline: true,
    });
    return { lessonId, url: signed.url, expiresAt: signed.expiresAt };
  }

  async listAvailableMaterials(lessonId: string, user?: CurrentUser) {
    const access = await this.accessService.requireLessonAccess(lessonId, user);
    const assets = await this.prisma.lessonAsset.findMany({
      where: { lessonId, kind: LessonAssetKind.MATERIAL, status: LessonAssetStatus.READY },
      orderBy: { createdAt: "desc" },
      select: { id: true, objectKey: true, originalName: true, contentType: true, size: true },
    });
    const items = await Promise.all(assets.map(async (asset) => {
      const signed = await this.storage.signAssetUrl(asset.objectKey, {
        contentType: asset.contentType,
        fileName: asset.originalName,
        inline: false,
      });
      return {
        id: asset.id,
        originalName: asset.originalName,
        contentType: asset.contentType,
        size: asset.size,
        url: signed.url,
        expiresAt: signed.expiresAt,
      };
    }));
    return { lessonId, access, items };
  }

  async list(lessonId: string) {
    const lesson = await this.prisma.lesson.findUnique({
      where: { id: lessonId },
      select: { id: true, thumbnailKey: true },
    });
    if (!lesson) throw new ApiError("LESSON_NOT_FOUND", "강의를 찾을 수 없습니다.", HttpStatus.NOT_FOUND);
    const assets = await this.prisma.lessonAsset.findMany({
      where: { lessonId },
      orderBy: { createdAt: "desc" },
    });
    return { items: assets.map((asset) => this.view(asset, lesson.thumbnailKey)) };
  }

  async startUpload(user: CurrentUser, lessonId: string, body: unknown, requestId?: string) {
    const lesson = await this.prisma.lesson.findUnique({ where: { id: lessonId }, select: { id: true } });
    if (!lesson) throw new ApiError("LESSON_NOT_FOUND", "강의를 찾을 수 없습니다.", HttpStatus.NOT_FOUND);
    const input = uploadInput(body, this.storage.getLessonAssetMaxBytes());
    const assetId = randomUUID();
    const objectKey = `lesson-assets/${assetId}/source.${input.extension}`;
    await this.prisma.$transaction(async (transaction) => {
      await transaction.lessonAsset.create({
        data: {
          id: assetId,
          lessonId,
          kind: input.kind === "thumbnail" ? LessonAssetKind.THUMBNAIL : LessonAssetKind.MATERIAL,
          objectKey,
          originalName: input.fileName,
          contentType: input.contentType,
          size: input.size,
          status: LessonAssetStatus.QUARANTINED,
        },
      });
      await transaction.auditLog.create({
        data: {
          actorId: user.id,
          action: "lesson.asset.upload_requested",
          resourceType: "LessonAsset",
          resourceId: assetId,
          requestId: requestId ?? null,
          metadata: { lessonId, kind: input.kind, fileName: input.fileName, size: input.size },
        },
      });
    });
    const signed = await this.storage.createLessonAssetUpload({
      assetId,
      lessonId,
      contentType: input.contentType,
      size: input.size,
      extension: input.extension,
    });
    return {
      lessonId,
      asset: { id: assetId, kind: input.kind, status: "quarantined" as const },
      upload: { method: signed.method, url: signed.url, fields: signed.fields, expiresAt: signed.expiresAt },
    };
  }

  async completeUpload(user: CurrentUser, lessonId: string, assetId: string, requestId?: string) {
    const asset = await this.prisma.lessonAsset.findFirst({ where: { id: assetId, lessonId } });
    if (!asset) throw new ApiError("LESSON_ASSET_NOT_FOUND", "학습자료를 찾을 수 없습니다.", HttpStatus.NOT_FOUND);
    if (asset.status === LessonAssetStatus.READY) return this.view(asset, null);
    if (asset.status === LessonAssetStatus.REJECTED) {
      throw new ApiError("LESSON_ASSET_REJECTED", "거부된 파일은 다시 활성화할 수 없습니다.", HttpStatus.CONFLICT);
    }
    const bytes = await this.storage.inspectLessonAsset({
      objectKey: asset.objectKey,
      assetId: asset.id,
      lessonId,
      contentType: asset.contentType,
      size: asset.size,
    });
    if (!isValidLessonAssetSignature(asset.contentType, bytes)) {
      await this.reject(user, asset.id, "signature", "FILE_SIGNATURE_INVALID", requestId);
      throw new ApiError(
        "LESSON_ASSET_SIGNATURE_INVALID",
        "파일 내용이 선언된 형식과 일치하지 않아 격리했습니다.",
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const scan = await this.scanner.scan(bytes);
    if (!scan.clean) {
      await this.reject(user, asset.id, scan.provider, scan.result, requestId);
      throw new ApiError(
        "MALWARE_DETECTED",
        "악성 파일이 탐지되어 자료를 거부하고 격리했습니다.",
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const scannedAt = new Date();
    const ready = await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.lessonAsset.update({
        where: { id: asset.id },
        data: {
          status: LessonAssetStatus.READY,
          scanProvider: scan.provider,
          scanResult: scan.result,
          scannedAt,
        },
      });
      if (asset.kind === LessonAssetKind.THUMBNAIL) {
        await transaction.lesson.update({ where: { id: lessonId }, data: { thumbnailKey: asset.objectKey } });
      }
      await transaction.auditLog.create({
        data: {
          actorId: user.id,
          action: "lesson.asset.scan_passed",
          resourceType: "LessonAsset",
          resourceId: asset.id,
          requestId: requestId ?? null,
          metadata: { lessonId, provider: scan.provider, kind: asset.kind.toLowerCase() },
        },
      });
      return updated;
    });
    return this.view(ready, asset.kind === LessonAssetKind.THUMBNAIL ? asset.objectKey : null);
  }

  private async reject(
    user: CurrentUser,
    assetId: string,
    provider: string,
    result: string,
    requestId?: string,
  ) {
    await this.prisma.$transaction(async (transaction) => {
      await transaction.lessonAsset.update({
        where: { id: assetId },
        data: {
          status: LessonAssetStatus.REJECTED,
          scanProvider: provider,
          scanResult: result,
          scannedAt: new Date(),
        },
      });
      await transaction.auditLog.create({
        data: {
          actorId: user.id,
          action: "lesson.asset.rejected",
          resourceType: "LessonAsset",
          resourceId: assetId,
          requestId: requestId ?? null,
          metadata: { provider, result },
        },
      });
    });
  }

  private view(asset: {
    id: string;
    kind: LessonAssetKind;
    originalName: string;
    contentType: string;
    size: number;
    status: LessonAssetStatus;
    scanProvider: string | null;
    scanResult: string | null;
    scannedAt: Date | null;
    createdAt: Date;
    objectKey: string;
  }, thumbnailKey: string | null) {
    return {
      id: asset.id,
      kind: asset.kind.toLowerCase(),
      originalName: asset.originalName,
      contentType: asset.contentType,
      size: asset.size,
      status: asset.status.toLowerCase(),
      scanProvider: asset.scanProvider,
      scanResult: asset.scanResult,
      scannedAt: asset.scannedAt,
      createdAt: asset.createdAt,
      isCurrentThumbnail: asset.kind === LessonAssetKind.THUMBNAIL && asset.objectKey === thumbnailKey,
    };
  }
}
