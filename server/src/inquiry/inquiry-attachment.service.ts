import { randomUUID } from "node:crypto";
import { HttpStatus, Injectable } from "@nestjs/common";
import type { CurrentUser } from "../auth/auth.types.js";
import { ApiError } from "../common/api-error.js";
import { readInputObject, requiredString } from "../common/input-validation.js";
import { PrismaService } from "../database/prisma.service.js";
import { InquiryAttachmentStatus } from "../generated/prisma/enums.js";
import { MalwareScannerService } from "../storage/malware-scanner.service.js";
import { ObjectStorageService } from "../storage/object-storage.service.js";
import { isValidLessonAssetSignature } from "../content/lesson-asset-signature.js";

const FILE_RULES = [
  { extension: "jpg", contentType: "image/jpeg" },
  { extension: "jpeg", contentType: "image/jpeg" },
  { extension: "png", contentType: "image/png" },
  { extension: "webp", contentType: "image/webp" },
  { extension: "pdf", contentType: "application/pdf" },
] as const;

@Injectable()
export class InquiryAttachmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorageService,
    private readonly scanner: MalwareScannerService,
  ) {}

  async startUpload(user: CurrentUser, body: unknown, requestId?: string) {
    const input = uploadInput(body, this.storage.getInquiryAttachmentMaxBytes());
    const attachmentId = randomUUID();
    const objectKey = `inquiry-attachments/${attachmentId}/source.${input.extension}`;
    await this.prisma.$transaction(async (transaction) => {
      await transaction.inquiryAttachment.create({
        data: {
          id: attachmentId,
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
          action: "inquiry.attachment.upload_requested",
          resourceType: "InquiryAttachment",
          resourceId: attachmentId,
          requestId: requestId ?? null,
          metadata: { contentType: input.contentType, size: input.size },
        },
      });
    });
    const upload = await this.storage.createInquiryAttachmentUpload({
      attachmentId,
      ownerUserId: user.id,
      contentType: input.contentType,
      size: input.size,
      extension: input.extension,
    });
    return {
      attachment: { id: attachmentId, status: "quarantined" as const },
      upload: { method: upload.method, url: upload.url, fields: upload.fields, expiresAt: upload.expiresAt },
    };
  }

  async completeUpload(user: CurrentUser, attachmentId: string, requestId?: string) {
    const attachment = await this.prisma.inquiryAttachment.findFirst({
      where: { id: attachmentId, ownerUserId: user.id, inquiryId: null },
    });
    if (!attachment) notFound();
    if (attachment.status === InquiryAttachmentStatus.READY) return attachmentView(attachment);
    if (attachment.status === InquiryAttachmentStatus.REJECTED) {
      throw new ApiError("INQUIRY_ATTACHMENT_REJECTED", "거부된 첨부파일은 다시 사용할 수 없습니다.", HttpStatus.CONFLICT);
    }
    const bytes = await this.storage.inspectInquiryAttachment({
      objectKey: attachment.objectKey,
      attachmentId: attachment.id,
      ownerUserId: user.id,
      contentType: attachment.contentType,
      size: attachment.size,
    });
    if (!isValidLessonAssetSignature(attachment.contentType, bytes)) {
      await this.reject(user, attachment.id, "signature", "FILE_SIGNATURE_INVALID", requestId);
      throw new ApiError(
        "INQUIRY_ATTACHMENT_SIGNATURE_INVALID",
        "파일 내용이 선언된 형식과 일치하지 않아 격리했습니다.",
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const scan = await this.scanner.scan(bytes);
    if (!scan.clean) {
      await this.reject(user, attachment.id, scan.provider, scan.result, requestId);
      throw new ApiError("MALWARE_DETECTED", "악성 파일이 탐지되어 첨부파일을 거부했습니다.", HttpStatus.UNPROCESSABLE_ENTITY);
    }
    const scannedAt = new Date();
    const ready = await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.inquiryAttachment.update({
        where: { id: attachment.id },
        data: {
          status: InquiryAttachmentStatus.READY,
          scanProvider: scan.provider,
          scanResult: scan.result,
          scannedAt,
        },
      });
      await transaction.auditLog.create({
        data: {
          actorId: user.id,
          action: "inquiry.attachment.scan_passed",
          resourceType: "InquiryAttachment",
          resourceId: attachment.id,
          requestId: requestId ?? null,
          metadata: { provider: scan.provider, size: attachment.size },
        },
      });
      return updated;
    });
    return attachmentView(ready);
  }

  async downloadMine(user: CurrentUser, inquiryId: string) {
    const attachment = await this.prisma.inquiryAttachment.findFirst({
      where: { inquiryId, ownerUserId: user.id, status: InquiryAttachmentStatus.READY },
    });
    if (!attachment) notFound();
    return this.sign(attachment);
  }

  async downloadAdmin(inquiryId: string) {
    const attachment = await this.prisma.inquiryAttachment.findFirst({
      where: { inquiryId, status: InquiryAttachmentStatus.READY },
    });
    if (!attachment) notFound();
    return this.sign(attachment);
  }

  private async sign(attachment: { objectKey: string; contentType: string; originalName: string }) {
    return this.storage.signAssetUrl(attachment.objectKey, {
      contentType: attachment.contentType,
      fileName: attachment.originalName,
      inline: false,
    });
  }

  private async reject(user: CurrentUser, attachmentId: string, provider: string, result: string, requestId?: string) {
    const safeResult = result.slice(0, 100);
    await this.prisma.$transaction(async (transaction) => {
      await transaction.inquiryAttachment.update({
        where: { id: attachmentId },
        data: {
          status: InquiryAttachmentStatus.REJECTED,
          scanProvider: provider.slice(0, 50),
          scanResult: safeResult,
          scannedAt: new Date(),
        },
      });
      await transaction.auditLog.create({
        data: {
          actorId: user.id,
          action: "inquiry.attachment.rejected",
          resourceType: "InquiryAttachment",
          resourceId: attachmentId,
          requestId: requestId ?? null,
          metadata: { provider: provider.slice(0, 50), result: safeResult },
        },
      });
    });
  }
}

function uploadInput(body: unknown, maxBytes: number) {
  const input = readInputObject(
    body,
    ["fileName", "contentType", "size"],
    "INQUIRY_ATTACHMENT_INVALID",
    "첨부파일 정보를 확인해 주세요.",
  );
  const fileName = requiredString(
    input,
    "fileName",
    { maxLength: 255 },
    "INQUIRY_ATTACHMENT_INVALID",
    "첨부파일 정보를 확인해 주세요.",
  );
  const contentType = requiredString(
    input,
    "contentType",
    { maxLength: 100 },
    "INQUIRY_ATTACHMENT_INVALID",
    "첨부파일 정보를 확인해 주세요.",
  ).toLowerCase();
  const size = input.size;
  const extension = fileName.includes(".") ? fileName.split(".").pop()?.toLowerCase() ?? "" : "";
  const rule = FILE_RULES.find((item) => item.extension === extension && item.contentType === contentType);
  if (
    !rule
    || /[\u0000-\u001f\u007f/\\]/u.test(fileName)
    || !Number.isSafeInteger(size)
    || (size as number) <= 0
    || (size as number) > maxBytes
  ) {
    throw new ApiError(
      "INQUIRY_ATTACHMENT_INVALID",
      `JPG·PNG·WebP·PDF 파일만 최대 ${Math.floor(maxBytes / 1024 / 1024)}MB까지 첨부할 수 있습니다.`,
      HttpStatus.BAD_REQUEST,
    );
  }
  return { fileName, contentType: rule.contentType, size: size as number, extension: rule.extension };
}

export function attachmentView(attachment: {
  id: string;
  originalName: string;
  contentType: string;
  size: number;
  status: InquiryAttachmentStatus;
}) {
  return {
    id: attachment.id,
    originalName: attachment.originalName,
    contentType: attachment.contentType,
    size: attachment.size,
    status: attachment.status.toLowerCase(),
  };
}

function notFound(): never {
  throw new ApiError("INQUIRY_ATTACHMENT_NOT_FOUND", "첨부파일을 찾을 수 없습니다.", HttpStatus.NOT_FOUND);
}
