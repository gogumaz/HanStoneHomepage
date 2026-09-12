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

export function getOrganizationAdminContext(): Promise<OrganizationAdminContext> {
  return apiRequest('/organization-admin/organizations');
}

export function listTeacherClasses(): Promise<TeacherClasses> {
  return apiRequest('/teacher/classes');
}

export function listTeacherClassStudents(classId: string): Promise<TeacherClassStudents> {
  return apiRequest(`/teacher/classes/${encodeURIComponent(classId)}/students`);
}
