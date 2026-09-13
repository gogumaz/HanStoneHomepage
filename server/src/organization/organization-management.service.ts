import { HttpStatus, Injectable } from "@nestjs/common";
import type { CurrentUser } from "../auth/auth.types.js";
import { ApiError } from "../common/api-error.js";
import { isEmailAddress } from "../common/email-address.js";
import { readInputObject, requiredInteger, requiredString } from "../common/input-validation.js";
import { PrismaService } from "../database/prisma.service.js";
import {
  AccountStatus,
  OrganizationClassStatus,
  OrganizationMembershipRole,
  OrganizationMembershipStatus,
  RoleType,
  RoleVerificationStatus,
} from "../generated/prisma/enums.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

@Injectable()
export class OrganizationManagementService {
  constructor(private readonly prisma: PrismaService) {}

  async listClasses(user: CurrentUser, organizationId: string) {
    await this.requireAdminMembership(user.id, organizationId, new Date());
    const classes = await this.prisma.organizationClass.findMany({
      where: { organizationId },
      include: {
        teacherAssignments: {
          include: { teacherMembership: { include: { user: { select: { id: true, displayName: true } } } } },
          orderBy: { startsAt: "desc" },
        },
        enrollments: {
          include: { student: { select: { id: true, displayName: true } } },
          orderBy: { startsAt: "desc" },
        },
      },
      orderBy: [{ academicYear: "desc" }, { name: "asc" }],
    });
    const now = new Date();
    return { items: classes.map((item) => this.classView(item, now)) };
  }

  async listInstructors(user: CurrentUser, organizationId: string) {
    await this.requireAdminMembership(user.id, organizationId, new Date());
    const now = new Date();
    const memberships = await this.prisma.organizationMembership.findMany({
      where: {
        organizationId,
        role: OrganizationMembershipRole.INSTRUCTOR,
        status: OrganizationMembershipStatus.ACTIVE,
        startsAt: { lte: now },
        OR: [{ endsAt: null }, { endsAt: { gt: now } }],
        user: {
          status: AccountStatus.ACTIVE,
          deletedAt: null,
          roles: { some: { role: RoleType.INSTRUCTOR, verificationStatus: RoleVerificationStatus.VERIFIED } },
        },
      },
      include: { user: { select: { id: true, displayName: true } } },
      orderBy: [{ user: { displayName: "asc" } }, { id: "asc" }],
    });
    return { items: memberships.map((item) => ({
      membershipId: item.id,
      user: item.user,
      startsAt: item.startsAt,
      endsAt: item.endsAt,
    })) };
  }

  async getOrganizationManagement(user: CurrentUser, organizationId: string) {
    await this.requireAdminMembership(user.id, organizationId, new Date());
    const [organization, usedSeats, memberships] = await Promise.all([
      this.prisma.organization.findUnique({
        where: { id: organizationId },
        select: { id: true, name: true, seatLimit: true },
      }),
      this.prisma.organizationSeat.count({ where: { organizationId } }),
      this.prisma.organizationMembership.findMany({
        where: { organizationId },
        include: { user: { select: { id: true, email: true, displayName: true } } },
        orderBy: [{ role: "asc" }, { user: { displayName: "asc" } }, { id: "asc" }],
      }),
    ]);
    if (!organization) this.notFound();
    return {
      organization: { ...organization, usedSeats },
      members: memberships.map((membership) => ({
        membershipId: membership.id,
        role: membership.role.toLowerCase(),
        status: membership.status.toLowerCase(),
        startsAt: membership.startsAt,
        endsAt: membership.endsAt,
        user: membership.user,
      })),
    };
  }

  async updateOrganization(user: CurrentUser, organizationId: string, body: unknown, requestId?: string) {
    await this.requireAdminMembership(user.id, organizationId, new Date());
    const data = readInputObject(body, ["seatLimit"], "ORGANIZATION_SETTINGS_INVALID", "기관 설정을 확인해 주세요.");
    if (!("seatLimit" in data)) this.invalid("변경할 좌석 한도를 입력해 주세요.");
    const seatLimit = data.seatLimit === null
      ? null
      : requiredInteger(data, "seatLimit", 1, 100_000, "ORGANIZATION_SETTINGS_INVALID", "좌석 한도는 1~100000 사이여야 합니다.");
    const usedSeats = await this.prisma.organizationSeat.count({ where: { organizationId } });
    if (seatLimit !== null && seatLimit < usedSeats) {
      this.conflict(`좌석 한도는 현재 사용 중인 ${usedSeats}석보다 작게 설정할 수 없습니다.`);
    }
    const organization = await this.prisma.$transaction(async (transaction) => {
      const saved = await transaction.organization.update({
        where: { id: organizationId },
        data: { seatLimit },
        select: { id: true, name: true, seatLimit: true },
      });
      await transaction.auditLog.create({
        data: {
          actorId: user.id,
          action: "organization.settings.updated",
          resourceType: "Organization",
          resourceId: organizationId,
          requestId: requestId ?? null,
          metadata: { seatLimit, usedSeats },
        },
      });
      return saved;
    });
    return { organization: { ...organization, usedSeats } };
  }

  async addMember(user: CurrentUser, organizationId: string, body: unknown, requestId?: string) {
    await this.requireAdminMembership(user.id, organizationId, new Date());
    const data = readInputObject(body, ["email", "role"], "ORGANIZATION_MEMBER_INVALID", "구성원 정보를 확인해 주세요.");
    const email = typeof data.email === "string" ? data.email.trim().toLowerCase() : "";
    const role = this.membershipRole(data.role);
    if (!isEmailAddress(email)) this.invalid("구성원 이메일을 확인해 주세요.");
    const accountRole = role === OrganizationMembershipRole.ADMIN ? RoleType.ORGANIZATION_ADMIN : RoleType.INSTRUCTOR;
    const member = await this.prisma.user.findFirst({
      where: {
        email,
        status: AccountStatus.ACTIVE,
        deletedAt: null,
        roles: { some: {
          role: accountRole,
          ...(role === OrganizationMembershipRole.INSTRUCTOR
            ? { verificationStatus: RoleVerificationStatus.VERIFIED }
            : {}),
        } },
      },
      select: { id: true, email: true, displayName: true },
    });
    if (!member) this.notFound();
    const now = new Date();
    const membership = await this.prisma.$transaction(async (transaction) => {
      const saved = await transaction.organizationMembership.upsert({
        where: { organizationId_userId: { organizationId, userId: member.id } },
        create: { organizationId, userId: member.id, role, status: OrganizationMembershipStatus.ACTIVE, startsAt: now },
        update: { role, status: OrganizationMembershipStatus.ACTIVE, startsAt: now, endsAt: null },
      });
      await transaction.auditLog.create({
        data: {
          actorId: user.id,
          action: "organization.member.added",
          resourceType: "OrganizationMembership",
          resourceId: saved.id,
          requestId: requestId ?? null,
          metadata: { organizationId, memberUserId: member.id, role: role.toLowerCase() },
        },
      });
      return saved;
    });
    return { membership: { ...membership, role: membership.role.toLowerCase(), status: membership.status.toLowerCase(), user: member } };
  }

  async updateMember(user: CurrentUser, organizationId: string, membershipId: string, body: unknown, requestId?: string) {
    const admin = await this.requireAdminMembership(user.id, organizationId, new Date());
    if (!UUID_PATTERN.test(membershipId)) this.notFound();
    const existing = await this.prisma.organizationMembership.findFirst({ where: { id: membershipId, organizationId } });
    if (!existing) this.notFound();
    const data = readInputObject(body, ["role", "status"], "ORGANIZATION_MEMBER_INVALID", "구성원 정보를 확인해 주세요.");
    if (Object.keys(data).length === 0) this.invalid("변경할 구성원 정보를 입력해 주세요.");
    const role = data.role === undefined ? existing.role : this.membershipRole(data.role);
    const status = data.status === undefined ? existing.status : this.membershipStatus(data.status);
    if (existing.id === admin.id && (role !== OrganizationMembershipRole.ADMIN || status !== OrganizationMembershipStatus.ACTIVE)) {
      this.conflict("현재 로그인한 기관 관리자 멤버십은 비활성화하거나 역할을 변경할 수 없습니다.");
    }
    if (status === OrganizationMembershipStatus.ACTIVE) {
      const requiredAccountRole = role === OrganizationMembershipRole.ADMIN ? RoleType.ORGANIZATION_ADMIN : RoleType.INSTRUCTOR;
      const accountRole = await this.prisma.userRoleAssignment.findUnique({
        where: { userId_role: { userId: existing.userId, role: requiredAccountRole } },
        select: { verificationStatus: true },
      });
      if (!accountRole || (role === OrganizationMembershipRole.INSTRUCTOR
        && accountRole.verificationStatus !== RoleVerificationStatus.VERIFIED)) this.notFound();
    }
    const now = new Date();
    const membership = await this.prisma.$transaction(async (transaction) => {
      const saved = await transaction.organizationMembership.update({
        where: { id: membershipId },
        data: {
          role,
          status,
          ...(status === OrganizationMembershipStatus.ACTIVE ? { startsAt: now, endsAt: null } : { endsAt: now }),
        },
      });
      if (role !== OrganizationMembershipRole.INSTRUCTOR || status !== OrganizationMembershipStatus.ACTIVE) {
        await transaction.organizationClassTeacherAssignment.updateMany({
          where: { teacherMembershipId: membershipId, OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
          data: { endsAt: now },
        });
      }
      await transaction.auditLog.create({
        data: {
          actorId: user.id,
          action: "organization.member.updated",
          resourceType: "OrganizationMembership",
          resourceId: membershipId,
          requestId: requestId ?? null,
          metadata: { organizationId, role: role.toLowerCase(), status: status.toLowerCase() },
        },
      });
      return saved;
    });
    return { membership: { ...membership, role: membership.role.toLowerCase(), status: membership.status.toLowerCase() } };
  }

  async createClass(user: CurrentUser, organizationId: string, body: unknown, requestId?: string) {
    await this.requireAdminMembership(user.id, organizationId, new Date());
    const input = this.classInput(body, false);
    const duplicate = await this.prisma.organizationClass.findFirst({
      where: { organizationId, academicYear: input.academicYear!, name: input.name! },
      select: { id: true },
    });
    if (duplicate) this.conflict("같은 학년도에 동일한 이름의 학급이 이미 있습니다.");
    const created = await this.prisma.$transaction(async (transaction) => {
      const item = await transaction.organizationClass.create({
        data: { organizationId, name: input.name!, academicYear: input.academicYear! },
      });
      await transaction.auditLog.create({
        data: {
          actorId: user.id,
          action: "organization.class.created",
          resourceType: "OrganizationClass",
          resourceId: item.id,
          requestId: requestId ?? null,
          metadata: { organizationId, academicYear: item.academicYear },
        },
      });
      return item;
    });
    return { class: { ...created, teachers: [], students: [] } };
  }

  async updateClass(user: CurrentUser, classId: string, body: unknown, requestId?: string) {
    const existing = await this.requireManagedClass(user.id, classId, new Date());
    const input = this.classInput(body, true);
    const nextName = input.name ?? existing.name;
    const nextYear = input.academicYear ?? existing.academicYear;
    if (nextName !== existing.name || nextYear !== existing.academicYear) {
      const duplicate = await this.prisma.organizationClass.findFirst({
        where: { organizationId: existing.organizationId, academicYear: nextYear, name: nextName, NOT: { id: classId } },
        select: { id: true },
      });
      if (duplicate) this.conflict("같은 학년도에 동일한 이름의 학급이 이미 있습니다.");
    }
    const now = new Date();
    const updated = await this.prisma.$transaction(async (transaction) => {
      const item = await transaction.organizationClass.update({
        where: { id: classId },
        data: {
          ...(input.name ? { name: input.name } : {}),
          ...(input.academicYear ? { academicYear: input.academicYear } : {}),
          ...(input.status ? { status: input.status } : {}),
        },
      });
      if (input.status === OrganizationClassStatus.ARCHIVED) {
        await transaction.organizationClassTeacherAssignment.updateMany({
          where: { organizationClassId: classId, OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
          data: { endsAt: now },
        });
        await transaction.organizationClassEnrollment.updateMany({
          where: { organizationClassId: classId, OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
          data: { endsAt: now },
        });
        await transaction.organizationSeat.deleteMany({
          where: {
            organizationId: existing.organizationId,
            student: {
              organizationClassEnrollments: {
                none: {
                  startsAt: { lte: now },
                  OR: [{ endsAt: null }, { endsAt: { gt: now } }],
                  organizationClass: { organizationId: existing.organizationId },
                },
              },
            },
          },
        });
      }
      await transaction.auditLog.create({
        data: {
          actorId: user.id,
          action: "organization.class.updated",
          resourceType: "OrganizationClass",
          resourceId: classId,
          requestId: requestId ?? null,
          metadata: { status: item.status.toLowerCase() },
        },
      });
      return item;
    });
    return { class: updated };
  }

  async assignInstructor(user: CurrentUser, classId: string, membershipId: string, body: unknown, requestId?: string) {
    const organizationClass = await this.requireManagedClass(user.id, classId, new Date());
    if (organizationClass.status !== OrganizationClassStatus.ACTIVE) this.conflict("활성 학급에만 지도자를 배정할 수 있습니다.");
    if (!UUID_PATTERN.test(membershipId)) this.notFound();
    const data = readInputObject(body, ["startsAt", "endsAt"], "ORGANIZATION_ASSIGNMENT_INVALID", "지도자 배정 기간을 확인해 주세요.");
    const now = new Date();
    const startsAt = data.startsAt === undefined ? now : this.date(data.startsAt, "지도자 배정 시작일을 확인해 주세요.");
    const endsAt = data.endsAt === undefined || data.endsAt === null || data.endsAt === "" ? null : this.date(data.endsAt, "지도자 배정 종료일을 확인해 주세요.");
    if (endsAt && endsAt <= startsAt) this.invalid("지도자 배정 종료일은 시작일 이후여야 합니다.");
    const membership = await this.prisma.organizationMembership.findFirst({
      where: {
        id: membershipId,
        organizationId: organizationClass.organizationId,
        role: OrganizationMembershipRole.INSTRUCTOR,
        status: OrganizationMembershipStatus.ACTIVE,
        startsAt: { lte: now },
        OR: [{ endsAt: null }, { endsAt: { gt: now } }],
        user: {
          status: AccountStatus.ACTIVE,
          deletedAt: null,
          roles: { some: { role: RoleType.INSTRUCTOR, verificationStatus: RoleVerificationStatus.VERIFIED } },
        },
      },
      include: { user: { select: { id: true, displayName: true } } },
    });
    if (!membership) this.notFound();
    const saved = await this.prisma.$transaction(async (transaction) => {
      const item = await transaction.organizationClassTeacherAssignment.upsert({
        where: { organizationClassId_teacherMembershipId: { organizationClassId: classId, teacherMembershipId: membershipId } },
        create: { organizationClassId: classId, teacherMembershipId: membershipId, startsAt, endsAt },
        update: { startsAt, endsAt },
      });
      await transaction.auditLog.create({
        data: {
          actorId: user.id,
          action: "organization.class.instructor_assigned",
          resourceType: "OrganizationClassTeacherAssignment",
          resourceId: item.id,
          requestId: requestId ?? null,
          metadata: { organizationClassId: classId, teacherMembershipId: membershipId },
        },
      });
      return item;
    });
    return { assignment: { ...saved, instructor: membership.user } };
  }

  async endInstructorAssignment(user: CurrentUser, classId: string, membershipId: string, requestId?: string) {
    await this.requireManagedClass(user.id, classId, new Date());
    if (!UUID_PATTERN.test(membershipId)) this.notFound();
    const existing = await this.prisma.organizationClassTeacherAssignment.findUnique({
      where: { organizationClassId_teacherMembershipId: { organizationClassId: classId, teacherMembershipId: membershipId } },
    });
    if (!existing) this.notFound();
    const now = new Date();
    const ended = await this.prisma.$transaction(async (transaction) => {
      const item = await transaction.organizationClassTeacherAssignment.update({ where: { id: existing.id }, data: { endsAt: now } });
      await transaction.auditLog.create({
        data: {
          actorId: user.id,
          action: "organization.class.instructor_unassigned",
          resourceType: "OrganizationClassTeacherAssignment",
          resourceId: item.id,
          requestId: requestId ?? null,
          metadata: { organizationClassId: classId, teacherMembershipId: membershipId },
        },
      });
      return item;
    });
    return { assignment: ended };
  }

  async enrollStudent(user: CurrentUser, classId: string, body: unknown, requestId?: string) {
    const organizationClass = await this.requireManagedClass(user.id, classId, new Date());
    if (organizationClass.status !== OrganizationClassStatus.ACTIVE) this.conflict("활성 학급에만 학생을 등록할 수 있습니다.");
    const data = readInputObject(body, ["email"], "ORGANIZATION_ENROLLMENT_INVALID", "학생 이메일을 확인해 주세요.");
    const email = typeof data.email === "string" ? data.email.trim().toLowerCase() : "";
    if (!isEmailAddress(email)) this.invalid("학생 이메일을 확인해 주세요.");
    const student = await this.prisma.user.findFirst({
      where: {
        email,
        status: AccountStatus.ACTIVE,
        deletedAt: null,
        roles: { some: { role: RoleType.STUDENT } },
      },
      select: { id: true, displayName: true },
    });
    if (!student) this.notFound();
    const now = new Date();
    const enrollment = await this.prisma.$transaction(async (transaction) => {
      const existingSeat = await transaction.organizationSeat.findUnique({
        where: { organizationId_studentId: { organizationId: organizationClass.organizationId, studentId: student.id } },
      });
      if (!existingSeat) {
        const [organization, usedSeats] = await Promise.all([
          transaction.organization.findUnique({ where: { id: organizationClass.organizationId }, select: { seatLimit: true } }),
          transaction.organizationSeat.count({ where: { organizationId: organizationClass.organizationId } }),
        ]);
        if (organization?.seatLimit !== null && organization?.seatLimit !== undefined && usedSeats >= organization.seatLimit) {
          this.seatLimitReached();
        }
        await transaction.organizationSeat.create({ data: { organizationId: organizationClass.organizationId, studentId: student.id } });
      }
      const item = await transaction.organizationClassEnrollment.upsert({
        where: { organizationClassId_studentId: { organizationClassId: classId, studentId: student.id } },
        create: { organizationClassId: classId, studentId: student.id, startsAt: now },
        update: { startsAt: now, endsAt: null },
      });
      await transaction.auditLog.create({
        data: {
          actorId: user.id,
          action: "organization.class.student_enrolled",
          resourceType: "OrganizationClassEnrollment",
          resourceId: item.id,
          requestId: requestId ?? null,
          metadata: { organizationClassId: classId, studentId: student.id },
        },
      });
      return item;
    }, { isolationLevel: "Serializable" });
    return { enrollment: { ...enrollment, student } };
  }

  async endStudentEnrollment(user: CurrentUser, classId: string, studentId: string, requestId?: string) {
    const organizationClass = await this.requireManagedClass(user.id, classId, new Date());
    if (!UUID_PATTERN.test(studentId)) this.notFound();
    const existing = await this.prisma.organizationClassEnrollment.findUnique({
      where: { organizationClassId_studentId: { organizationClassId: classId, studentId } },
    });
    if (!existing) this.notFound();
    const now = new Date();
    const enrollment = await this.prisma.$transaction(async (transaction) => {
      const item = await transaction.organizationClassEnrollment.update({ where: { id: existing.id }, data: { endsAt: now } });
      const otherActiveEnrollments = await transaction.organizationClassEnrollment.count({
        where: {
          studentId,
          organizationClass: { organizationId: organizationClass.organizationId },
          startsAt: { lte: now },
          OR: [{ endsAt: null }, { endsAt: { gt: now } }],
        },
      });
      if (otherActiveEnrollments === 0) {
        await transaction.organizationSeat.deleteMany({ where: { organizationId: organizationClass.organizationId, studentId } });
      }
      await transaction.auditLog.create({
        data: {
          actorId: user.id,
          action: "organization.class.student_unenrolled",
          resourceType: "OrganizationClassEnrollment",
          resourceId: item.id,
          requestId: requestId ?? null,
          metadata: { organizationClassId: classId, studentId },
        },
      });
      return item;
    });
    return { enrollment };
  }

  private async requireAdminMembership(userId: string, organizationId: string, now: Date) {
    if (!UUID_PATTERN.test(organizationId)) this.forbidden();
    const membership = await this.prisma.organizationMembership.findFirst({
      where: {
        userId,
        organizationId,
        role: OrganizationMembershipRole.ADMIN,
        status: OrganizationMembershipStatus.ACTIVE,
        startsAt: { lte: now },
        OR: [{ endsAt: null }, { endsAt: { gt: now } }],
      },
    });
    if (!membership) this.forbidden();
    return membership;
  }

  private async requireManagedClass(userId: string, classId: string, now: Date) {
    if (!UUID_PATTERN.test(classId)) this.forbidden();
    const organizationClass = await this.prisma.organizationClass.findUnique({ where: { id: classId } });
    if (!organizationClass) this.forbidden();
    await this.requireAdminMembership(userId, organizationClass.organizationId, now);
    return organizationClass;
  }

  private classInput(body: unknown, partial: boolean) {
    const data = readInputObject(body, ["name", "academicYear", "status"], "ORGANIZATION_CLASS_INVALID", "학급 정보를 확인해 주세요.");
    if (partial && Object.keys(data).length === 0) this.invalid("변경할 학급 정보를 입력해 주세요.");
    const name = data.name === undefined ? null : requiredString(data, "name", { maxLength: 100 }, "ORGANIZATION_CLASS_INVALID", "학급 이름을 확인해 주세요.");
    const academicYear = data.academicYear === undefined ? null : requiredInteger(data, "academicYear", 2000, 2200, "ORGANIZATION_CLASS_INVALID", "학년도를 확인해 주세요.");
    let status: OrganizationClassStatus | null = null;
    if (data.status !== undefined) {
      if (data.status !== "active" && data.status !== "archived") this.invalid("학급 상태를 확인해 주세요.");
      status = data.status === "active" ? OrganizationClassStatus.ACTIVE : OrganizationClassStatus.ARCHIVED;
    }
    if (!partial && (!name || !academicYear || status)) this.invalid("학급 이름과 학년도를 확인해 주세요.");
    return { name, academicYear, status };
  }

  private classView(item: {
    id: string; organizationId: string; name: string; academicYear: number; status: OrganizationClassStatus;
    createdAt: Date; updatedAt: Date;
    teacherAssignments: Array<{ id: string; teacherMembershipId: string; startsAt: Date; endsAt: Date | null; teacherMembership: { user: { id: string; displayName: string } } }>;
    enrollments: Array<{ id: string; studentId: string; startsAt: Date; endsAt: Date | null; student: { id: string; displayName: string } }>;
  }, now: Date) {
    return {
      id: item.id,
      organizationId: item.organizationId,
      name: item.name,
      academicYear: item.academicYear,
      status: item.status.toLowerCase(),
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      teachers: item.teacherAssignments.map((assignment) => ({
        assignmentId: assignment.id,
        membershipId: assignment.teacherMembershipId,
        instructor: assignment.teacherMembership.user,
        startsAt: assignment.startsAt,
        endsAt: assignment.endsAt,
        active: assignment.startsAt <= now && (!assignment.endsAt || assignment.endsAt > now),
      })),
      students: item.enrollments.map((enrollment) => ({
        enrollmentId: enrollment.id,
        student: enrollment.student,
        startsAt: enrollment.startsAt,
        endsAt: enrollment.endsAt,
        active: enrollment.startsAt <= now && (!enrollment.endsAt || enrollment.endsAt > now),
      })),
    };
  }

  private date(value: unknown, message: string): Date {
    if (typeof value !== "string" || value.length > 50) this.invalid(message);
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.getTime())) this.invalid(message);
    return parsed;
  }

  private membershipRole(value: unknown): OrganizationMembershipRole {
    if (value === "instructor") return OrganizationMembershipRole.INSTRUCTOR;
    if (value === "admin") return OrganizationMembershipRole.ADMIN;
    return this.invalid("구성원 역할을 확인해 주세요.");
  }

  private membershipStatus(value: unknown): OrganizationMembershipStatus {
    if (value === "active") return OrganizationMembershipStatus.ACTIVE;
    if (value === "suspended") return OrganizationMembershipStatus.SUSPENDED;
    if (value === "ended") return OrganizationMembershipStatus.ENDED;
    return this.invalid("구성원 상태를 확인해 주세요.");
  }

  private seatLimitReached(): never {
    throw new ApiError("ORGANIZATION_SEAT_LIMIT_REACHED", "기관의 학생 좌석 한도에 도달했습니다.", HttpStatus.CONFLICT);
  }

  private invalid(message: string): never {
    throw new ApiError("ORGANIZATION_MANAGEMENT_INVALID", message, HttpStatus.BAD_REQUEST);
  }

  private conflict(message: string): never {
    throw new ApiError("ORGANIZATION_MANAGEMENT_CONFLICT", message, HttpStatus.CONFLICT);
  }

  private forbidden(): never {
    throw new ApiError("ORGANIZATION_MANAGEMENT_FORBIDDEN", "이 기관을 관리할 권한이 없습니다.", HttpStatus.FORBIDDEN);
  }

  private notFound(): never {
    throw new ApiError("ORGANIZATION_MANAGEMENT_NOT_FOUND", "관리 대상을 찾을 수 없습니다.", HttpStatus.NOT_FOUND);
  }
}
