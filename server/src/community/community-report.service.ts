import { HttpStatus, Injectable } from "@nestjs/common";
import type { CurrentUser } from "../auth/auth.types.js";
import { ApiError } from "../common/api-error.js";
import { PrismaService } from "../database/prisma.service.js";
import {
  CommunityPostStatus,
  CommunityPostType,
  CommunityReportResolution,
  CommunityReportStatus,
} from "../generated/prisma/enums.js";
import {
  readCommunityReportStatus,
  readOptionalCommunityType,
  readReportPage,
  validateCommunityReport,
  validateReportResolution,
} from "./community-report-validation.js";

@Injectable()
export class CommunityReportService {
  constructor(private readonly prisma: PrismaService) {}

  async submit(user: CurrentUser, postId: string, body: unknown, requestId?: string) {
    const input = validateCommunityReport(body);
    const post = await this.prisma.communityPost.findUnique({
      where: { id: postId },
      select: { id: true, type: true, status: true },
    });
    if (!post || post.status !== CommunityPostStatus.PUBLISHED) {
      throw new ApiError("COMMUNITY_POST_NOT_REPORTABLE", "신고할 수 있는 게시글이 아닙니다.", HttpStatus.NOT_FOUND);
    }

    try {
      const report = await this.prisma.$transaction(async (transaction) => {
        const created = await transaction.communityPostReport.create({
          data: { postId, reporterUserId: user.id, ...input },
        });
        await transaction.auditLog.create({
          data: {
            actorId: user.id,
            action: "community.post.reported",
            resourceType: "CommunityPostReport",
            resourceId: created.id,
            requestId: requestId ?? null,
            metadata: { type: post.type.toLowerCase(), reason: created.reason.toLowerCase() },
          },
        });
        return created;
      });
      return { report: submitView(report) };
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ApiError(
          "COMMUNITY_REPORT_ALREADY_SUBMITTED",
          "이미 신고한 게시글입니다.",
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    }
  }

  async listAdmin(query: Record<string, unknown>) {
    const status = readCommunityReportStatus(query.status);
    const type = readOptionalCommunityType(query.type);
    const page = readReportPage(query.page, 1, 100_000);
    const pageSize = readReportPage(query.pageSize, 20, 100);
    const where = {
      ...(status ? { status } : {}),
      ...(type ? { post: { type } } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.communityPostReport.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { post: { include: { author: { select: { displayName: true } } } } },
      }),
      this.prisma.communityPostReport.count({ where }),
    ]);
    return {
      items: items.map(adminReportView),
      pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    };
  }

  async resolve(user: CurrentUser, reportId: string, body: unknown, requestId?: string) {
    const action = validateReportResolution(body);
    const existing = await this.prisma.communityPostReport.findUnique({
      where: { id: reportId },
      include: { post: { include: { author: { select: { displayName: true } } } } },
    });
    if (!existing) notFound();
    if (existing.status !== CommunityReportStatus.OPEN) invalidTransition();
    if (action === "hide" && existing.post.status === CommunityPostStatus.ARCHIVED) invalidTransition();

    const now = new Date();
    const report = await this.prisma.$transaction(async (transaction) => {
      if (action === "hide") {
        const claimed = await transaction.communityPostReport.updateMany({
          where: { id: reportId, status: CommunityReportStatus.OPEN },
          data: {
            status: CommunityReportStatus.RESOLVED,
            resolution: CommunityReportResolution.HIDDEN,
            resolvedById: user.id,
            resolvedAt: now,
          },
        });
        if (claimed.count !== 1) invalidTransition();
        await transaction.communityPost.update({
          where: { id: existing.postId },
          data: { status: CommunityPostStatus.HIDDEN },
        });
        await transaction.communityPostReport.updateMany({
          where: { postId: existing.postId, status: CommunityReportStatus.OPEN },
          data: {
            status: CommunityReportStatus.RESOLVED,
            resolution: CommunityReportResolution.HIDDEN,
            resolvedById: user.id,
            resolvedAt: now,
          },
        });
      } else {
        const updated = await transaction.communityPostReport.updateMany({
          where: { id: reportId, status: CommunityReportStatus.OPEN },
          data: {
            status: CommunityReportStatus.DISMISSED,
            resolution: CommunityReportResolution.DISMISSED,
            resolvedById: user.id,
            resolvedAt: now,
          },
        });
        if (updated.count !== 1) invalidTransition();
      }
      await transaction.auditLog.create({
        data: {
          actorId: user.id,
          action: `community.report.${action === "hide" ? "hidden" : "dismissed"}`,
          resourceType: "CommunityPostReport",
          resourceId: reportId,
          requestId: requestId ?? null,
          metadata: {
            type: existing.post.type.toLowerCase(),
            postId: existing.postId,
            resolution: action,
          },
        },
      });
      return transaction.communityPostReport.findUniqueOrThrow({
        where: { id: reportId },
        include: { post: { include: { author: { select: { displayName: true } } } } },
      });
    });
    return { report: adminReportView(report) };
  }
}

function submitView(report: { id: string; status: CommunityReportStatus; createdAt: Date }) {
  return { id: report.id, status: report.status.toLowerCase(), createdAt: report.createdAt };
}

type AdminReport = {
  id: string;
  reason: string;
  detail: string | null;
  status: string;
  resolution: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
  post: {
    id: string;
    type: CommunityPostType;
    title: string;
    status: CommunityPostStatus;
    author: { displayName: string };
  };
};

function adminReportView(report: AdminReport) {
  return {
    id: report.id,
    reason: report.reason.toLowerCase(),
    detail: report.detail,
    status: report.status.toLowerCase(),
    resolution: report.resolution?.toLowerCase() ?? null,
    resolvedAt: report.resolvedAt,
    createdAt: report.createdAt,
    post: {
      id: report.post.id,
      type: report.post.type === CommunityPostType.CLASS_TIP ? "classTip" : "travel",
      title: report.post.title,
      status: report.post.status.toLowerCase(),
      authorLabel: report.post.author.displayName,
    },
  };
}

function isUniqueConstraintError(error: unknown): error is { code: "P2002" } {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002");
}

function notFound(): never {
  throw new ApiError("COMMUNITY_REPORT_NOT_FOUND", "신고를 찾을 수 없습니다.", HttpStatus.NOT_FOUND);
}

function invalidTransition(): never {
  throw new ApiError("COMMUNITY_REPORT_ALREADY_RESOLVED", "이미 처리되었거나 처리할 수 없는 신고입니다.", HttpStatus.CONFLICT);
}
