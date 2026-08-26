import { HttpStatus, Injectable } from "@nestjs/common";
import type { CurrentUser } from "../auth/auth.types.js";
import { ApiError } from "../common/api-error.js";
import { readInputObject, requiredString } from "../common/input-validation.js";
import { PrismaService } from "../database/prisma.service.js";
import { ConsultationStatus } from "../generated/prisma/enums.js";
import { validateConsultationInput } from "./consultation-validation.js";
import { CONSULTATION_CATEGORIES, CONSULTATION_PRIVACY_VERSION } from "./consultation.types.js";

const STATUS_VALUES = {
  submitted: ConsultationStatus.SUBMITTED,
  in_review: ConsultationStatus.IN_REVIEW,
  contacted: ConsultationStatus.CONTACTED,
  closed: ConsultationStatus.CLOSED,
} as const;

const STATUS_TRANSITIONS: Record<ConsultationStatus, readonly ConsultationStatus[]> = {
  [ConsultationStatus.SUBMITTED]: [ConsultationStatus.IN_REVIEW, ConsultationStatus.CLOSED],
  [ConsultationStatus.IN_REVIEW]: [ConsultationStatus.CONTACTED, ConsultationStatus.CLOSED],
  [ConsultationStatus.CONTACTED]: [ConsultationStatus.IN_REVIEW, ConsultationStatus.CLOSED],
  [ConsultationStatus.CLOSED]: [ConsultationStatus.IN_REVIEW],
};

@Injectable()
export class ConsultationService {
  constructor(private readonly prisma: PrismaService) {}

  async submit(body: unknown, user?: CurrentUser, requestId?: string) {
    const input = validateConsultationInput(body);
    const privacyConsentedAt = new Date();
    const consultation = await this.prisma.$transaction(async (transaction) => {
      const created = await transaction.consultation.create({
        data: {
          ...input,
          requesterUserId: user?.id ?? null,
          privacyConsentVersion: CONSULTATION_PRIVACY_VERSION,
          privacyConsentedAt,
        },
      });
      await transaction.auditLog.create({
        data: {
          actorId: user?.id ?? null,
          action: "consultation.submitted",
          resourceType: "Consultation",
          resourceId: created.id,
          requestId: requestId ?? null,
          metadata: {
            category: input.category,
            expectedStudentsBand: studentBand(input.expectedStudents),
            privacyConsentVersion: CONSULTATION_PRIVACY_VERSION,
          },
        },
      });
      return created;
    });
    return {
      id: consultation.id,
      status: consultation.status.toLowerCase(),
      createdAt: consultation.createdAt,
    };
  }

  async listMine(user: CurrentUser) {
    const items = await this.prisma.consultation.findMany({
      where: { requesterUserId: user.id },
      orderBy: { createdAt: "desc" },
    });
    return {
      items: items.map((item) => ({
        id: item.id,
        category: item.category,
        organizationName: item.organizationName,
        contactName: item.contactName,
        phone: item.phone,
        email: item.email,
        expectedStudents: item.expectedStudents,
        title: item.title,
        content: item.content,
        status: item.status.toLowerCase(),
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      })),
    };
  }

  async listAdmin(query: Record<string, unknown>) {
    const status = readAdminStatus(query.status);
    const category = readQueryString(query.category, "CONSULTATION_FILTER_INVALID", 30);
    if (category && !(CONSULTATION_CATEGORIES as readonly string[]).includes(category)) {
      throw new ApiError("CONSULTATION_FILTER_INVALID", "기관 유형 필터를 확인해 주세요.", HttpStatus.BAD_REQUEST);
    }
    const search = readQueryString(query.q, "CONSULTATION_SEARCH_INVALID", 100);
    const page = readQueryInteger(query.page, 1, 100_000, 1);
    const pageSize = readQueryInteger(query.pageSize, 1, 100, 20);
    const where = {
      ...(status ? { status } : {}),
      ...(category ? { category } : {}),
      ...(search ? {
        OR: [
          { organizationName: { contains: search, mode: "insensitive" as const } },
          { contactName: { contains: search, mode: "insensitive" as const } },
          { title: { contains: search, mode: "insensitive" as const } },
          { email: { contains: search, mode: "insensitive" as const } },
          { phone: { contains: search } },
        ],
      } : {}),
    };
    const [items, total, statusGroups] = await Promise.all([
      this.prisma.consultation.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.consultation.count({ where }),
      this.prisma.consultation.groupBy({ by: ["status"], _count: { _all: true } }),
    ]);
    const statusCounts = Object.fromEntries(Object.keys(STATUS_VALUES).map((key) => [key, 0]));
    for (const group of statusGroups) statusCounts[group.status.toLowerCase()] = group._count._all;
    return {
      items: items.map(adminConsultation),
      pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
      summary: { total: Object.values(statusCounts).reduce((sum, count) => sum + count, 0), ...statusCounts },
    };
  }

  async getAdmin(consultationId: string) {
    const consultation = await this.requireConsultation(consultationId);
    return { consultation: adminConsultation(consultation) };
  }

  async updateStatus(
    user: CurrentUser,
    consultationId: string,
    body: unknown,
    requestId?: string,
  ) {
    const input = readInputObject(
      body,
      ["status"],
      "CONSULTATION_STATUS_INVALID",
      "상담 상태를 확인해 주세요.",
    );
    const statusValue = requiredString(
      input,
      "status",
      { maxLength: 20 },
      "CONSULTATION_STATUS_INVALID",
      "상담 상태를 확인해 주세요.",
    );
    const nextStatus = STATUS_VALUES[statusValue as keyof typeof STATUS_VALUES];
    if (!nextStatus) {
      throw new ApiError("CONSULTATION_STATUS_INVALID", "상담 상태를 확인해 주세요.", HttpStatus.BAD_REQUEST);
    }
    const existing = await this.requireConsultation(consultationId);
    if (existing.status === nextStatus) return { consultation: adminConsultation(existing) };
    if (!STATUS_TRANSITIONS[existing.status].includes(nextStatus)) {
      throw new ApiError(
        "CONSULTATION_STATUS_TRANSITION_INVALID",
        "현재 상담 상태에서 요청한 상태로 변경할 수 없습니다.",
        HttpStatus.CONFLICT,
      );
    }
    const previousStatus = existing.status;
    const updated = await this.prisma.$transaction(async (transaction) => {
      const consultation = await transaction.consultation.update({
        where: { id: consultationId, status: previousStatus },
        data: { status: nextStatus },
      });
      await transaction.auditLog.create({
        data: {
          actorId: user.id,
          action: "consultation.status_changed",
          resourceType: "Consultation",
          resourceId: consultationId,
          requestId: requestId ?? null,
          metadata: {
            previousStatus: previousStatus.toLowerCase(),
            status: nextStatus.toLowerCase(),
          },
        },
      });
      return consultation;
    });
    return { consultation: adminConsultation(updated) };
  }

  private async requireConsultation(consultationId: string) {
    const consultation = await this.prisma.consultation.findUnique({ where: { id: consultationId } });
    if (!consultation) {
      throw new ApiError("CONSULTATION_NOT_FOUND", "상담 접수 내역을 찾을 수 없습니다.", HttpStatus.NOT_FOUND);
    }
    return consultation;
  }
}

function studentBand(value: number): string {
  if (value <= 20) return "1-20";
  if (value <= 50) return "21-50";
  if (value <= 100) return "51-100";
  return "101+";
}

function adminConsultation(item: {
  id: string;
  requesterUserId: string | null;
  category: string;
  organizationName: string;
  contactName: string;
  phone: string;
  email: string | null;
  expectedStudents: number;
  title: string;
  content: string;
  privacyConsentVersion: string;
  privacyConsentedAt: Date;
  status: ConsultationStatus;
  createdAt: Date;
  updatedAt: Date;
}) {
  return { ...item, status: item.status.toLowerCase() };
}

function readAdminStatus(value: unknown): ConsultationStatus | undefined {
  const normalized = readQueryString(value, "CONSULTATION_FILTER_INVALID", 20);
  if (!normalized || normalized === "all") return undefined;
  const status = STATUS_VALUES[normalized as keyof typeof STATUS_VALUES];
  if (!status) throw new ApiError("CONSULTATION_FILTER_INVALID", "상담 상태 필터를 확인해 주세요.", HttpStatus.BAD_REQUEST);
  return status;
}

function readQueryString(value: unknown, code: string, maxLength: number): string {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string") throw new ApiError(code, "상담 조회 조건을 확인해 주세요.", HttpStatus.BAD_REQUEST);
  const normalized = value.trim();
  if (normalized.length > maxLength) throw new ApiError(code, "상담 조회 조건을 확인해 주세요.", HttpStatus.BAD_REQUEST);
  return normalized;
}

function readQueryInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value !== "string" || !/^\d+$/u.test(value)) {
    throw new ApiError("CONSULTATION_PAGINATION_INVALID", "페이지 조건을 확인해 주세요.", HttpStatus.BAD_REQUEST);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new ApiError("CONSULTATION_PAGINATION_INVALID", "페이지 조건을 확인해 주세요.", HttpStatus.BAD_REQUEST);
  }
  return parsed;
}
