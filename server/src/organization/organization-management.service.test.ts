import { describe, expect, it, vi } from "vitest";
import type { CurrentUser } from "../auth/auth.types.js";
import { PrismaService } from "../database/prisma.service.js";
import { OrganizationClassStatus, OrganizationMembershipRole, OrganizationMembershipStatus } from "../generated/prisma/enums.js";
import { OrganizationManagementService } from "./organization-management.service.js";

const organizationId = "10000000-0000-4000-8000-000000000001";
const classId = "20000000-0000-4000-8000-000000000001";
const user = { id: "30000000-0000-4000-8000-000000000001", displayName: "기관장", roles: ["organization_admin"] } as CurrentUser;

function setup() {
  const now = new Date();
  const organizationClass = { id: classId, organizationId, name: "햇살반", academicYear: 2026, status: OrganizationClassStatus.ACTIVE, createdAt: now, updatedAt: now };
  const audit = vi.fn(async () => ({ id: "audit" }));
  const teacherUpdateMany = vi.fn(async () => ({ count: 1 }));
  const enrollmentUpdateMany = vi.fn(async () => ({ count: 2 }));
  const transaction = {
    organizationClass: { create: vi.fn(async () => organizationClass), update: vi.fn(async ({ data }: { data: { status?: OrganizationClassStatus } }) => ({ ...organizationClass, status: data.status ?? organizationClass.status })) },
    organizationClassTeacherAssignment: { updateMany: teacherUpdateMany },
    organizationClassEnrollment: { updateMany: enrollmentUpdateMany },
    organizationSeat: { deleteMany: vi.fn(async () => ({ count: 0 })), findUnique: vi.fn(async () => null), count: vi.fn(async () => 0), create: vi.fn(async () => ({ id: "seat-1" })) },
    organization: { update: vi.fn(async ({ data }: { data: { seatLimit: number | null } }) => ({ id: organizationId, name: "한빛초", seatLimit: data.seatLimit })) },
    auditLog: { create: audit },
  };
  const prisma = {
    organizationMembership: { findFirst: vi.fn(async () => ({ id: "membership-admin", userId: user.id, organizationId, role: OrganizationMembershipRole.ADMIN, status: OrganizationMembershipStatus.ACTIVE })) },
    organizationClass: { findFirst: vi.fn(async () => null), findUnique: vi.fn(async () => organizationClass) },
    organizationSeat: { count: vi.fn(async () => 0) },
    $transaction: vi.fn(async (callback: (client: typeof transaction) => unknown) => callback(transaction)),
  } as unknown as PrismaService;
  return { service: new OrganizationManagementService(prisma), audit, teacherUpdateMany, enrollmentUpdateMany };
}

describe("OrganizationManagementService", () => {
  it("creates a class only inside the administrator membership organization", async () => {
    const { service, audit } = setup();
    const result = await service.createClass(user, organizationId, { name: "햇살반", academicYear: 2026 }, "request-1");
    expect(result.class).toMatchObject({ id: classId, name: "햇살반", academicYear: 2026 });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "organization.class.created" }) }));
  });

  it("ends active teacher assignments and enrollments when a class is archived", async () => {
    const { service, teacherUpdateMany, enrollmentUpdateMany } = setup();
    const result = await service.updateClass(user, classId, { status: "archived" });
    expect(result.class.status).toBe(OrganizationClassStatus.ARCHIVED);
    expect(teacherUpdateMany).toHaveBeenCalledOnce();
    expect(enrollmentUpdateMany).toHaveBeenCalledOnce();
  });

  it("stores an organization seat limit through the administrator boundary", async () => {
    const { service, audit } = setup();
    const result = await service.updateOrganization(user, organizationId, { seatLimit: 30 }, "request-seat");
    expect(result.organization).toMatchObject({ seatLimit: 30, usedSeats: 0 });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "organization.settings.updated" }) }));
  });

  it("rejects a new student when all unique organization seats are occupied", async () => {
    const { service } = setup();
    const prisma = (service as unknown as { prisma: Record<string, unknown> }).prisma as {
      user: { findFirst?: ReturnType<typeof vi.fn> };
      $transaction: ReturnType<typeof vi.fn>;
    };
    prisma.user = { findFirst: vi.fn(async () => ({ id: "40000000-0000-4000-8000-000000000001", displayName: "학생" })) };
    prisma.$transaction.mockImplementationOnce(async (callback: (client: unknown) => unknown) => callback({
      organizationSeat: { findUnique: vi.fn(async () => null), count: vi.fn(async () => 5), create: vi.fn() },
      organization: { findUnique: vi.fn(async () => ({ seatLimit: 5 })) },
    }));

    await expect(service.enrollStudent(user, classId, { email: "student@example.test" }))
      .rejects.toMatchObject({ code: "ORGANIZATION_SEAT_LIMIT_REACHED" });
  });
});
