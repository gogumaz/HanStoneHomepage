import { randomUUID } from "node:crypto";
import { HttpStatus, Injectable } from "@nestjs/common";
import type { CurrentUser } from "../auth/auth.types.js";
import { ApiError } from "../common/api-error.js";
import { readInputObject, requiredString } from "../common/input-validation.js";
import { isValidLessonAssetSignature } from "../content/lesson-asset-signature.js";
import { PrismaService } from "../database/prisma.service.js";
import { ClassHelperAssetKind, ClassHelperAssetStatus } from "../generated/prisma/enums.js";
import { MalwareScannerService } from "../storage/malware-scanner.service.js";
import { ObjectStorageService } from "../storage/object-storage.service.js";

export const ASSET_FIELDS = {
  projectorPpt: ClassHelperAssetKind.PROJECTOR_PPT,
  activityPdf: ClassHelperAssetKind.ACTIVITY_PDF,
  historyQuizFile: ClassHelperAssetKind.HISTORY_QUIZ,
  problemMissionFile: ClassHelperAssetKind.PROBLEM_MISSION,
  answerFile: ClassHelperAssetKind.ANSWER,
  teacherGuideFile: ClassHelperAssetKind.TEACHER_GUIDE,
} as const;

const RULES = [
  { extension: "pdf", contentType: "application/pdf" },
  { extension: "ppt", contentType: "application/vnd.ms-powerpoint" },
  { extension: "pptx", contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation" },
  { extension: "doc", contentType: "application/msword" },
  { extension: "docx", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  { extension: "hwp", contentType: "application/x-hwp" },
  { extension: "hwpx", contentType: "application/hwp+zip" },
] as const;

const ALLOWED_BY_KIND: Record<ClassHelperAssetKind, readonly string[]> = {
  PROJECTOR_PPT: ["ppt", "pptx"],
  ACTIVITY_PDF: ["pdf"],
  HISTORY_QUIZ: ["ppt", "pptx", "pdf"],
  PROBLEM_MISSION: ["pdf", "ppt", "pptx", "doc", "docx", "hwp", "hwpx"],
  ANSWER: ["pdf", "doc", "docx", "hwp", "hwpx"],
  TEACHER_GUIDE: ["pdf", "ppt", "pptx", "doc", "docx", "hwp", "hwpx"],
};

@Injectable()
export class ClassHelperAssetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorageService,
    private readonly scanner: MalwareScannerService,
  ) {}

  async startUpload(user: CurrentUser, body: unknown, requestId?: string) {
    const input = uploadInput(body, this.storage.getCommunityAttachmentMaxBytes());
    const assetId = randomUUID();
    const objectKey = `class-helper-assets/${assetId}/source.${input.extension}`;
    await this.prisma.$transaction(async (transaction) => {
      await transaction.classHelperAsset.create({ data: {
        id: assetId,
        ownerUserId: user.id,
        kind: input.kind,
        objectKey,
        originalName: input.fileName,
        contentType: input.contentType,
        size: input.size,
      } });
      await transaction.auditLog.create({ data: {
        actorId: user.id,
        action: "class_helper.asset.upload_requested",
        resourceType: "ClassHelperAsset",
        resourceId: assetId,
        requestId: requestId ?? null,
        metadata: { kind: input.kind.toLowerCase(), contentType: input.contentType, size: input.size },
      } });
    });
    const upload = await this.storage.createClassHelperAssetUpload({
      assetId,
      ownerUserId: user.id,
      kind: input.kind.toLowerCase(),
      contentType: input.contentType,
      size: input.size,
      extension: input.extension,
    });
    return {
      asset: { id: assetId, kind: kindField(input.kind), status: "quarantined" as const },
      upload: { method: upload.method, url: upload.url, fields: upload.fields, expiresAt: upload.expiresAt },
    };
  }

  async completeUpload(user: CurrentUser, assetId: string, requestId?: string) {
    const asset = await this.prisma.classHelperAsset.findFirst({ where: { id: assetId, ownerUserId: user.id, classHelperId: null } });
    if (!asset) notFound();
    if (asset.status === ClassHelperAssetStatus.READY) return assetView(asset);
    if (asset.status === ClassHelperAssetStatus.REJECTED) {
      throw new ApiError("CLASS_HELPER_ASSET_REJECTED", "거부된 수업자료 파일은 다시 사용할 수 없습니다.", HttpStatus.CONFLICT);
    }
    const bytes = await this.storage.inspectClassHelperAsset({
      objectKey: asset.objectKey,
      assetId: asset.id,
      ownerUserId: user.id,
      kind: asset.kind.toLowerCase(),
      contentType: asset.contentType,
      size: asset.size,
    });
    if (!isValidLessonAssetSignature(asset.contentType, bytes)) {
      await this.reject(user, asset.id, "signature", "FILE_SIGNATURE_INVALID", requestId);
      throw new ApiError("CLASS_HELPER_ASSET_SIGNATURE_INVALID", "파일 내용과 확장자가 일치하지 않아 격리했습니다.", HttpStatus.UNPROCESSABLE_ENTITY);
    }
    const scan = await this.scanner.scan(bytes);
    if (!scan.clean) {
      await this.reject(user, asset.id, scan.provider, scan.result, requestId);
      throw new ApiError("MALWARE_DETECTED", "악성 파일이 감지되어 수업자료를 거부했습니다.", HttpStatus.UNPROCESSABLE_ENTITY);
    }
    const ready = await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.classHelperAsset.update({ where: { id: asset.id }, data: {
        status: ClassHelperAssetStatus.READY,
        scanProvider: scan.provider.slice(0, 50),
        scanResult: scan.result.slice(0, 100),
        scannedAt: new Date(),
      } });
      await transaction.auditLog.create({ data: {
        actorId: user.id,
        action: "class_helper.asset.scan_passed",
        resourceType: "ClassHelperAsset",
        resourceId: asset.id,
        requestId: requestId ?? null,
        metadata: { kind: asset.kind.toLowerCase(), provider: scan.provider.slice(0, 50), size: asset.size },
      } });
      return updated;
    });
    return assetView(ready);
  }

  private async reject(user: CurrentUser, assetId: string, provider: string, result: string, requestId?: string) {
    await this.prisma.$transaction(async (transaction) => {
      await transaction.classHelperAsset.update({ where: { id: assetId }, data: {
        status: ClassHelperAssetStatus.REJECTED,
        scanProvider: provider.slice(0, 50),
        scanResult: result.slice(0, 100),
        scannedAt: new Date(),
      } });
      await transaction.auditLog.create({ data: {
        actorId: user.id,
        action: "class_helper.asset.rejected",
        resourceType: "ClassHelperAsset",
        resourceId: assetId,
        requestId: requestId ?? null,
        metadata: { provider: provider.slice(0, 50), result: result.slice(0, 100) },
      } });
    });
  }
}

function uploadInput(body: unknown, maxBytes: number) {
  const input = readInputObject(body, ["kind", "fileName", "contentType", "size"], "CLASS_HELPER_ASSET_INVALID", "수업자료 파일 정보를 확인해 주세요.");
  const kindValue = requiredString(input, "kind", { maxLength: 40 }, "CLASS_HELPER_ASSET_INVALID", "수업자료 파일 정보를 확인해 주세요.");
  const kind = ASSET_FIELDS[kindValue as keyof typeof ASSET_FIELDS];
  const fileName = requiredString(input, "fileName", { maxLength: 255 }, "CLASS_HELPER_ASSET_INVALID", "수업자료 파일 정보를 확인해 주세요.");
  const contentType = requiredString(input, "contentType", { maxLength: 100 }, "CLASS_HELPER_ASSET_INVALID", "수업자료 파일 정보를 확인해 주세요.").toLowerCase();
  const extension = fileName.includes(".") ? fileName.split(".").pop()?.toLowerCase() ?? "" : "";
  const rule = RULES.find((item) => item.extension === extension && item.contentType === contentType);
  const size = input.size;
  if (!kind || !rule || !ALLOWED_BY_KIND[kind].includes(extension) || /[\u0000-\u001f\u007f/\\]/u.test(fileName) || !Number.isSafeInteger(size) || (size as number) <= 0 || (size as number) > maxBytes) {
    throw new ApiError("CLASS_HELPER_ASSET_INVALID", `허용된 PDF·PPT·문서 파일을 최대 ${Math.floor(maxBytes / 1024 / 1024)}MB까지 올릴 수 있습니다.`, HttpStatus.BAD_REQUEST);
  }
  return { kind, fileName, contentType: rule.contentType, extension: rule.extension, size: size as number };
}

export function kindField(kind: ClassHelperAssetKind): keyof typeof ASSET_FIELDS {
  const found = Object.entries(ASSET_FIELDS).find(([, value]) => value === kind)?.[0];
  if (!found) throw new Error("CLASS_HELPER_ASSET_KIND_INVALID");
  return found as keyof typeof ASSET_FIELDS;
}

function assetView(asset: { id: string; kind: ClassHelperAssetKind; originalName: string; contentType: string; size: number; status: ClassHelperAssetStatus }) {
  return { id: asset.id, kind: kindField(asset.kind), originalName: asset.originalName, contentType: asset.contentType, size: asset.size, status: asset.status.toLowerCase() };
}

function notFound(): never {
  throw new ApiError("CLASS_HELPER_ASSET_NOT_FOUND", "수업자료 파일을 찾을 수 없습니다.", HttpStatus.NOT_FOUND);
}
