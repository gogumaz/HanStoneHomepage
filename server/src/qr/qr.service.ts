import { createHash } from "node:crypto";
import { HttpStatus, Injectable } from "@nestjs/common";
import { ApiError } from "../common/api-error.js";
import { PrismaService } from "../database/prisma.service.js";
import { LessonQrCodeStatus, LessonStatus } from "../generated/prisma/enums.js";

const QR_CODE_PATTERN = /^[A-Z0-9_-]{16,128}$/;

export function normalizeQrCode(value: string): string {
  return value.trim().toUpperCase();
}

export function hashQrCode(value: string): string {
  return createHash("sha256").update(normalizeQrCode(value), "utf8").digest("hex");
}

@Injectable()
export class QrService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(codeValue: string) {
    const code = normalizeQrCode(codeValue);
    if (!QR_CODE_PATTERN.test(code)) {
      throw new ApiError("QR_CODE_NOT_FOUND", "QR 코드를 확인해 주세요.", HttpStatus.NOT_FOUND);
    }
    const record = await this.prisma.lessonQrCode.findUnique({
      where: { codeHash: hashQrCode(code) },
      include: {
        lesson: {
          select: { id: true, title: true, status: true },
        },
      },
    });
    if (!record) {
      throw new ApiError("QR_CODE_NOT_FOUND", "QR 코드를 확인해 주세요.", HttpStatus.NOT_FOUND);
    }

    const now = new Date();
    const status = record.status !== LessonQrCodeStatus.ACTIVE
      ? "disabled" as const
      : record.expiresAt && record.expiresAt <= now
        ? "expired" as const
        : record.maxClaims !== null && record.claimCount >= record.maxClaims
          ? "used" as const
          : record.lesson.status !== LessonStatus.PUBLISHED
            ? "unavailable" as const
            : "active" as const;
    const target = status === "active" ? {
      type: "lesson" as const,
      lesson: { id: record.lesson.id, title: record.lesson.title },
      path: `/lessons/${encodeURIComponent(record.lesson.id)}`,
    } : null;

    return {
      status,
      expiresAt: record.expiresAt,
      remainingClaims: record.maxClaims === null
        ? null
        : Math.max(0, record.maxClaims - record.claimCount),
      target,
    };
  }
}
