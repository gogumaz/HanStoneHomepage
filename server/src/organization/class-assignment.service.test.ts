import { describe, expect, it, vi } from "vitest";
import type { CurrentUser } from "../auth/auth.types.js";
import { PrismaService } from "../database/prisma.service.js";
import {
  ClassAssignmentItemType,
  ClassAssignmentStatus,
  LessonProgressStatus,
  LessonStatus,
  MissionAttemptStatus,
} from "../generated/prisma/enums.js";
import { ClassAssignmentService } from "./class-assignment.service.js";
import { OrganizationAccessService } from "./organization-access.service.js";

const classId = "10000000-0000-4000-8000-000000000001";
const assignmentId = "20000000-0000-4000-8000-000000000001";
const studentId = "30000000-0000-4000-8000-000000000001";
const teacher = { id: "40000000-0000-4000-8000-000000000001", displayName: "김지도", roles: ["instructor"] } as CurrentUser;
const organizationClass = { id: classId, organizationId: "50000000-0000-4000-8000-000000000001", name: "햇살반", academicYear: 2026, organization: { id: "50000000-0000-4000-8000-000000000001", name: "한빛초" } };
const lesson = { id: "PRE-01", status: LessonStatus.PUBLISHED, title: "첫 강의", course: "입문", order: 1, era: { id: "pre", name: "선사", order: 1 } };
const mission = { id: "mission-01", title: "활로 찾기", boardSize: 9, difficulty: 1, era: { id: "pre", name: "선사", order: 1 } };
const dueAt = new Date(Date.now() + 7 * 24 * 60 * 60_000);

function fixture(status: ClassAssignmentStatus = ClassAssignmentStatus.DRAFT, studentDisplayName = "강하늘") {
  return {
    id: assignmentId,
    organizationClassId: classId,
    createdByUserId: teacher.id,
    reassignedFromId: null,
    title: "이번 주 과제",
    description: "강의와 미션을 완료하세요.",
    dueAt,
    status,
    revision: 1,
    publishedAt: status === ClassAssignmentStatus.PUBLISHED ? new Date() : null,
    canceledAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    organizationClass,
    items: [
      { id: "item-lesson", assignmentId, type: ClassAssignmentItemType.LESSON, lessonId: lesson.id, missionId: null, order: 1, createdAt: new Date(), lesson, mission: null },
      { id: "item-mission", assignmentId, type: ClassAssignmentItemType.BADUK_MISSION, lessonId: null, missionId: mission.id, order: 2, createdAt: new Date(), lesson: null, mission },
    ],
    targets: [{ id: "target-1", assignmentId, studentId, assignedAt: new Date(), teacherComment: null, commentVersion: 0, commentedByUserId: null, commentedAt: null, student: { id: studentId, displayName: studentDisplayName } }],
    _count: { reassignedAssignments: 0 },
  };
}

function setup(completed = true, studentDisplayName = "강하늘") {
  let stored = fixture(ClassAssignmentStatus.DRAFT, studentDisplayName);
  const notifications = { createMany: vi.fn(async ({ data }: { data: unknown[] }) => ({ count: data.length })), create: vi.fn(async ({ data }: { data: unknown }) => data) };
  const audit = vi.fn(async () => ({ id: "audit" }));
  const transaction = {
    organizationClassAssignment: {
      create: vi.fn(async () => stored),
      updateMany: vi.fn(async () => { stored = fixture(ClassAssignmentStatus.PUBLISHED, studentDisplayName); return { count: 1 }; }),
      update: vi.fn(async () => stored),
      findUniqueOrThrow: vi.fn(async () => stored),
    },
    organizationClassAssignmentItem: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    organizationClassAssignmentTarget: { deleteMany: vi.fn(async () => ({ count: 0 })), update: vi.fn(async () => stored.targets[0]) },
    userNotification: notifications,
    auditLog: { create: audit },
  };
  const prisma = {
    organizationClassAssignment: { findUnique: vi.fn(async () => stored), findMany: vi.fn(async () => [stored]) },
    organizationClassEnrollment: { findMany: vi.fn(async () => [{ student: { id: studentId, displayName: "강하늘" }, startsAt: new Date() }]) },
    lesson: { findMany: vi.fn(async () => [{ id: lesson.id }]) },
    badukMission: { findMany: vi.fn(async () => [{ id: mission.id }]) },
    lessonProgress: { findMany: vi.fn(async () => completed ? [{ userId: studentId, lessonId: lesson.id, status: LessonProgressStatus.COMPLETED, startedAt: new Date(), completedAt: new Date(), updatedAt: new Date() }] : []) },
    missionAttempt: { findMany: vi.fn(async () => completed ? [{ userId: studentId, missionId: mission.id, status: MissionAttemptStatus.COMPLETED, startedAt: new Date(), completedAt: new Date(), lastPlayedAt: new Date(), score: 90, wrongMoveCount: 0, hintUseCount: 1 }] : []) },
    userNotification: notifications,
    auditLog: { create: audit },
    $transaction: vi.fn(async (callback: (client: typeof transaction) => unknown) => callback(transaction)),
  } as unknown as PrismaService;
  const access = { requireCurrentClassAssignment: vi.fn(async () => ({ organizationClass })) } as unknown as OrganizationAccessService;
  return { service: new ClassAssignmentService(prisma, access), notifications, audit };
}

describe("ClassAssignmentService", () => {
  it("creates a targeted draft and publishes one idempotent notification per student", async () => {
    const { service, notifications, audit } = setup();
    const created = await service.create(teacher, classId, {
      title: "이번 주 과제",
      description: "강의와 미션을 완료하세요.",
      dueAt: dueAt.toISOString(),
      items: [{ type: "lesson", resourceId: lesson.id }, { type: "baduk_mission", resourceId: mission.id }],
      targetStudentIds: [studentId],
    }, "request-1");
    expect(created.assignment.status).toBe("draft");

    const published = await service.publish(teacher, assignmentId, "request-2");
    expect(published.assignment.status).toBe("published");
    expect(notifications.createMany).toHaveBeenCalledWith(expect.objectContaining({ skipDuplicates: true }));
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "organization.class_assignment.published" }) }));
  });

  it("aggregates lesson completion and mission correctness without creating a second learning record", async () => {
    const { service } = setup();
    await service.publish(teacher, assignmentId);
    const result = await service.getResults(teacher, assignmentId);
    expect(result.summary).toMatchObject({ totalStudents: 1, completedStudents: 1, completionRate: 100 });
    expect(result.itemStatistics).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "baduk_mission", correctnessRate: 100 }),
    ]));
    expect(result.students[0]).toMatchObject({ status: "completed", completedItems: 2 });
  });

  it("creates due-soon reminders with database uniqueness protection", async () => {
    const { service, notifications } = setup(false);
    const result = await service.sendDueSoonReminders(new Date(dueAt.getTime() - 12 * 60 * 60_000));
    expect(result).toEqual({ scanned: 1, created: 1 });
    expect(notifications.createMany).toHaveBeenCalledWith(expect.objectContaining({ skipDuplicates: true }));
  });

  it("neutralizes spreadsheet formulas in result CSV exports", async () => {
    const { service } = setup(true, "=HYPERLINK(\"https://example.test\")");
    await service.publish(teacher, assignmentId);
    const file = await service.exportResultsCsv(teacher, assignmentId);
    expect(file.content).toContain("\"'=HYPERLINK(\"\"https://example.test\"\")\"");
  });
});
