import { randomUUID } from "node:crypto";
import { HttpStatus, Injectable } from "@nestjs/common";
import type { CurrentUser } from "../auth/auth.types.js";
import { ApiError } from "../common/api-error.js";
import { readInputObject, requiredString } from "../common/input-validation.js";
import { isValidLessonAssetSignature } from "../content/lesson-asset-signature.js";
import { PrismaService } from "../database/prisma.service.js";
import { TeachingMaterialAssetStatus } from "../generated/prisma/enums.js";
import { MalwareScannerService } from "../storage/malware-scanner.service.js";
import { ObjectStorageService } from "../storage/object-storage.service.js";

const RULES = [
  { extension: "pdf", contentType: "application/pdf" },
  { extension: "pptx", contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation" },
  { extension: "docx", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  { extension: "hwpx", contentType: "application/hwp+zip" },
] as const;

@Injectable()
export class MaterialAssetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorageService,
    private readonly scanner: MalwareScannerService,
  ) {}

  async startUpload(user: CurrentUser, body: unknown, requestId?: string) {
    const input = uploadInput(body, this.storage.getCommunityAttachmentMaxBytes());
    const assetId = randomUUID();
    const objectKey = `teaching-material-assets/${assetId}/source.${input.extension}`;
    await this.prisma.$transaction(async (transaction) => {
      await transaction.teachingMaterialAsset.create({
        data: {
          id: assetId,
          ownerUserId: user.id,
          objectKey,
          originalName: input.fileName,
          contentType: input.contentType,
          size: input.size,
        },
      });
      await transaction.auditLog.create({
        data: {
          actorId: user.id,
          action: "teaching_material.asset.upload_requested",
          resourceType: "TeachingMaterialAsset",
          resourceId: assetId,
          requestId: requestId ?? null,
          metadata: { contentType: input.contentType, size: input.size },
        },
      });
    });
    const upload = await this.storage.createTeachingMaterialUpload({
      assetId,
      ownerUserId: user.id,
      contentType: input.contentType,
      size: input.size,
      extension: input.extension,
    });
    return {
      asset: { id: assetId, status: "quarantined" as const },
      upload: { method: upload.method, url: upload.url, fields: upload.fields, expiresAt: upload.expiresAt },
    };
  }

  async completeUpload(user: CurrentUser, assetId: string, requestId?: string) {
    const asset = await this.prisma.teachingMaterialAsset.findFirst({
      where: { id: assetId, ownerUserId: user.id, materialId: null },
    });
    if (!asset) notFound();
    if (asset.status === TeachingMaterialAssetStatus.READY) return assetView(asset);
    if (asset.status === TeachingMaterialAssetStatus.REJECTED) {
      throw new ApiError("TEACHING_MATERIAL_ASSET_REJECTED", "거부된 교재자료 파일은 다시 사용할 수 없습니다.", HttpStatus.CONFLICT);
    }
    const bytes = await this.storage.inspectTeachingMaterialAsset({
      objectKey: asset.objectKey,
      assetId: asset.id,
      ownerUserId: user.id,
      contentType: asset.contentType,
      size: asset.size,
    });
    if (!isValidLessonAssetSignature(asset.contentType, bytes)) {
      await this.reject(user, asset.id, "signature", "FILE_SIGNATURE_INVALID", requestId);
      throw new ApiError("TEACHING_MATERIAL_SIGNATURE_INVALID", "파일 내용과 확장자가 일치하지 않아 격리했습니다.", HttpStatus.UNPROCESSABLE_ENTITY);
    }
    const scan = await this.scanner.scan(bytes);
    if (!scan.clean) {
      await this.reject(user, asset.id, scan.provider, scan.result, requestId);
      throw new ApiError("MALWARE_DETECTED", "악성 파일이 감지되어 교재자료를 거부했습니다.", HttpStatus.UNPROCESSABLE_ENTITY);
    }
    const ready = await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.teachingMaterialAsset.update({
        where: { id: asset.id },
        data: {
          status: TeachingMaterialAssetStatus.READY,
          scanProvider: scan.provider.slice(0, 50),
          scanResult: scan.result.slice(0, 100),
          scannedAt: new Date(),
        },
      });
      await transaction.auditLog.create({
        data: {
          actorId: user.id,
          action: "teaching_material.asset.scan_passed",
          resourceType: "TeachingMaterialAsset",
          resourceId: asset.id,
          requestId: requestId ?? null,
          metadata: { provider: scan.provider.slice(0, 50), size: asset.size },
        },
      });
      return updated;
    });
    return assetView(ready);
  }

  private async reject(user: CurrentUser, assetId: string, provider: string, result: string, requestId?: string) {
    await this.prisma.$transaction(async (transaction) => {
      await transaction.teachingMaterialAsset.update({
        where: { id: assetId },
        data: {
          status: TeachingMaterialAssetStatus.REJECTED,
          scanProvider: provider.slice(0, 50),
          scanResult: result.slice(0, 100),
          scannedAt: new Date(),
        },
      });
      await transaction.auditLog.create({
        data: {
          actorId: user.id,
          action: "teaching_material.asset.rejected",
          resourceType: "TeachingMaterialAsset",
          resourceId: assetId,
          requestId: requestId ?? null,
          metadata: { provider: provider.slice(0, 50), result: result.slice(0, 100) },
        },
      });
    });
  }
}

function uploadInput(body: unknown, maxBytes: number) {
  const input = readInputObject(body, ["fileName", "contentType", "size"], "TEACHING_MATERIAL_ASSET_INVALID", "교재자료 파일 정보를 확인해 주세요.");
  const fileName = requiredString(input, "fileName", { maxLength: 255 }, "TEACHING_MATERIAL_ASSET_INVALID", "교재자료 파일 정보를 확인해 주세요.");
  const contentType = requiredString(input, "contentType", { maxLength: 100 }, "TEACHING_MATERIAL_ASSET_INVALID", "교재자료 파일 정보를 확인해 주세요.").toLowerCase();
  const extension = fileName.includes(".") ? fileName.split(".").pop()?.toLowerCase() ?? "" : "";
  const rule = RULES.find((item) => item.extension === extension && item.contentType === contentType);
  const size = input.size;
  if (!rule || /[\u0000-\u001f\u007f/\\]/u.test(fileName) || !Number.isSafeInteger(size) || (size as number) <= 0 || (size as number) > maxBytes) {
    throw new ApiError("TEACHING_MATERIAL_ASSET_INVALID", `PDF·PPTX·DOCX·HWPX 파일을 최대 ${Math.floor(maxBytes / 1024 / 1024)}MB까지 올릴 수 있습니다.`, HttpStatus.BAD_REQUEST);
  }
  return { fileName, contentType: rule.contentType, extension: rule.extension, size: size as number };
}

function assetView(asset: { id: string; originalName: string; contentType: string; size: number; status: TeachingMaterialAssetStatus }) {
  return { id: asset.id, originalName: asset.originalName, contentType: asset.contentType, size: asset.size, status: asset.status.toLowerCase() };
}

function notFound(): never {
  throw new ApiError("TEACHING_MATERIAL_ASSET_NOT_FOUND", "교재자료 파일을 찾을 수 없습니다.", HttpStatus.NOT_FOUND);
}
