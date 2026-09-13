import { HttpStatus, Injectable, Logger } from "@nestjs/common";
import type { CurrentUser } from "../auth/auth.types.js";
import { ApiError } from "../common/api-error.js";
import { readInputObject, requiredString, optionalString } from "../common/input-validation.js";
import { PrismaService } from "../database/prisma.service.js";
import {
  AccountStatus,
  BadukMissionStatus,
  ClassAssignmentItemType,
  ClassAssignmentStatus,
  LessonProgressStatus,
  LessonStatus,
  MissionAttemptStatus,
  UserNotificationKind,
} from "../generated/prisma/enums.js";
import { OrganizationAccessService } from "./organization-access.service.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const RESOURCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,59}$/u;
const MAX_DUE_WINDOW_MS = 366 * 24 * 60 * 60_000;

type AssignmentItemInput = { type: "lesson" | "baduk_mission"; resourceId: string };
type AssignmentInput = {
  title: string;
  description: string | null;
  dueAt: Date;
  items: AssignmentItemInput[];
  targetStudentIds: string[] | null;
};

@Injectable()
export class ClassAssignmentService {
  private readonly logger = new Logger(ClassAssignmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrganizationAccessService,
  ) {}

  async getOptions(user: CurrentUser, classId: string) {
    const assignment = await this.access.requireCurrentClassAssignment(user.id, classId, new Date());
    const [lessons, missions, students] = await Promise.all([
      this.prisma.lesson.findMany({
        where: { status: LessonStatus.PUBLISHED },
        include: { era: { select: { id: true, name: true, order: true } } },
        orderBy: [{ era: { order: "asc" } }, { order: "asc" }],
      }),
      this.prisma.badukMission.findMany({
        where: { status: BadukMissionStatus.PUBLISHED },
        include: { era: { select: { id: true, name: true, order: true } } },
        orderBy: [{ displayOrder: "asc" }, { id: "asc" }],
      }),
      this.activeClassStudents(classId, new Date()),
    ]);
    return {
      class: assignment.organizationClass,
      lessons: lessons.map((lesson) => ({
        id: lesson.id, title: lesson.title, course: lesson.course, order: lesson.order, era: lesson.era,
      })),
      missions: missions.map((mission) => ({
        id: mission.id, title: mission.title, boardSize: mission.boardSize,
        difficulty: mission.difficulty, era: mission.era,
      })),
      students,
    };
  }

  async listForClass(user: CurrentUser, classId: string) {
    await this.access.requireCurrentClassAssignment(user.id, classId, new Date());
    const assignments = await this.prisma.organizationClassAssignment.findMany({
      where: { organizationClassId: classId },
      include: {
        _count: { select: { items: true, targets: true, reassignedAssignments: true } },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    return { items: assignments.map((assignment) => this.assignmentSummaryView(assignment)) };
  }

  async getTeacher(user: CurrentUser, assignmentId: string) {
    const assignment = await this.requireTeacherAssignment(user, assignmentId);
    return { assignment: this.assignmentDetailView(assignment) };
  }

  async create(user: CurrentUser, classId: string, body: unknown, requestId?: string) {
    const now = new Date();
    await this.access.requireCurrentClassAssignment(user.id, classId, now);
    const input = this.readAssignmentInput(body, now);
    const targetStudentIds = await this.resolveTargets(classId, input.targetStudentIds, now);
    await this.validateResources(input.items);
    const created = await this.prisma.$transaction(async (transaction) => {
      const assignment = await transaction.organizationClassAssignment.create({
        data: {
          organizationClassId: classId,
          createdByUserId: user.id,
          title: input.title,
          description: input.description,
          dueAt: input.dueAt,
          items: { create: this.itemCreateData(input.items) },
          targets: { create: targetStudentIds.map((studentId) => ({ studentId })) },
        },
        include: this.assignmentInclude(),
      });
      await transaction.auditLog.create({
        data: {
          actorId: user.id,
          action: "organization.class_assignment.created",
          resourceType: "OrganizationClassAssignment",
          resourceId: assignment.id,
          requestId: requestId ?? null,
          metadata: { organizationClassId: classId, itemCount: input.items.length, targetCount: targetStudentIds.length },
        },
      });
      return assignment;
    });
    return { assignment: this.assignmentDetailView(created) };
  }

  async update(user: CurrentUser, assignmentId: string, body: unknown, requestId?: string) {
    const existing = await this.requireTeacherAssignment(user, assignmentId);
    if (existing.status !== ClassAssignmentStatus.DRAFT) this.assignmentLocked();
    const now = new Date();
    const input = this.readAssignmentInput(body, now);
    const targetStudentIds = await this.resolveTargets(existing.organizationClassId, input.targetStudentIds, now);
    await this.validateResources(input.items);
    const updated = await this.prisma.$transaction(async (transaction) => {
      await transaction.organizationClassAssignmentItem.deleteMany({ where: { assignmentId } });
      await transaction.organizationClassAssignmentTarget.deleteMany({ where: { assignmentId } });
      const assignment = await transaction.organizationClassAssignment.update({
        where: { id: assignmentId },
        data: {
          title: input.title,
          description: input.description,
          dueAt: input.dueAt,
          revision: { increment: 1 },
          items: { create: this.itemCreateData(input.items) },
          targets: { create: targetStudentIds.map((studentId) => ({ studentId })) },
        },
        include: this.assignmentInclude(),
      });
      await transaction.auditLog.create({
        data: {
          actorId: user.id,
          action: "organization.class_assignment.updated",
          resourceType: "OrganizationClassAssignment",
          resourceId: assignmentId,
          requestId: requestId ?? null,
          metadata: { itemCount: input.items.length, targetCount: targetStudentIds.length },
        },
      });
      return assignment;
    });
    return { assignment: this.assignmentDetailView(updated) };
  }

  async publish(user: CurrentUser, assignmentId: string, requestId?: string) {
    const existing = await this.requireTeacherAssignment(user, assignmentId);
    if (existing.status !== ClassAssignmentStatus.DRAFT) this.assignmentLocked();
    const now = new Date();
    if (existing.dueAt <= now) this.invalid("과제 마감일은 현재보다 이후여야 합니다.");
    await this.resolveTargets(existing.organizationClassId, existing.targets.map((target) => target.studentId), now);
    const published = await this.prisma.$transaction(async (transaction) => {
      const claimed = await transaction.organizationClassAssignment.updateMany({
        where: { id: assignmentId, status: ClassAssignmentStatus.DRAFT, dueAt: { gt: now } },
        data: { status: ClassAssignmentStatus.PUBLISHED, publishedAt: now },
      });
      if (claimed.count !== 1) this.assignmentLocked();
      const assignment = await transaction.organizationClassAssignment.findUniqueOrThrow({
        where: { id: assignmentId }, include: this.assignmentInclude(),
      });
      await transaction.userNotification.createMany({
        data: assignment.targets.map((target) => ({
          userId: target.studentId,
          kind: UserNotificationKind.ASSIGNMENT_PUBLISHED,
          resourceType: "OrganizationClassAssignment",
          resourceId: assignment.id,
          resourceVersion: assignment.revision,
          title: "새 과제가 도착했어요",
          message: `${assignment.title} · ${this.formatKoreanDate(assignment.dueAt)}까지`,
        })),
        skipDuplicates: true,
      });
      await transaction.auditLog.create({
        data: {
          actorId: user.id,
          action: "organization.class_assignment.published",
          resourceType: "OrganizationClassAssignment",
          resourceId: assignment.id,
          requestId: requestId ?? null,
          metadata: { targetCount: assignment.targets.length, revision: assignment.revision },
        },
      });
      return assignment;
    });
    return { assignment: this.assignmentDetailView(published) };
  }

  async cancel(user: CurrentUser, assignmentId: string, requestId?: string) {
    const existing = await this.requireTeacherAssignment(user, assignmentId);
    if (existing.status === ClassAssignmentStatus.CANCELED) {
      return { assignment: this.assignmentDetailView(existing) };
    }
    if (existing.status !== ClassAssignmentStatus.PUBLISHED) this.assignmentLocked();
    const now = new Date();
    const canceled = await this.prisma.$transaction(async (transaction) => {
      const assignment = await transaction.organizationClassAssignment.update({
        where: { id: assignmentId },
        data: { status: ClassAssignmentStatus.CANCELED, canceledAt: now },
        include: this.assignmentInclude(),
      });
      await transaction.userNotification.createMany({
        data: assignment.targets.map((target) => ({
          userId: target.studentId,
          kind: UserNotificationKind.ASSIGNMENT_CANCELED,
          resourceType: "OrganizationClassAssignment",
          resourceId: assignment.id,
          resourceVersion: assignment.revision,
          title: "과제가 취소되었습니다",
          message: assignment.title,
        })),
        skipDuplicates: true,
      });
      await transaction.auditLog.create({
        data: {
          actorId: user.id,
          action: "organization.class_assignment.canceled",
          resourceType: "OrganizationClassAssignment",
          resourceId: assignment.id,
          requestId: requestId ?? null,
          metadata: {},
        },
      });
      return assignment;
    });
    return { assignment: this.assignmentDetailView(canceled) };
  }

  async listMine(student: CurrentUser) {
    const assignments = await this.prisma.organizationClassAssignment.findMany({
      where: {
        status: { in: [ClassAssignmentStatus.PUBLISHED, ClassAssignmentStatus.CANCELED] },
        targets: { some: { studentId: student.id } },
      },
      include: this.assignmentInclude(),
      orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
    });
    const evaluated = await this.evaluate(assignments, new Date());
    return { items: evaluated.map((item) => this.studentAssignmentView(item, student.id)) };
  }

  async getMine(student: CurrentUser, assignmentId: string) {
    if (!UUID_PATTERN.test(assignmentId)) this.notFound();
    const assignment = await this.prisma.organizationClassAssignment.findFirst({
      where: {
        id: assignmentId,
        status: { in: [ClassAssignmentStatus.PUBLISHED, ClassAssignmentStatus.CANCELED] },
        targets: { some: { studentId: student.id } },
      },
      include: this.assignmentInclude(),
    });
    if (!assignment) this.notFound();
    const [evaluated] = await this.evaluate([assignment], new Date());
    return { assignment: this.studentAssignmentView(evaluated!, student.id) };
  }

  async getResults(user: CurrentUser, assignmentId: string, requestId?: string) {
    const assignment = await this.requireTeacherAssignment(user, assignmentId);
    const [evaluated] = await this.evaluate([assignment], new Date());
    const result = this.resultsView(evaluated!);
    await this.prisma.auditLog.create({
      data: {
        actorId: user.id,
        action: "organization.class_assignment.results_viewed",
        resourceType: "OrganizationClassAssignment",
        resourceId: assignmentId,
        requestId: requestId ?? null,
        metadata: { targetCount: result.summary.totalStudents },
      },
    });
    return result;
  }

  async exportResultsCsv(user: CurrentUser, assignmentId: string, requestId?: string) {
    const result = await this.getResults(user, assignmentId, requestId);
    const header = ["학생", "상태", "완료 항목", "전체 항목", "마감 초과", "완료 시각", "지도자 코멘트"];
    const rows = result.students.map((student) => [
      student.student.displayName,
      student.status,
      String(student.completedItems),
      String(student.totalItems),
      student.isLate ? "예" : "아니오",
      student.completedAt?.toISOString() ?? "",
      student.teacherComment ?? "",
    ]);
    const content = `\ufeff${[header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
    await this.prisma.auditLog.create({
      data: {
        actorId: user.id,
        action: "organization.class_assignment.results_exported",
        resourceType: "OrganizationClassAssignment",
        resourceId: assignmentId,
        requestId: requestId ?? null,
        metadata: { rowCount: rows.length },
      },
    });
    return { filename: `class-assignment-${assignmentId}.csv`, content };
  }

  async comment(user: CurrentUser, assignmentId: string, studentId: string, body: unknown, requestId?: string) {
    const assignment = await this.requireTeacherAssignment(user, assignmentId);
    if (!UUID_PATTERN.test(studentId)) this.notFound();
    const data = readInputObject(body, ["comment"], "CLASS_ASSIGNMENT_COMMENT_INVALID", "지도자 코멘트를 확인해 주세요.");
    const comment = optionalString(data, "comment", { maxLength: 1000 }, "CLASS_ASSIGNMENT_COMMENT_INVALID", "지도자 코멘트를 확인해 주세요.");
    const target = assignment.targets.find((item) => item.studentId === studentId);
    if (!target) this.notFound();
    const now = new Date();
    const updated = await this.prisma.$transaction(async (transaction) => {
      const saved = await transaction.organizationClassAssignmentTarget.update({
        where: { id: target.id },
        data: {
          teacherComment: comment,
          commentVersion: { increment: 1 },
          commentedByUserId: comment ? user.id : null,
          commentedAt: comment ? now : null,
        },
      });
      if (comment) {
        await transaction.userNotification.create({
          data: {
            userId: studentId,
            kind: UserNotificationKind.ASSIGNMENT_COMMENTED,
            resourceType: "OrganizationClassAssignment",
            resourceId: assignmentId,
            resourceVersion: saved.commentVersion,
            title: "과제 코멘트가 등록되었어요",
            message: assignment.title,
          },
        });
      }
      await transaction.auditLog.create({
        data: {
          actorId: user.id,
          action: comment ? "organization.class_assignment.comment_updated" : "organization.class_assignment.comment_cleared",
          resourceType: "OrganizationClassAssignmentTarget",
          resourceId: target.id,
          requestId: requestId ?? null,
          metadata: { assignmentId, studentId },
        },
      });
      return saved;
    });
    return { target: { studentId, teacherComment: updated.teacherComment, commentedAt: updated.commentedAt } };
  }

  async reassign(user: CurrentUser, assignmentId: string, body: unknown, requestId?: string) {
    const source = await this.requireTeacherAssignment(user, assignmentId);
    if (source.status === ClassAssignmentStatus.DRAFT) this.assignmentLocked();
    const data = readInputObject(body, ["studentIds", "dueAt", "title"], "CLASS_ASSIGNMENT_REASSIGN_INVALID", "재과제 대상과 마감일을 확인해 주세요.");
    const studentIds = this.readStudentIds(data.studentIds, false);
    const dueAt = this.readDueAt(data.dueAt, new Date());
    const title = data.title === undefined
      ? `${source.title} 재과제`
      : requiredString(data, "title", { maxLength: 120 }, "CLASS_ASSIGNMENT_REASSIGN_INVALID", "재과제 제목을 확인해 주세요.");
    const allowedTargets = new Set(source.targets.map((target) => target.studentId));
    if (studentIds.some((studentId) => !allowedTargets.has(studentId))) this.invalid("원래 과제 대상 학생만 재과제할 수 있습니다.");
    const now = new Date();
    await this.resolveTargets(source.organizationClassId, studentIds, now);
    const created = await this.prisma.$transaction(async (transaction) => {
      const assignment = await transaction.organizationClassAssignment.create({
        data: {
          organizationClassId: source.organizationClassId,
          createdByUserId: user.id,
          reassignedFromId: source.id,
          title,
          description: source.description,
          dueAt,
          status: ClassAssignmentStatus.PUBLISHED,
          publishedAt: now,
          items: { create: source.items.map((item, index) => ({
            type: item.type,
            lessonId: item.lessonId,
            missionId: item.missionId,
            order: index + 1,
          })) },
          targets: { create: studentIds.map((studentId) => ({ studentId })) },
        },
        include: this.assignmentInclude(),
      });
      await transaction.userNotification.createMany({
        data: studentIds.map((studentId) => ({
          userId: studentId,
          kind: UserNotificationKind.ASSIGNMENT_PUBLISHED,
          resourceType: "OrganizationClassAssignment",
          resourceId: assignment.id,
          resourceVersion: assignment.revision,
          title: "재과제가 도착했어요",
          message: `${assignment.title} · ${this.formatKoreanDate(dueAt)}까지`,
        })),
        skipDuplicates: true,
      });
      await transaction.auditLog.create({
        data: {
          actorId: user.id,
          action: "organization.class_assignment.reassigned",
          resourceType: "OrganizationClassAssignment",
          resourceId: assignment.id,
          requestId: requestId ?? null,
          metadata: { sourceAssignmentId: source.id, targetCount: studentIds.length },
        },
      });
      return assignment;
    });
    return { assignment: this.assignmentDetailView(created) };
  }

  async sendDueSoonReminders(now = new Date()) {
    const until = new Date(now.getTime() + 24 * 60 * 60_000);
    const assignments = await this.prisma.organizationClassAssignment.findMany({
      where: { status: ClassAssignmentStatus.PUBLISHED, dueAt: { gt: now, lte: until } },
      include: this.assignmentInclude(),
      take: 200,
      orderBy: { dueAt: "asc" },
    });
    const evaluated = await this.evaluate(assignments, now);
    let created = 0;
    for (const assignment of evaluated) {
      const incompleteTargets = assignment.evaluatedTargets.filter((target) => target.status !== "completed");
      const result = await this.prisma.userNotification.createMany({
        data: incompleteTargets.map((target) => ({
          userId: target.studentId,
          kind: UserNotificationKind.ASSIGNMENT_DUE_SOON,
          resourceType: "OrganizationClassAssignment",
          resourceId: assignment.id,
          resourceVersion: assignment.revision,
          title: "과제 마감이 얼마 남지 않았어요",
          message: `${assignment.title} · ${this.formatKoreanDate(assignment.dueAt)}까지`,
        })),
        skipDuplicates: true,
      });
      created += result.count;
    }
    return { scanned: assignments.length, created };
  }

  async runReminderWorker(signal?: AbortSignal): Promise<void> {
    while (!signal?.aborted) {
      try {
        await this.sendDueSoonReminders();
        await wait(15 * 60_000, signal);
      } catch (error) {
        this.logger.error(error instanceof Error ? error.name : "ASSIGNMENT_REMINDER_FAILED");
        if (!signal?.aborted) await wait(60_000, signal);
      }
    }
  }

  async getStudentSummary(studentId: string) {
    const assignments = await this.prisma.organizationClassAssignment.findMany({
      where: { status: ClassAssignmentStatus.PUBLISHED, targets: { some: { studentId } } },
      include: this.assignmentInclude(),
      orderBy: { dueAt: "asc" },
    });
    const evaluated = await this.evaluate(assignments, new Date());
    const items = evaluated.map((item) => this.studentAssignmentView(item, studentId));
    return {
      total: items.length,
      completed: items.filter((item) => item.progress.status === "completed").length,
      overdue: items.filter((item) => item.progress.isLate && item.progress.status !== "completed").length,
      items,
    };
  }

  private readAssignmentInput(body: unknown, now: Date): AssignmentInput {
    const data = readInputObject(
      body,
      ["title", "description", "dueAt", "items", "targetStudentIds"],
      "CLASS_ASSIGNMENT_INVALID",
      "과제 정보를 확인해 주세요.",
    );
    const title = requiredString(data, "title", { maxLength: 120 }, "CLASS_ASSIGNMENT_INVALID", "과제 제목을 확인해 주세요.");
    const description = optionalString(data, "description", { maxLength: 1000 }, "CLASS_ASSIGNMENT_INVALID", "과제 설명을 확인해 주세요.");
    const dueAt = this.readDueAt(data.dueAt, now);
    if (!Array.isArray(data.items) || data.items.length < 1 || data.items.length > 20) this.invalid("과제 항목을 1개 이상 20개 이하로 선택해 주세요.");
    const items = data.items.map((raw): AssignmentItemInput => {
      const item = readInputObject(raw, ["type", "resourceId"], "CLASS_ASSIGNMENT_INVALID", "과제 항목을 확인해 주세요.");
      if (item.type !== "lesson" && item.type !== "baduk_mission") this.invalid("과제 항목 종류를 확인해 주세요.");
      if (typeof item.resourceId !== "string" || !RESOURCE_ID_PATTERN.test(item.resourceId)) this.invalid("과제 항목을 확인해 주세요.");
      return { type: item.type, resourceId: item.resourceId };
    });
    const uniqueItems = new Set(items.map((item) => `${item.type}:${item.resourceId}`));
    if (uniqueItems.size !== items.length) this.invalid("같은 강의나 미션을 중복해서 지정할 수 없습니다.");
    const targetStudentIds = data.targetStudentIds === undefined
      ? null
      : this.readStudentIds(data.targetStudentIds, true);
    return { title, description, dueAt, items, targetStudentIds };
  }

  private readDueAt(value: unknown, now: Date): Date {
    if (typeof value !== "string" || value.length > 50) this.invalid("과제 마감일을 확인해 주세요.");
    const dueAt = new Date(value);
    if (!Number.isFinite(dueAt.getTime()) || dueAt <= now || dueAt.getTime() - now.getTime() > MAX_DUE_WINDOW_MS) {
      this.invalid("과제 마감일은 현재부터 366일 이내여야 합니다.");
    }
    return dueAt;
  }

  private readStudentIds(value: unknown, allowEmpty: boolean): string[] {
    if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || value.length > 200) this.invalid("과제 대상 학생을 확인해 주세요.");
    const ids = value.filter((item): item is string => typeof item === "string");
    if (ids.length !== value.length || ids.some((id) => !UUID_PATTERN.test(id))) this.invalid("과제 대상 학생을 확인해 주세요.");
    return [...new Set(ids)];
  }

  private async resolveTargets(classId: string, requested: string[] | null, now: Date): Promise<string[]> {
    const active = await this.activeClassStudents(classId, now);
    const activeIds = new Set(active.map((student) => student.id));
    const selected = requested === null || requested.length === 0 ? [...activeIds] : requested;
    if (selected.length === 0) this.invalid("과제를 받을 재학 학생이 없습니다.");
    if (selected.some((studentId) => !activeIds.has(studentId))) this.invalid("현재 재학 중인 학생만 과제 대상으로 지정할 수 있습니다.");
    return selected;
  }

  private async activeClassStudents(classId: string, now: Date) {
    const enrollments = await this.prisma.organizationClassEnrollment.findMany({
      where: {
        organizationClassId: classId,
        startsAt: { lte: now },
        OR: [{ endsAt: null }, { endsAt: { gt: now } }],
        student: { status: AccountStatus.ACTIVE, deletedAt: null },
      },
      select: { student: { select: { id: true, displayName: true } }, startsAt: true },
      orderBy: [{ student: { displayName: "asc" } }, { studentId: "asc" }],
    });
    return enrollments.map((enrollment) => ({ ...enrollment.student, enrolledAt: enrollment.startsAt }));
  }

  private async validateResources(items: AssignmentItemInput[]) {
    const lessonIds = items.filter((item) => item.type === "lesson").map((item) => item.resourceId);
    const missionIds = items.filter((item) => item.type === "baduk_mission").map((item) => item.resourceId);
    const [lessons, missions] = await Promise.all([
      this.prisma.lesson.findMany({ where: { id: { in: lessonIds }, status: LessonStatus.PUBLISHED }, select: { id: true } }),
      this.prisma.badukMission.findMany({ where: { id: { in: missionIds }, status: BadukMissionStatus.PUBLISHED }, select: { id: true } }),
    ]);
    if (lessons.length !== lessonIds.length || missions.length !== missionIds.length) {
      this.invalid("공개된 강의와 바둑미션만 과제로 지정할 수 있습니다.");
    }
  }

  private itemCreateData(items: AssignmentItemInput[]) {
    return items.map((item, index) => ({
      type: item.type === "lesson" ? ClassAssignmentItemType.LESSON : ClassAssignmentItemType.BADUK_MISSION,
      lessonId: item.type === "lesson" ? item.resourceId : null,
      missionId: item.type === "baduk_mission" ? item.resourceId : null,
      order: index + 1,
    }));
  }

  private assignmentInclude() {
    return {
      organizationClass: { include: { organization: { select: { id: true, name: true } } } },
      items: {
        include: {
          lesson: { include: { era: { select: { id: true, name: true, order: true } } } },
          mission: { include: { era: { select: { id: true, name: true, order: true } } } },
        },
        orderBy: { order: "asc" as const },
      },
      targets: { include: { student: { select: { id: true, displayName: true } } }, orderBy: { student: { displayName: "asc" as const } } },
      _count: { select: { reassignedAssignments: true } },
    };
  }

  private async requireTeacherAssignment(user: CurrentUser, assignmentId: string) {
    if (!UUID_PATTERN.test(assignmentId)) this.notFound();
    const assignment = await this.prisma.organizationClassAssignment.findUnique({
      where: { id: assignmentId }, include: this.assignmentInclude(),
    });
    if (!assignment) this.notFound();
    await this.access.requireCurrentClassAssignment(user.id, assignment.organizationClassId, new Date());
    return assignment;
  }

  private async evaluate<T extends Awaited<ReturnType<ClassAssignmentService["requireTeacherAssignment"]>>>(assignments: T[], now: Date) {
    const studentIds = [...new Set(assignments.flatMap((assignment) => assignment.targets.map((target) => target.studentId)))];
    const lessonIds = [...new Set(assignments.flatMap((assignment) => assignment.items.flatMap((item) => item.lessonId ? [item.lessonId] : [])))];
    const missionIds = [...new Set(assignments.flatMap((assignment) => assignment.items.flatMap((item) => item.missionId ? [item.missionId] : [])))];
    const [lessonProgress, attempts] = await Promise.all([
      this.prisma.lessonProgress.findMany({
        where: { userId: { in: studentIds }, lessonId: { in: lessonIds } },
        select: { userId: true, lessonId: true, status: true, startedAt: true, completedAt: true, updatedAt: true },
      }),
      this.prisma.missionAttempt.findMany({
        where: { userId: { in: studentIds }, missionId: { in: missionIds } },
        select: { userId: true, missionId: true, status: true, startedAt: true, completedAt: true, lastPlayedAt: true, score: true, wrongMoveCount: true, hintUseCount: true },
        orderBy: [{ completedAt: "desc" }, { lastPlayedAt: "desc" }],
      }),
    ]);
    const progressByKey = new Map(lessonProgress.map((progress) => [`${progress.userId}:${progress.lessonId}`, progress]));
    const attemptsByKey = new Map<string, typeof attempts>();
    for (const attempt of attempts) {
      if (!attempt.userId) continue;
      const key = `${attempt.userId}:${attempt.missionId}`;
      const values = attemptsByKey.get(key) ?? [];
      values.push(attempt);
      attemptsByKey.set(key, values);
    }
    return assignments.map((assignment) => ({
      ...assignment,
      evaluatedTargets: assignment.targets.map((target) => {
        const itemResults = assignment.items.map((item) => {
          if (item.lessonId) {
            const progress = progressByKey.get(`${target.studentId}:${item.lessonId}`);
            const status = progress?.status === LessonProgressStatus.COMPLETED ? "completed" as const
              : progress ? "in_progress" as const : "not_started" as const;
            return { itemId: item.id, status, completedAt: progress?.completedAt ?? null, score: null, wrongMoveCount: null, hintUseCount: null };
          }
          const values = attemptsByKey.get(`${target.studentId}:${item.missionId}`) ?? [];
          const completed = values.find((attempt) => attempt.status === MissionAttemptStatus.COMPLETED);
          const chosen = completed ?? values[0];
          const status = completed ? "completed" as const : chosen ? "in_progress" as const : "not_started" as const;
          return {
            itemId: item.id,
            status,
            completedAt: completed?.completedAt ?? null,
            score: chosen?.score ?? null,
            wrongMoveCount: chosen?.wrongMoveCount ?? null,
            hintUseCount: chosen?.hintUseCount ?? null,
          };
        });
        const completedItems = itemResults.filter((item) => item.status === "completed").length;
        const startedItems = itemResults.filter((item) => item.status !== "not_started").length;
        const status = completedItems === itemResults.length ? "completed" as const
          : startedItems > 0 ? "in_progress" as const : "not_started" as const;
        const completedAt = status === "completed"
          ? new Date(Math.max(...itemResults.map((item) => item.completedAt?.getTime() ?? 0)))
          : null;
        return {
          ...target,
          itemResults,
          completedItems,
          status,
          completedAt,
          isLate: completedAt ? completedAt > assignment.dueAt : now > assignment.dueAt,
        };
      }),
    }));
  }

  private studentAssignmentView<T extends { evaluatedTargets: Array<{ studentId: string; status: string; completedItems: number; completedAt: Date | null; isLate: boolean; itemResults: Array<{ itemId: string; status: string; score: number | null; wrongMoveCount: number | null; hintUseCount: number | null }>; teacherComment: string | null; commentedAt: Date | null }>; items: Array<{ id: string; type: ClassAssignmentItemType; lessonId: string | null; missionId: string | null; lesson: { id: string; title: string; course: string; era: { id: string; name: string; order: number } } | null; mission: { id: string; title: string; boardSize: number; difficulty: number; era: { id: string; name: string; order: number } | null } | null }>; id: string; title: string; description: string | null; dueAt: Date; status: ClassAssignmentStatus; publishedAt: Date | null; organizationClass: { id: string; name: string; academicYear: number; organization: { id: string; name: string } }; reassignedFromId: string | null }>(assignment: T, studentId: string) {
    const target = assignment.evaluatedTargets.find((item) => item.studentId === studentId)!;
    return {
      id: assignment.id,
      title: assignment.title,
      description: assignment.description,
      dueAt: assignment.dueAt,
      status: assignment.status.toLowerCase(),
      publishedAt: assignment.publishedAt,
      reassignedFromId: assignment.reassignedFromId,
      class: assignment.organizationClass,
      progress: {
        status: target.status,
        completedItems: target.completedItems,
        totalItems: assignment.items.length,
        completedAt: target.completedAt,
        isLate: target.isLate,
      },
      teacherComment: target.teacherComment,
      commentedAt: target.commentedAt,
      items: assignment.items.map((item) => {
        const result = target.itemResults.find((entry) => entry.itemId === item.id)!;
        return { ...this.assignmentItemView(item), progress: result };
      }),
    };
  }

  private resultsView<T extends { evaluatedTargets: Array<{ student: { id: string; displayName: string }; status: "completed" | "in_progress" | "not_started"; completedItems: number; completedAt: Date | null; isLate: boolean; itemResults: Array<{ itemId: string; status: string; score: number | null; wrongMoveCount: number | null; hintUseCount: number | null }>; teacherComment: string | null; commentedAt: Date | null }>; items: Array<{ id: string; type: ClassAssignmentItemType; lessonId: string | null; missionId: string | null; lesson: { id: string; title: string; course: string; era: { id: string; name: string; order: number } } | null; mission: { id: string; title: string; boardSize: number; difficulty: number; era: { id: string; name: string; order: number } | null } | null }>; id: string; title: string; description: string | null; dueAt: Date; status: ClassAssignmentStatus; organizationClass: { id: string; name: string; academicYear: number; organization: { id: string; name: string } } }>(assignment: T) {
    const completed = assignment.evaluatedTargets.filter((target) => target.status === "completed").length;
    return {
      assignment: {
        id: assignment.id,
        title: assignment.title,
        description: assignment.description,
        dueAt: assignment.dueAt,
        status: assignment.status.toLowerCase(),
        class: assignment.organizationClass,
      },
      summary: {
        totalStudents: assignment.evaluatedTargets.length,
        completedStudents: completed,
        inProgressStudents: assignment.evaluatedTargets.filter((target) => target.status === "in_progress").length,
        notStartedStudents: assignment.evaluatedTargets.filter((target) => target.status === "not_started").length,
        overdueStudents: assignment.evaluatedTargets.filter((target) => target.isLate && target.status !== "completed").length,
        lateCompletedStudents: assignment.evaluatedTargets.filter((target) => target.isLate && target.status === "completed").length,
        completionRate: assignment.evaluatedTargets.length ? Math.round((completed / assignment.evaluatedTargets.length) * 100) : 0,
      },
      itemStatistics: assignment.items.map((item) => {
        const completedCount = assignment.evaluatedTargets.filter((target) => target.itemResults.find((result) => result.itemId === item.id)?.status === "completed").length;
        return {
          ...this.assignmentItemView(item),
          completedCount,
          totalStudents: assignment.evaluatedTargets.length,
          completionRate: assignment.evaluatedTargets.length ? Math.round((completedCount / assignment.evaluatedTargets.length) * 100) : 0,
          correctnessRate: item.type === ClassAssignmentItemType.BADUK_MISSION && assignment.evaluatedTargets.length
            ? Math.round((completedCount / assignment.evaluatedTargets.length) * 100) : null,
        };
      }),
      students: assignment.evaluatedTargets.map((target) => ({
        student: target.student,
        status: target.status,
        completedItems: target.completedItems,
        totalItems: assignment.items.length,
        completedAt: target.completedAt,
        isLate: target.isLate,
        teacherComment: target.teacherComment,
        commentedAt: target.commentedAt,
        items: target.itemResults,
      })),
    };
  }

  private assignmentSummaryView(assignment: { id: string; title: string; description: string | null; dueAt: Date; status: ClassAssignmentStatus; revision: number; publishedAt: Date | null; canceledAt: Date | null; createdAt: Date; reassignedFromId: string | null; _count: { items: number; targets: number; reassignedAssignments: number } }) {
    return {
      id: assignment.id, title: assignment.title, description: assignment.description,
      dueAt: assignment.dueAt, status: assignment.status.toLowerCase(), revision: assignment.revision,
      publishedAt: assignment.publishedAt, canceledAt: assignment.canceledAt, createdAt: assignment.createdAt,
      reassignedFromId: assignment.reassignedFromId,
      itemCount: assignment._count.items, targetCount: assignment._count.targets,
      reassignmentCount: assignment._count.reassignedAssignments,
    };
  }

  private assignmentDetailView(assignment: Awaited<ReturnType<ClassAssignmentService["requireTeacherAssignment"]>>) {
    return {
      ...this.assignmentSummaryView({ ...assignment, _count: { ...assignment._count, items: assignment.items.length, targets: assignment.targets.length } }),
      class: assignment.organizationClass,
      items: assignment.items.map((item) => this.assignmentItemView(item)),
      targets: assignment.targets.map((target) => ({
        student: target.student,
        assignedAt: target.assignedAt,
        teacherComment: target.teacherComment,
        commentedAt: target.commentedAt,
      })),
    };
  }

  private assignmentItemView(item: { id: string; type: ClassAssignmentItemType; lessonId: string | null; missionId: string | null; lesson: { id: string; title: string; course: string; era: { id: string; name: string; order: number } } | null; mission: { id: string; title: string; boardSize: number; difficulty: number; era: { id: string; name: string; order: number } | null } | null }) {
    return {
      id: item.id,
      type: item.type.toLowerCase(),
      resource: item.lesson ? {
        id: item.lesson.id, title: item.lesson.title, course: item.lesson.course, era: item.lesson.era,
      } : item.mission ? {
        id: item.mission.id, title: item.mission.title, boardSize: item.mission.boardSize,
        difficulty: item.mission.difficulty, era: item.mission.era,
      } : null,
    };
  }

  private formatKoreanDate(value: Date): string {
    return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "medium", timeStyle: "short" }).format(value);
  }

  private invalid(message: string): never {
    throw new ApiError("CLASS_ASSIGNMENT_INVALID", message, HttpStatus.BAD_REQUEST);
  }

  private assignmentLocked(): never {
    throw new ApiError("CLASS_ASSIGNMENT_LOCKED", "초안 상태의 과제만 수정하거나 배포할 수 있습니다.", HttpStatus.CONFLICT);
  }

  private notFound(): never {
    throw new ApiError("CLASS_ASSIGNMENT_NOT_FOUND", "과제를 찾을 수 없습니다.", HttpStatus.NOT_FOUND);
  }
}

function csvCell(value: string): string {
  const safeValue = /^[\s]*[=+\-@]/u.test(value) ? `'${value}` : value;
  return `"${safeValue.replaceAll('"', '""')}"`;
}

function wait(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}
