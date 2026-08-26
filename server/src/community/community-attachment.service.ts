import { randomUUID } from "node:crypto";
import { HttpStatus, Injectable } from "@nestjs/common";
import type { CurrentUser } from "../auth/auth.types.js";
import { ApiError } from "../common/api-error.js";
import { readInputObject, requiredString } from "../common/input-validation.js";
import { isValidLessonAssetSignature } from "../content/lesson-asset-signature.js";
import { PrismaService } from "../database/prisma.service.js";
import {
  CommunityAttachmentKind,
  CommunityAttachmentStatus,
  CommunityPostStatus,
} from "../generated/prisma/enums.js";
import { MalwareScannerService } from "../storage/malware-scanner.service.js";
import { ObjectStorageService } from "../storage/object-storage.service.js";
import { containsExifGps } from "./community-image-privacy.js";

const MATERIAL_RULES = [
  { extension: "pdf", contentType: "application/pdf" },
  { extension: "pptx", contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation" },
  { extension: "docx", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  { extension: "hwpx", contentType: "application/hwp+zip" },
] as const;
const PHOTO_RULES = [
  { extension: "jpg", contentType: "image/jpeg" },
  { extension: "jpeg", contentType: "image/jpeg" },
  { extension: "png", contentType: "image/png" },
  { extension: "webp", contentType: "image/webp" },
] as const;

@Injectable()
export class CommunityAttachmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorageService,
    private readonly scanner: MalwareScannerService,
  ) {}

  async startUpload(user: CurrentUser, body: unknown, requestId?: string) {
    const input = uploadInput(body, this.storage.getCommunityAttachmentMaxBytes());
    const attachmentId = randomUUID();
    const objectKey = `community-attachments/${attachmentId}/source.${input.extension}`;
    await this.prisma.$transaction(async (transaction) => {
      await transaction.communityAttachment.create({
        data: {
          id: attachmentId,
          ownerUserId: user.id,
          kind: input.kind,
          objectKey,
          originalName: input.fileName,
          contentType: input.contentType,
          size: input.size,
        },
      });
      await transaction.auditLog.create({
        data: {
          actorId: user.id,
          action: "community.attachment.upload_requested",
          resourceType: "CommunityAttachment",
          resourceId: attachmentId,
          requestId: requestId ?? null,
          metadata: { kind: input.kind.toLowerCase(), contentType: input.contentType, size: input.size },
        },
      });
    });
    const kind = input.kind === CommunityAttachmentKind.PHOTO ? "photo" : "material";
    const upload = await this.storage.createCommunityAttachmentUpload({
      attachmentId,
      ownerUserId: user.id,
      kind,
      contentType: input.contentType,
      size: input.size,
      extension: input.extension,
    });
    return {
      attachment: { id: attachmentId, kind, status: "quarantined" as const },
      upload: { method: upload.method, url: upload.url, fields: upload.fields, expiresAt: upload.expiresAt },
    };
  }

  async completeUpload(user: CurrentUser, attachmentId: string, requestId?: string) {
    const attachment = await this.prisma.communityAttachment.findFirst({
      where: { id: attachmentId, ownerUserId: user.id, postId: null },
    });
    if (!attachment) notFound();
    if (attachment.status === CommunityAttachmentStatus.READY) return attachmentView(attachment);
    if (attachment.status === CommunityAttachmentStatus.REJECTED) {
      throw new ApiError("COMMUNITY_ATTACHMENT_REJECTED", "거부된 첨부파일은 다시 사용할 수 없습니다.", HttpStatus.CONFLICT);
    }
    const kind = attachment.kind === CommunityAttachmentKind.PHOTO ? "photo" : "material";
    const bytes = await this.storage.inspectCommunityAttachment({
      objectKey: attachment.objectKey,
      attachmentId: attachment.id,
      ownerUserId: user.id,
      kind,
      contentType: attachment.contentType,
      size: attachment.size,
    });
    if (!isValidLessonAssetSignature(attachment.contentType, bytes)) {
      await this.reject(user, attachment.id, "signature", "FILE_SIGNATURE_INVALID", requestId);
      throw new ApiError(
        "COMMUNITY_ATTACHMENT_SIGNATURE_INVALID",
        "파일 내용이 선언된 형식과 일치하지 않아 격리했습니다.",
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if (attachment.kind === CommunityAttachmentKind.PHOTO && containsExifGps(attachment.contentType, bytes)) {
      await this.reject(user, attachment.id, "privacy", "EXIF_GPS_PRESENT", requestId);
      throw new ApiError(
        "COMMUNITY_PHOTO_LOCATION_METADATA",
        "사진에 위치정보가 포함되어 있습니다. 위치정보를 제거한 뒤 다시 첨부해 주세요.",
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const scan = await this.scanner.scan(bytes);
    if (!scan.clean) {
      await this.reject(user, attachment.id, scan.provider, scan.result, requestId);
      throw new ApiError("MALWARE_DETECTED", "악성 파일이 탐지되어 첨부파일을 거부했습니다.", HttpStatus.UNPROCESSABLE_ENTITY);
    }
    const ready = await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.communityAttachment.update({
        where: { id: attachment.id },
        data: {
          status: CommunityAttachmentStatus.READY,
          scanProvider: scan.provider,
          scanResult: scan.result.slice(0, 100),
          scannedAt: new Date(),
        },
      });
      await transaction.auditLog.create({
        data: {
          actorId: user.id,
          action: "community.attachment.scan_passed",
          resourceType: "CommunityAttachment",
          resourceId: attachment.id,
          requestId: requestId ?? null,
          metadata: { provider: scan.provider.slice(0, 50), kind, size: attachment.size },
        },
      });
      return updated;
    });
    return attachmentView(ready);
  }

  async download(postId: string, user?: CurrentUser) {
    const attachment = await this.prisma.communityAttachment.findFirst({
      where: { postId, status: CommunityAttachmentStatus.READY },
      include: { post: { select: { status: true, publishedAt: true, authorUserId: true } } },
    });
    if (!attachment?.post) notFound();
    const publicPost = attachment.post.status === CommunityPostStatus.PUBLISHED
      && Boolean(attachment.post.publishedAt && attachment.post.publishedAt <= new Date());
    const privateAccess = Boolean(user && (
      user.id === attachment.post.authorUserId
      || user.roles.includes("operator")
      || user.roles.includes("admin")
    ));
    if (!publicPost && !privateAccess) notFound();
    return this.storage.signAssetUrl(attachment.objectKey, {
      contentType: attachment.contentType,
      fileName: attachment.originalName,
      inline: attachment.kind === CommunityAttachmentKind.PHOTO,
    });
  }

  private async reject(user: CurrentUser, attachmentId: string, provider: string, result: string, requestId?: string) {
    const safeProvider = provider.slice(0, 50);
    const safeResult = result.slice(0, 100);
    await this.prisma.$transaction(async (transaction) => {
      await transaction.communityAttachment.update({
        where: { id: attachmentId },
        data: {
          status: CommunityAttachmentStatus.REJECTED,
          scanProvider: safeProvider,
          scanResult: safeResult,
          scannedAt: new Date(),
        },
      });
      await transaction.auditLog.create({
        data: {
          actorId: user.id,
          action: "community.attachment.rejected",
          resourceType: "CommunityAttachment",
          resourceId: attachmentId,
          requestId: requestId ?? null,
          metadata: { provider: safeProvider, result: safeResult },
        },
      });
    });
  }
}

function uploadInput(body: unknown, maxBytes: number) {
  const input = readInputObject(
    body,
    ["kind", "fileName", "contentType", "size"],
    "COMMUNITY_ATTACHMENT_INVALID",
    "첨부파일 정보를 확인해 주세요.",
  );
  const kindValue = requiredString(input, "kind", { maxLength: 20 }, "COMMUNITY_ATTACHMENT_INVALID", "첨부파일 정보를 확인해 주세요.");
  const kind = kindValue === "material" ? CommunityAttachmentKind.MATERIAL
    : kindValue === "photo" ? CommunityAttachmentKind.PHOTO
      : null;
  if (!kind) invalid(maxBytes);
  const fileName = requiredString(input, "fileName", { maxLength: 255 }, "COMMUNITY_ATTACHMENT_INVALID", "첨부파일 정보를 확인해 주세요.");
  const contentType = requiredString(input, "contentType", { maxLength: 100 }, "COMMUNITY_ATTACHMENT_INVALID", "첨부파일 정보를 확인해 주세요.").toLowerCase();
  const size = input.size;
  const extension = fileName.includes(".") ? fileName.split(".").pop()?.toLowerCase() ?? "" : "";
  const rules = kind === CommunityAttachmentKind.PHOTO ? PHOTO_RULES : MATERIAL_RULES;
  const rule = rules.find((item) => item.extension === extension && item.contentType === contentType);
  if (
    !rule
    || /[\u0000-\u001f\u007f/\\]/u.test(fileName)
    || !Number.isSafeInteger(size)
    || (size as number) <= 0
    || (size as number) > maxBytes
  ) invalid(maxBytes);
  return { kind, fileName, contentType: rule.contentType, size: size as number, extension: rule.extension };
}

function attachmentView(attachment: {
  id: string;
  kind: CommunityAttachmentKind;
  originalName: string;
  contentType: string;
  size: number;
  status: CommunityAttachmentStatus;
}) {
  return {
    id: attachment.id,
    kind: attachment.kind === CommunityAttachmentKind.PHOTO ? "photo" : "material",
    originalName: attachment.originalName,
    contentType: attachment.contentType,
    size: attachment.size,
    status: attachment.status.toLowerCase(),
  };
}

function invalid(maxBytes: number): never {
  throw new ApiError(
    "COMMUNITY_ATTACHMENT_INVALID",
    `수업자료는 PDF·PPTX·DOCX·HWPX, 여행기 사진은 JPG·PNG·WebP 형식으로 최대 ${Math.floor(maxBytes / 1024 / 1024)}MB까지 첨부할 수 있습니다.`,
    HttpStatus.BAD_REQUEST,
  );
}

function notFound(): never {
  throw new ApiError("COMMUNITY_ATTACHMENT_NOT_FOUND", "첨부파일을 찾을 수 없습니다.", HttpStatus.NOT_FOUND);
}
