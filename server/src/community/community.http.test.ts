import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "../app.module.js";
import { hashSessionToken } from "../auth/session-cookie.js";
import { ApiExceptionFilter } from "../common/api-exception.filter.js";
import { ApiResponseInterceptor } from "../common/api-response.interceptor.js";
import { RequestIdMiddleware } from "../common/request-id.middleware.js";
import { PrismaService } from "../database/prisma.service.js";
import { listenForHttpTest } from "../test-utils/listen-test-app.js";
import { MalwareScannerService } from "../storage/malware-scanner.service.js";
import { ObjectStorageService } from "../storage/object-storage.service.js";
import {
  AccountStatus,
  CommunityAttachmentStatus,
  CommunityPostStatus,
  CommunityPostType,
  CommunityReportResolution,
  CommunityReportStatus,
  RoleType,
} from "../generated/prisma/enums.js";
import { TRAVEL_PUBLICATION_CONSENT_VERSION } from "./community-validation.js";

const instructor = account("00000000-0000-0000-0000-000000000711", RoleType.INSTRUCTOR, "김지도");
const otherInstructor = account("00000000-0000-0000-0000-000000000712", RoleType.INSTRUCTOR, "이지도");
const operator = account("00000000-0000-0000-0000-000000000713", RoleType.OPERATOR, "커뮤니티 운영자");
const student = account("00000000-0000-0000-0000-000000000714", RoleType.STUDENT, "학생");

function account(id: string, role: RoleType, displayName: string) {
  return {
    id, email: `${id.slice(-3)}@example.test`, displayName, passwordHash: null,
    emailVerifiedAt: new Date(), status: AccountStatus.ACTIVE, roles: [{ role }],
  };
}

function jpegWithExifGps() {
  const tiff = [
    0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00,
    0x25, 0x88, 0x04, 0x00, 0x01, 0x00, 0x00, 0x00, 0x1a, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
  ];
  const payload = [...Buffer.from("Exif\0\0", "binary"), ...tiff];
  const length = payload.length + 2;
  return Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, length >> 8, length & 0xff, ...payload, 0xff, 0xd9]);
}

function createPrismaMock() {
  const users = new Map([instructor, otherInstructor, operator, student].map((user) => [user.id, user]));
  const records: Array<Record<string, any>> = [
    post({
      id: "community-public",
      type: CommunityPostType.CLASS_TIP,
      authorUserId: instructor.id,
      category: "바둑활동",
      title: "공개 수업 팁",
      content: "활로를 활용한 수업입니다.",
      targetGrade: "초등 3~4학년",
      era: "선사시대",
      badukLevel: "입문",
      status: CommunityPostStatus.PUBLISHED,
      publishedAt: new Date("2026-08-20T00:00:00.000Z"),
    }),
    post({
      id: "community-own-pending",
      type: CommunityPostType.CLASS_TIP,
      authorUserId: instructor.id,
      category: "수업설계",
      title: "내 검토 대기 글",
      content: "검토를 기다리는 수업안입니다.",
      targetGrade: "전 학년",
      era: "고조선",
      badukLevel: "초급",
    }),
    post({
      id: "community-other-pending",
      type: CommunityPostType.CLASS_TIP,
      authorUserId: otherInstructor.id,
      category: "역사활동",
      title: "다른 지도자 검토 대기 글",
      content: "다른 지도자의 비공개 초안입니다.",
      targetGrade: "초등 5~6학년",
      era: "조선",
      badukLevel: "중급",
    }),
  ];
  const auditCreate = vi.fn(async () => ({ id: "community-audit" }));
  const reports: Array<Record<string, any>> = [];
  const attachments: Array<Record<string, any>> = [];
  const matches = (record: Record<string, any>, where: Record<string, any>): boolean => Object.entries(where).every(([field, value]) => {
    if (field === "OR") return (value as Array<Record<string, any>>).some((condition) => matches(record, condition));
    if (field === "AND") return (value as Array<Record<string, any>>).every((condition) => matches(record, condition));
    if (value && typeof value === "object" && !Array.isArray(value)) {
      if ("contains" in value) return String(record[field] ?? "").toLowerCase().includes(String(value.contains).toLowerCase());
      if ("lte" in value) return record[field] != null && record[field] <= value.lte;
      if ("not" in value) return record[field] !== value.not;
    }
    return record[field] === value;
  });
  const withAuthor = (record: Record<string, any>) => ({
    ...record,
    author: { displayName: users.get(record.authorUserId)?.displayName ?? "탈퇴 회원" },
    attachment: attachments.find((attachment) => attachment.postId === record.id) ?? null,
  });
  const communityPost = {
    findMany: vi.fn(async ({ where, skip = 0, take = 50 }: { where: Record<string, any>; skip?: number; take?: number }) => records
      .filter((record) => matches(record, where))
      .sort((left, right) => (right.publishedAt?.getTime?.() ?? right.createdAt.getTime()) - (left.publishedAt?.getTime?.() ?? left.createdAt.getTime()))
      .slice(skip, skip + take)
      .map(withAuthor)),
    count: vi.fn(async ({ where }: { where: Record<string, any> }) => records.filter((record) => matches(record, where)).length),
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
      const record = records.find((item) => item.id === where.id);
      return record ? withAuthor(record) : null;
    }),
    findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => {
      const record = records.find((item) => item.id === where.id);
      if (!record) throw new Error("community post missing");
      return withAuthor(record);
    }),
    create: vi.fn(async ({ data }: { data: Record<string, any> }) => {
      const record = post({ id: `community-${records.length + 1}`, ...data });
      records.push(record);
      return record;
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, any> }) => {
      const record = records.find((item) => item.id === where.id);
      if (!record) throw new Error("community post missing");
      Object.assign(record, data, { updatedAt: new Date() });
      return withAuthor(record);
    }),
  };
  const reportWithPost = (report: Record<string, any>) => {
    const relatedPost = records.find((item) => item.id === report.postId);
    if (!relatedPost) throw new Error("reported post missing");
    return { ...report, post: withAuthor(relatedPost) };
  };
  const reportMatches = (report: Record<string, any>, where: Record<string, any>) => Object.entries(where).every(([field, value]) => {
    if (field === "post") {
      const relatedPost = records.find((item) => item.id === report.postId);
      return Boolean(relatedPost && matches(relatedPost, value as Record<string, any>));
    }
    return report[field] === value;
  });
  const communityPostReport = {
    create: vi.fn(async ({ data }: { data: Record<string, any> }) => {
      if (reports.some((report) => report.postId === data.postId && report.reporterUserId === data.reporterUserId)) {
        throw Object.assign(new Error("duplicate report"), { code: "P2002" });
      }
      const now = new Date();
      const report = {
        id: `community-report-${reports.length + 1}`,
        status: CommunityReportStatus.OPEN,
        resolution: null,
        resolvedById: null,
        resolvedAt: null,
        createdAt: now,
        updatedAt: now,
        ...data,
      };
      reports.push(report);
      return report;
    }),
    findMany: vi.fn(async ({ where, skip = 0, take = 20 }: { where: Record<string, any>; skip?: number; take?: number }) => reports
      .filter((report) => reportMatches(report, where))
      .slice(skip, skip + take)
      .map(reportWithPost)),
    count: vi.fn(async ({ where }: { where: Record<string, any> }) => reports.filter((report) => reportMatches(report, where)).length),
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
      const report = reports.find((item) => item.id === where.id);
      return report ? reportWithPost(report) : null;
    }),
    findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => {
      const report = reports.find((item) => item.id === where.id);
      if (!report) throw new Error("community report missing");
      return reportWithPost(report);
    }),
    updateMany: vi.fn(async ({ where, data }: { where: Record<string, any>; data: Record<string, any> }) => {
      const selected = reports.filter((report) => reportMatches(report, where));
      selected.forEach((report) => Object.assign(report, data, { updatedAt: new Date() }));
      return { count: selected.length };
    }),
  };
  const communityAttachment = {
    create: vi.fn(async ({ data }: { data: Record<string, any> }) => {
      const now = new Date();
      const attachment = {
        postId: null,
        status: CommunityAttachmentStatus.QUARANTINED,
        scanProvider: null,
        scanResult: null,
        scannedAt: null,
        createdAt: now,
        updatedAt: now,
        ...data,
      };
      attachments.push(attachment);
      return attachment;
    }),
    findFirst: vi.fn(async ({ where }: { where: Record<string, any> }) => {
      const attachment = attachments.find((item) => matches(item, where));
      if (!attachment) return null;
      const relatedPost = records.find((item) => item.id === attachment.postId);
      return relatedPost ? { ...attachment, post: relatedPost } : attachment;
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, any> }) => {
      const attachment = attachments.find((item) => item.id === where.id);
      if (!attachment) throw new Error("community attachment missing");
      Object.assign(attachment, data, { updatedAt: new Date() });
      return attachment;
    }),
    updateMany: vi.fn(async ({ where, data }: { where: Record<string, any>; data: Record<string, any> }) => {
      const selected = attachments.filter((item) => matches(item, where));
      selected.forEach((item) => Object.assign(item, data, { updatedAt: new Date() }));
      return { count: selected.length };
    }),
  };
  const sessions = new Map([
    [hashSessionToken("community-instructor"), instructor],
    [hashSessionToken("community-other"), otherInstructor],
    [hashSessionToken("community-operator"), operator],
    [hashSessionToken("community-student"), student],
  ]);
  const prisma = {
    communityPost,
    communityPostReport,
    communityAttachment,
    auditLog: { create: auditCreate },
    session: { findUnique: vi.fn(async ({ where }: { where: { tokenHash: string } }) => {
      const user = sessions.get(where.tokenHash);
      return user ? { id: `session-${user.id}`, userId: user.id, expiresAt: new Date(Date.now() + 60_000), revokedAt: null, user } : null;
    }) },
    isReady: vi.fn(async () => true),
    $transaction: vi.fn(async (operation: (transaction: unknown) => unknown) => operation(prisma)),
  };
  return { prisma: prisma as unknown as PrismaService, records, reports, attachments, auditCreate };
}

function post(overrides: Record<string, any>) {
  const now = new Date("2026-08-24T00:00:00.000Z");
  return {
    type: CommunityPostType.CLASS_TIP,
    authorUserId: instructor.id,
    category: "수업설계",
    title: "수업 팁",
    content: "수업 팁 내용",
    targetGrade: null,
    era: null,
    badukLevel: null,
    className: null,
    publicationConsentVersion: null,
    publicationConsentedAt: null,
    status: CommunityPostStatus.PENDING_REVIEW,
    rejectionReason: null,
    reviewedById: null,
    reviewedAt: null,
    publishedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("community post HTTP flow", () => {
  let app: INestApplication;
  let baseUrl: string;
  const state = createPrismaMock();
  const mutationHeaders = (token: string) => ({
    "content-type": "application/json",
    "x-requested-with": "XMLHttpRequest",
    cookie: `baduk_session=${token}`,
  });

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5432/test";
    process.env.SESSION_COOKIE_NAME = "baduk_session";
    delete process.env.RATE_LIMIT_REDIS_URL;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(state.prisma)
      .overrideProvider(ObjectStorageService)
      .useValue({
        getCommunityAttachmentMaxBytes: () => 20 * 1024 * 1024,
        createCommunityAttachmentUpload: vi.fn(async ({ attachmentId, extension }: { attachmentId: string; extension: string }) => ({
          method: "POST",
          url: "https://storage.example.test/upload",
          fields: { key: `community-attachments/${attachmentId}/source.${extension}` },
          expiresAt: new Date(Date.now() + 60_000),
        })),
        inspectCommunityAttachment: vi.fn(async ({ contentType }: { contentType: string }) => contentType === "image/jpeg"
          ? jpegWithExifGps()
          : Uint8Array.from(Buffer.from("%PDF-1.7 safe community material"))),
        signAssetUrl: vi.fn(async () => ({
          url: "https://storage.example.test/download",
          expiresAt: new Date(Date.now() + 60_000),
        })),
      })
      .overrideProvider(MalwareScannerService)
      .useValue({ scan: vi.fn(async () => ({ clean: true, provider: "clamav", result: "OK" })) })
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    const requestId = new RequestIdMiddleware();
    app.use(requestId.use.bind(requestId));
    app.useGlobalFilters(new ApiExceptionFilter());
    app.useGlobalInterceptors(new ApiResponseInterceptor());
    baseUrl = await listenForHttpTest(app);
  });

  afterAll(async () => app.close());

  it("shows published posts publicly and only the signed-in author's pending posts", async () => {
    const guest = await fetch(`${baseUrl}/api/v1/posts?type=classTip`);
    const guestPayload = await guest.json() as any;
    expect(guest.status, JSON.stringify(guestPayload)).toBe(200);
    expect(guestPayload.data.items.map((item: any) => item.id)).toEqual(["community-public"]);
    expect(guestPayload.data.items[0]).not.toHaveProperty("authorUserId");

    const mine = await fetch(`${baseUrl}/api/v1/posts?type=classTip`, {
      headers: { cookie: "baduk_session=community-instructor" },
    });
    const mineIds = (await mine.json() as any).data.items.map((item: any) => item.id);
    expect(mineIds).toContain("community-public");
    expect(mineIds).toContain("community-own-pending");
    expect(mineIds).not.toContain("community-other-pending");
  });

  it("allows instructors to submit class tips for review but blocks students and files", async () => {
    const input = {
      type: "classTip",
      category: "바둑활동",
      title: "활로 관찰 수업",
      targetGrade: "초등 3~4학년",
      era: "선사시대",
      badukLevel: "입문",
      content: "교실에서 활로를 직접 찾아봅니다.",
      attachment: "",
    };
    expect((await fetch(`${baseUrl}/api/v1/posts`, {
      method: "POST", headers: mutationHeaders("community-student"), body: JSON.stringify(input),
    })).status).toBe(403);
    const file = await fetch(`${baseUrl}/api/v1/posts`, {
      method: "POST",
      headers: mutationHeaders("community-instructor"),
      body: JSON.stringify({ ...input, attachment: "class-tip.pdf" }),
    });
    expect(file.status).toBe(400);
    expect((await file.json() as any).error.code).toBe("COMMUNITY_ATTACHMENT_NOT_SUPPORTED");

    const created = await fetch(`${baseUrl}/api/v1/posts`, {
      method: "POST", headers: mutationHeaders("community-instructor"), body: JSON.stringify(input),
    });
    const payload = await created.json() as any;
    expect(created.status, JSON.stringify(payload)).toBe(201);
    expect(payload.data.post).toMatchObject({ type: "classTip", status: "pending_review", authorLabel: "김지도" });
    expect(state.auditCreate).toHaveBeenLastCalledWith({
      data: expect.objectContaining({
        action: "community.post.created",
        metadata: { type: "class_tip", category: "바둑활동", status: "pending_review", hasAttachment: false },
      }),
    });
    expect(JSON.stringify(state.auditCreate.mock.calls.at(-1))).not.toContain("교실에서 활로를");
  });

  it("requires travel consent and supports operator rejection, resubmission, publication, and archival", async () => {
    const input = {
      type: "travel",
      category: "교실여행",
      title: "우리 반 역사 여행",
      className: "별빛 교실",
      era: "고조선",
      content: "고조선 미션을 함께 해결했습니다.",
      attachment: "",
    };
    const missingConsent = await fetch(`${baseUrl}/api/v1/posts`, {
      method: "POST", headers: mutationHeaders("community-instructor"), body: JSON.stringify(input),
    });
    expect(missingConsent.status).toBe(400);

    const created = await fetch(`${baseUrl}/api/v1/posts`, {
      method: "POST", headers: mutationHeaders("community-instructor"), body: JSON.stringify({ ...input, consent: true }),
    });
    const postId = (await created.json() as any).data.post.id;
    const stored = state.records.find((item) => item.id === postId);
    expect(stored).toMatchObject({
      status: CommunityPostStatus.PENDING_REVIEW,
      publicationConsentVersion: TRAVEL_PUBLICATION_CONSENT_VERSION,
    });
    expect(stored?.publicationConsentedAt).toBeInstanceOf(Date);

    const rejected = await fetch(`${baseUrl}/api/v1/admin/posts/${postId}/reject`, {
      method: "POST",
      headers: mutationHeaders("community-operator"),
      body: JSON.stringify({ reason: "기관명을 조금 더 명확히 적어 주세요." }),
    });
    expect((await rejected.json() as any).data.post).toMatchObject({
      status: "rejected", rejectionReason: "기관명을 조금 더 명확히 적어 주세요.",
    });
    const denied = await fetch(`${baseUrl}/api/v1/posts/${postId}`, {
      method: "PATCH",
      headers: mutationHeaders("community-other"),
      body: JSON.stringify({ className: "다른 기관" }),
    });
    expect(denied.status).toBe(404);

    const resubmitted = await fetch(`${baseUrl}/api/v1/posts/${postId}`, {
      method: "PATCH",
      headers: mutationHeaders("community-instructor"),
      body: JSON.stringify({ className: "별빛 바둑교실", consent: true }),
    });
    expect((await resubmitted.json() as any).data.post.status).toBe("pending_review");
    const published = await fetch(`${baseUrl}/api/v1/admin/posts/${postId}/publish`, {
      method: "POST", headers: mutationHeaders("community-operator"),
    });
    expect((await published.json() as any).data.post.status).toBe("published");
    const publicTravel = await fetch(`${baseUrl}/api/v1/posts?type=travel`);
    expect((await publicTravel.json() as any).data.items[0]).toMatchObject({ id: postId, consent: true });

    const archived = await fetch(`${baseUrl}/api/v1/posts/${postId}`, {
      method: "DELETE", headers: mutationHeaders("community-instructor"),
    });
    expect((await archived.json() as any).data.post.status).toBe("archived");
    expect((await (await fetch(`${baseUrl}/api/v1/posts?type=travel`)).json() as any).data.items).toHaveLength(0);
  });

  it("accepts one authenticated report per published post without exposing reporter identity", async () => {
    const guest = await fetch(`${baseUrl}/api/v1/posts/community-public/reports`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-requested-with": "XMLHttpRequest" },
      body: JSON.stringify({ reason: "spam" }),
    });
    expect(guest.status).toBe(401);

    const submitted = await fetch(`${baseUrl}/api/v1/posts/community-public/reports`, {
      method: "POST",
      headers: mutationHeaders("community-student"),
      body: JSON.stringify({ reason: "other", detail: "광고 링크가 반복해서 포함되어 있습니다." }),
    });
    const payload = await submitted.json() as any;
    expect(submitted.status, JSON.stringify(payload)).toBe(201);
    expect(payload.data.report).toMatchObject({ id: "community-report-1", status: "open" });
    expect(payload.data.report).not.toHaveProperty("reporterUserId");
    expect(state.auditCreate).toHaveBeenLastCalledWith({
      data: expect.objectContaining({
        action: "community.post.reported",
        metadata: { type: "class_tip", reason: "other" },
      }),
    });
    expect(JSON.stringify(state.auditCreate.mock.calls.at(-1))).not.toContain("광고 링크");

    const duplicate = await fetch(`${baseUrl}/api/v1/posts/community-public/reports`, {
      method: "POST",
      headers: mutationHeaders("community-student"),
      body: JSON.stringify({ reason: "spam" }),
    });
    expect(duplicate.status).toBe(409);
    expect((await duplicate.json() as any).error.code).toBe("COMMUNITY_REPORT_ALREADY_SUBMITTED");

    const pending = await fetch(`${baseUrl}/api/v1/posts/community-own-pending/reports`, {
      method: "POST",
      headers: mutationHeaders("community-student"),
      body: JSON.stringify({ reason: "spam" }),
    });
    expect(pending.status).toBe(404);
  });

  it("lets operators dismiss or hide reports and removes hidden posts from public results", async () => {
    const forbidden = await fetch(`${baseUrl}/api/v1/admin/community-reports?status=open`, {
      headers: { cookie: "baduk_session=community-student" },
    });
    expect(forbidden.status).toBe(403);

    const inbox = await fetch(`${baseUrl}/api/v1/admin/community-reports?status=open&type=classTip`, {
      headers: { cookie: "baduk_session=community-operator" },
    });
    const inboxPayload = await inbox.json() as any;
    expect(inbox.status, JSON.stringify(inboxPayload)).toBe(200);
    expect(inboxPayload.data.items[0]).toMatchObject({
      id: "community-report-1",
      reason: "other",
      post: { id: "community-public", type: "classTip", status: "published" },
    });
    expect(inboxPayload.data.items[0]).not.toHaveProperty("reporterUserId");

    const dismissed = await fetch(`${baseUrl}/api/v1/admin/community-reports/community-report-1/resolve`, {
      method: "POST",
      headers: mutationHeaders("community-operator"),
      body: JSON.stringify({ action: "dismiss" }),
    });
    expect((await dismissed.json() as any).data.report).toMatchObject({
      status: "dismissed", resolution: "dismissed", post: { status: "published" },
    });

    const second = await fetch(`${baseUrl}/api/v1/posts/community-public/reports`, {
      method: "POST",
      headers: mutationHeaders("community-other"),
      body: JSON.stringify({ reason: "personal_info", detail: "개인 연락처가 본문에 노출되어 있습니다." }),
    });
    const secondId = (await second.json() as any).data.report.id;
    const hidden = await fetch(`${baseUrl}/api/v1/admin/community-reports/${secondId}/resolve`, {
      method: "POST",
      headers: mutationHeaders("community-operator"),
      body: JSON.stringify({ action: "hide" }),
    });
    expect((await hidden.json() as any).data.report).toMatchObject({
      status: "resolved", resolution: "hidden", post: { status: "hidden" },
    });
    expect(state.records.find((item) => item.id === "community-public")?.status).toBe(CommunityPostStatus.HIDDEN);
    expect(state.reports.find((item) => item.id === secondId)).toMatchObject({
      status: CommunityReportStatus.RESOLVED,
      resolution: CommunityReportResolution.HIDDEN,
    });

    const publicList = await fetch(`${baseUrl}/api/v1/posts?type=classTip`);
    expect((await publicList.json() as any).data.items).toHaveLength(0);
    const hiddenUpdate = await fetch(`${baseUrl}/api/v1/posts/community-public`, {
      method: "PATCH",
      headers: mutationHeaders("community-instructor"),
      body: JSON.stringify({ title: "숨김 해제를 위한 임의 수정" }),
    });
    expect(hiddenUpdate.status).toBe(409);
    expect((await hiddenUpdate.json() as any).error.code).toBe("COMMUNITY_POST_HIDDEN");
  });

  it("quarantines, scans, links, and privately serves a class-tip attachment until publication", async () => {
    const upload = await fetch(`${baseUrl}/api/v1/community-attachments/uploads`, {
      method: "POST",
      headers: mutationHeaders("community-instructor"),
      body: JSON.stringify({
        kind: "material",
        fileName: "활로-활동지.pdf",
        contentType: "application/pdf",
        size: 34,
      }),
    });
    const uploadPayload = await upload.json() as any;
    expect(upload.status, JSON.stringify(uploadPayload)).toBe(201);
    const attachmentId = uploadPayload.data.attachment.id;
    expect(uploadPayload.data.attachment).toMatchObject({ kind: "material", status: "quarantined" });

    const completed = await fetch(`${baseUrl}/api/v1/community-attachments/${attachmentId}/complete`, {
      method: "POST", headers: mutationHeaders("community-instructor"),
    });
    expect((await completed.json() as any).data).toMatchObject({ id: attachmentId, status: "ready" });

    const created = await fetch(`${baseUrl}/api/v1/posts`, {
      method: "POST",
      headers: mutationHeaders("community-instructor"),
      body: JSON.stringify({
        type: "classTip", category: "바둑활동", title: "첨부자료가 있는 수업",
        targetGrade: "초등 3~4학년", era: "선사시대", badukLevel: "입문",
        content: "검사를 통과한 수업자료를 함께 제공합니다.", attachmentId,
      }),
    });
    const createdPayload = await created.json() as any;
    expect(created.status, JSON.stringify(createdPayload)).toBe(201);
    const postId = createdPayload.data.post.id;
    expect(createdPayload.data.post.attachment).toMatchObject({
      originalName: "활로-활동지.pdf", kind: "material",
      downloadUrl: `/api/v1/posts/${postId}/attachment`,
    });

    const guestDenied = await fetch(`${baseUrl}/api/v1/posts/${postId}/attachment`, { redirect: "manual" });
    expect(guestDenied.status).toBe(404);
    const ownerDownload = await fetch(`${baseUrl}/api/v1/posts/${postId}/attachment`, {
      headers: { cookie: "baduk_session=community-instructor" }, redirect: "manual",
    });
    expect(ownerDownload.status).toBe(302);
    expect(ownerDownload.headers.get("location")).toBe("https://storage.example.test/download");

    await fetch(`${baseUrl}/api/v1/admin/posts/${postId}/publish`, {
      method: "POST", headers: mutationHeaders("community-operator"),
    });
    const publicDownload = await fetch(`${baseUrl}/api/v1/posts/${postId}/attachment`, { redirect: "manual" });
    expect(publicDownload.status).toBe(302);

    const reused = await fetch(`${baseUrl}/api/v1/posts`, {
      method: "POST",
      headers: mutationHeaders("community-instructor"),
      body: JSON.stringify({
        type: "classTip", category: "바둑활동", title: "첨부 재사용 시도",
        targetGrade: "초등 3~4학년", era: "선사시대", badukLevel: "입문",
        content: "같은 첨부파일을 다시 연결하려고 합니다.", attachmentId,
      }),
    });
    expect(reused.status).toBe(409);
    expect((await reused.json() as any).error.code).toBe("COMMUNITY_ATTACHMENT_NOT_READY");
  });

  it("blocks student uploads and rejects travel photos containing EXIF GPS data", async () => {
    const body = JSON.stringify({ kind: "photo", fileName: "현장학습.jpg", contentType: "image/jpeg", size: 40 });
    const studentUpload = await fetch(`${baseUrl}/api/v1/community-attachments/uploads`, {
      method: "POST", headers: mutationHeaders("community-student"), body,
    });
    expect(studentUpload.status).toBe(403);

    const upload = await fetch(`${baseUrl}/api/v1/community-attachments/uploads`, {
      method: "POST", headers: mutationHeaders("community-instructor"), body,
    });
    const attachmentId = (await upload.json() as any).data.attachment.id;
    const completed = await fetch(`${baseUrl}/api/v1/community-attachments/${attachmentId}/complete`, {
      method: "POST", headers: mutationHeaders("community-instructor"),
    });
    const payload = await completed.json() as any;
    expect(completed.status).toBe(422);
    expect(payload.error.code).toBe("COMMUNITY_PHOTO_LOCATION_METADATA");
    expect(state.attachments.find((item) => item.id === attachmentId)?.status).toBe(CommunityAttachmentStatus.REJECTED);
    expect(state.auditCreate).toHaveBeenLastCalledWith({
      data: expect.objectContaining({
        action: "community.attachment.rejected",
        metadata: { provider: "privacy", result: "EXIF_GPS_PRESENT" },
      }),
    });
  });
});
