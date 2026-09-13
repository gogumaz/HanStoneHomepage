import { apiRequest } from '../../lib/api-client';

export type OrganizationAdminContext = {
  items: Array<{
    membershipId: string;
    organization: { id: string; name: string };
    membership: { startsAt: string; endsAt: string | null };
    permissions: {
      license: readonly ['read', 'manage'];
      seats: readonly ['read', 'manage'];
      refunds: readonly ['read', 'request'];
    };
  }>;
  paymentExecutionRoles: readonly ['operator', 'admin'];
};

export type TeacherClass = {
  id: string;
  name: string;
  academicYear: number;
  organization: { id: string; name: string };
  assignment: { startsAt: string; endsAt: string | null };
};

export type TeacherClasses = {
  items: TeacherClass[];
};

export type TeacherClassStudents = {
  class: {
    id: string;
    organizationId: string;
    name: string;
    academicYear: number;
  };
  items: Array<{
    id: string;
    displayName: string;
    enrolledAt: string;
  }>;
};

export type ClassInviteCodeResult = {
  inviteCode: {
    code: string;
    expiresAt: string;
    class: {
      id: string;
      name: string;
      academicYear: number;
      organization: { id: string; name: string };
    };
  };
};

export type ClassEnrollmentResult = {
  enrollment: {
    id: string;
    enrolledAt: string;
    class: {
      id: string;
      name: string;
      academicYear: number;
      organization: { id: string; name: string };
    };
  };
};

export function getOrganizationAdminContext(): Promise<OrganizationAdminContext> {
  return apiRequest('/organization-admin/organizations');
}

export function listTeacherClasses(): Promise<TeacherClasses> {
  return apiRequest('/teacher/classes');
}

export function listTeacherClassStudents(classId: string): Promise<TeacherClassStudents> {
  return apiRequest(`/teacher/classes/${encodeURIComponent(classId)}/students`);
}

export function createTeacherClassInviteCode(classId: string): Promise<ClassInviteCodeResult> {
  return apiRequest(`/teacher/classes/${encodeURIComponent(classId)}/invite-codes`, { method: 'POST' });
}

export function claimClassInviteCode(code: string): Promise<ClassEnrollmentResult> {
  return apiRequest('/me/class-invite-codes/claim', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
}
