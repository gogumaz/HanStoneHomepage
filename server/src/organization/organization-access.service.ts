import { HttpStatus, Injectable } from "@nestjs/common";
import type { CurrentUser } from "../auth/auth.types.js";
import { ApiError } from "../common/api-error.js";
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
export class OrganizationAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async listAdminOrganizations(user: CurrentUser) {
    const now = new Date();
    const memberships = await this.prisma.organizationMembership.findMany({
      where: {
        userId: user.id,
        role: OrganizationMembershipRole.ADMIN,
        status: OrganizationMembershipStatus.ACTIVE,
        startsAt: { lte: now },
        OR: [{ endsAt: null }, { endsAt: { gt: now } }],
      },
      select: {
        id: true,
        startsAt: true,
        endsAt: true,
        organization: { select: { id: true, name: true } },
      },
    });
    if (memberships.length === 0) {
      throw new ApiError(
        "ORGANIZATION_ADMIN_MEMBERSHIP_REQUIRED",
        "활성 기관 관리자 멤버십이 필요합니다.",
        HttpStatus.FORBIDDEN,
      );
    }

    return {
      items: memberships
        .map((membership) => ({
          membershipId: membership.id,
          organization: membership.organization,
          membership: { startsAt: membership.startsAt, endsAt: membership.endsAt },
          permissions: {
            license: ["read", "manage"] as const,
            seats: ["read", "manage"] as const,
            refunds: ["read", "request"] as const,
          },
        }))
        .sort((left, right) => (
          left.organization.name.localeCompare(right.organization.name, "ko")
          || left.organization.id.localeCompare(right.organization.id)
        )),
      paymentExecutionRoles: ["operator", "admin"] as const,
    };
  }

  async listAssignedClasses(user: CurrentUser) {
    const now = new Date();
    await this.requireVerifiedInstructor(user.id);

    const memberships = await this.prisma.organizationMembership.findMany({
      where: {
        userId: user.id,
        role: OrganizationMembershipRole.INSTRUCTOR,
        status: OrganizationMembershipStatus.ACTIVE,
        startsAt: { lte: now },
        OR: [{ endsAt: null }, { endsAt: { gt: now } }],
      },
      select: { id: true, organizationId: true },
    });
    if (memberships.length === 0) {
      throw new ApiError(
        "ORGANIZATION_MEMBERSHIP_REQUIRED",
        "활성 기관 멤버십이 있는 지도자만 담당 반을 조회할 수 있습니다.",
        HttpStatus.FORBIDDEN,
      );
    }

    const membershipIds = memberships.map((membership) => membership.id);
    const organizationByMembership = new Map(
      memberships.map((membership) => [membership.id, membership.organizationId]),
    );
    const assignments = await this.prisma.organizationClassTeacherAssignment.findMany({
      where: {
        teacherMembershipId: { in: membershipIds },
        startsAt: { lte: now },
        OR: [{ endsAt: null }, { endsAt: { gt: now } }],
        organizationClass: { status: OrganizationClassStatus.ACTIVE },
      },
      select: {
        startsAt: true,
        endsAt: true,
        teacherMembershipId: true,
        organizationClass: {
          select: {
            id: true,
            organizationId: true,
            name: true,
            academicYear: true,
            organization: { select: { id: true, name: true } },
          },
        },
      },
    });

    const items = assignments
      .filter((assignment) => (
        organizationByMembership.get(assignment.teacherMembershipId)
        === assignment.organizationClass.organizationId
      ))
      .map((assignment) => ({
        id: assignment.organizationClass.id,
        name: assignment.organizationClass.name,
        academicYear: assignment.organizationClass.academicYear,
        organization: assignment.organizationClass.organization,
        assignment: { startsAt: assignment.startsAt, endsAt: assignment.endsAt },
      }))
      .sort((left, right) => (
        right.academicYear - left.academicYear
        || left.organization.name.localeCompare(right.organization.name, "ko")
        || left.name.localeCompare(right.name, "ko")
      ));

    return { items };
  }

  async listAssignedClassStudents(user: CurrentUser, classId: string, requestId?: string) {
    if (!UUID_PATTERN.test(classId)) {
      throw this.classStudentsForbidden();
    }

    const now = new Date();
    await this.requireVerifiedInstructor(user.id);
    const assignments = await this.prisma.organizationClassTeacherAssignment.findMany({
      where: {
        organizationClassId: classId,
        startsAt: { lte: now },
        OR: [{ endsAt: null }, { endsAt: { gt: now } }],
        organizationClass: { status: OrganizationClassStatus.ACTIVE },
        teacherMembership: {
          userId: user.id,
          role: OrganizationMembershipRole.INSTRUCTOR,
          status: OrganizationMembershipStatus.ACTIVE,
          startsAt: { lte: now },
          OR: [{ endsAt: null }, { endsAt: { gt: now } }],
        },
      },
      select: {
        id: true,
        organizationClass: {
          select: { id: true, organizationId: true, name: true, academicYear: true },
        },
        teacherMembership: { select: { organizationId: true } },
      },
    });
    const assignment = assignments.find((item) => (
      item.organizationClass.organizationId === item.teacherMembership.organizationId
    ));
    if (!assignment) {
      throw this.classStudentsForbidden();
    }

    const enrollments = await this.prisma.organizationClassEnrollment.findMany({
      where: {
        organizationClassId: classId,
        startsAt: { lte: now },
        OR: [{ endsAt: null }, { endsAt: { gt: now } }],
        student: { status: AccountStatus.ACTIVE, deletedAt: null },
      },
      select: {
        startsAt: true,
        student: { select: { id: true, displayName: true } },
      },
    });
    const items = enrollments
      .map((enrollment) => ({ ...enrollment.student, enrolledAt: enrollment.startsAt }))
      .sort((left, right) => (
        left.displayName.localeCompare(right.displayName, "ko") || left.id.localeCompare(right.id)
      ));

    await this.prisma.auditLog.create({
      data: {
        actorId: user.id,
        action: "organization.class_students.viewed",
        resourceType: "OrganizationClass",
        resourceId: classId,
        requestId: requestId ?? null,
        metadata: { assignmentId: assignment.id, studentCount: items.length },
      },
    });

    return {
      class: assignment.organizationClass,
      items,
    };
  }

  private async requireVerifiedInstructor(userId: string): Promise<void> {
    const role = await this.prisma.userRoleAssignment.findUnique({
      where: { userId_role: { userId, role: RoleType.INSTRUCTOR } },
      select: { verificationStatus: true },
    });
    if (role?.verificationStatus !== RoleVerificationStatus.VERIFIED) {
      throw new ApiError(
        "INSTRUCTOR_VERIFICATION_REQUIRED",
        "인증이 완료된 지도자만 기관 반에 접근할 수 있습니다.",
        HttpStatus.FORBIDDEN,
      );
    }
  }

  private classStudentsForbidden(): ApiError {
    return new ApiError(
      "CLASS_STUDENTS_FORBIDDEN",
      "담당 반의 학생만 조회할 수 있습니다.",
      HttpStatus.FORBIDDEN,
    );
  }
}
