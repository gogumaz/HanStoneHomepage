import { apiDownload, apiRequest } from '../../lib/api-client';

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

export type ClassProgressLesson = {
  id: string;
  order: number;
  course: string;
  title: string;
  durationMinutes: number;
  era: { id: string; name: string; order: number };
};

export type TeacherClassProgressSetting = {
  progressSetting: {
    class: {
      id: string;
      name: string;
      academicYear: number;
      organization: { id: string; name: string };
    };
    currentLesson: (ClassProgressLesson & { updatedAt: string }) | null;
    availableLessons: ClassProgressLesson[];
  };
};

export type TeacherClassProgressSettingUpdate = {
  progressSetting: {
    class: TeacherClassProgressSetting['progressSetting']['class'];
    currentLesson: (ClassProgressLesson & { updatedAt: string }) | null;
  };
};

export type ClassAssignmentResource = {
  id: string;
  title: string;
  course?: string;
  boardSize?: number;
  difficulty?: number;
  era: { id: string; name: string; order: number } | null;
};

export type ClassAssignmentItem = {
  id: string;
  type: 'lesson' | 'baduk_mission';
  resource: ClassAssignmentResource;
};

export type ClassAssignmentSummary = {
  id: string;
  title: string;
  description: string | null;
  dueAt: string;
  status: 'draft' | 'published' | 'canceled';
  revision: number;
  publishedAt: string | null;
  canceledAt: string | null;
  createdAt: string;
  reassignedFromId: string | null;
  itemCount: number;
  targetCount: number;
  reassignmentCount: number;
};

export type ClassAssignmentOptions = {
  class: TeacherClassStudents['class'];
  lessons: Array<{ id: string; title: string; course: string; order: number; era: { id: string; name: string; order: number } }>;
  missions: Array<{ id: string; title: string; boardSize: number; difficulty: number; era: { id: string; name: string; order: number } | null }>;
  students: TeacherClassStudents['items'];
};

export type ClassAssignmentDetail = ClassAssignmentSummary & {
  class: TeacherClassProgressSetting['progressSetting']['class'];
  items: ClassAssignmentItem[];
  targets: Array<{
    student: { id: string; displayName: string };
    assignedAt: string;
    teacherComment: string | null;
    commentedAt: string | null;
  }>;
};

export type ClassAssignmentResults = {
  assignment: {
    id: string;
    title: string;
    description: string | null;
    dueAt: string;
    status: 'draft' | 'published' | 'canceled';
    class: TeacherClassProgressSetting['progressSetting']['class'];
  };
  summary: {
    totalStudents: number;
    completedStudents: number;
    inProgressStudents: number;
    notStartedStudents: number;
    overdueStudents: number;
    lateCompletedStudents: number;
    completionRate: number;
  };
  itemStatistics: Array<ClassAssignmentItem & {
    completedCount: number;
    totalStudents: number;
    completionRate: number;
    correctnessRate: number | null;
  }>;
  students: Array<{
    student: { id: string; displayName: string };
    status: 'not_started' | 'in_progress' | 'completed';
    completedItems: number;
    totalItems: number;
    completedAt: string | null;
    isLate: boolean;
    teacherComment: string | null;
    commentedAt: string | null;
  }>;
};

export type ManagedOrganizationClass = {
  id: string;
  organizationId: string;
  name: string;
  academicYear: number;
  status: 'active' | 'archived';
  createdAt: string;
  updatedAt: string;
  teachers: Array<{
    assignmentId: string;
    membershipId: string;
    instructor: { id: string; displayName: string };
    startsAt: string;
    endsAt: string | null;
    active: boolean;
  }>;
  students: Array<{
    enrollmentId: string;
    student: { id: string; displayName: string };
    startsAt: string;
    endsAt: string | null;
    active: boolean;
  }>;
};

export type OrganizationInstructor = {
  membershipId: string;
  user: { id: string; displayName: string };
  startsAt: string;
  endsAt: string | null;
};

export type OrganizationManagement = {
  organization: { id: string; name: string; seatLimit: number | null; usedSeats: number };
  members: Array<{
    membershipId: string;
    role: 'instructor' | 'admin';
    status: 'active' | 'suspended' | 'ended';
    startsAt: string;
    endsAt: string | null;
    user: { id: string; email: string; displayName: string };
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

export function createTeacherClassInviteCode(classId: string): Promise<ClassInviteCodeResult> {
  return apiRequest(`/teacher/classes/${encodeURIComponent(classId)}/invite-codes`, { method: 'POST' });
}

export function claimClassInviteCode(code: string): Promise<ClassEnrollmentResult> {
  return apiRequest('/me/class-invite-codes/claim', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
}

export function getTeacherClassProgressSetting(classId: string): Promise<TeacherClassProgressSetting> {
  return apiRequest(`/teacher/classes/${encodeURIComponent(classId)}/progress-setting`);
}

export function updateTeacherClassProgressSetting(
  classId: string,
  lessonId: string | null,
): Promise<TeacherClassProgressSettingUpdate> {
  return apiRequest(`/teacher/classes/${encodeURIComponent(classId)}/progress-setting`, {
    method: 'PUT',
    body: JSON.stringify({ lessonId }),
  });
}

export function getClassAssignmentOptions(classId: string) {
  return apiRequest<ClassAssignmentOptions>(`/teacher/classes/${encodeURIComponent(classId)}/assignment-options`);
}

export function listClassAssignments(classId: string) {
  return apiRequest<{ items: ClassAssignmentSummary[] }>(`/teacher/classes/${encodeURIComponent(classId)}/assignments`);
}

export function createClassAssignment(classId: string, input: {
  title: string;
  description: string;
  dueAt: string;
  items: Array<{ type: 'lesson' | 'baduk_mission'; resourceId: string }>;
  targetStudentIds: string[];
}) {
  return apiRequest<{ assignment: ClassAssignmentDetail }>(`/teacher/classes/${encodeURIComponent(classId)}/assignments`, {
    method: 'POST', body: JSON.stringify(input),
  });
}

export function getTeacherClassAssignment(assignmentId: string) {
  return apiRequest<{ assignment: ClassAssignmentDetail }>(`/teacher/assignments/${encodeURIComponent(assignmentId)}`);
}

export function updateClassAssignment(assignmentId: string, input: {
  title: string;
  description: string;
  dueAt: string;
  items: Array<{ type: 'lesson' | 'baduk_mission'; resourceId: string }>;
  targetStudentIds: string[];
}) {
  return apiRequest<{ assignment: ClassAssignmentDetail }>(`/teacher/assignments/${encodeURIComponent(assignmentId)}`, {
    method: 'PUT', body: JSON.stringify(input),
  });
}

export function publishClassAssignment(assignmentId: string) {
  return apiRequest<{ assignment: ClassAssignmentDetail }>(`/teacher/assignments/${encodeURIComponent(assignmentId)}/publish`, { method: 'POST' });
}

export function cancelClassAssignment(assignmentId: string) {
  return apiRequest<{ assignment: ClassAssignmentDetail }>(`/teacher/assignments/${encodeURIComponent(assignmentId)}/cancel`, { method: 'POST' });
}

export function getClassAssignmentResults(assignmentId: string) {
  return apiRequest<ClassAssignmentResults>(`/teacher/assignments/${encodeURIComponent(assignmentId)}/results`);
}

export function updateClassAssignmentComment(assignmentId: string, studentId: string, comment: string) {
  return apiRequest(`/teacher/assignments/${encodeURIComponent(assignmentId)}/students/${encodeURIComponent(studentId)}/comment`, {
    method: 'PATCH', body: JSON.stringify({ comment }),
  });
}

export function reassignClassAssignment(assignmentId: string, studentIds: string[], dueAt: string) {
  return apiRequest<{ assignment: ClassAssignmentDetail }>(`/teacher/assignments/${encodeURIComponent(assignmentId)}/reassign`, {
    method: 'POST', body: JSON.stringify({ studentIds, dueAt }),
  });
}

export function downloadClassAssignmentResults(assignmentId: string) {
  return apiDownload(`/teacher/assignments/${encodeURIComponent(assignmentId)}/results.csv`);
}

export function listManagedOrganizationClasses(organizationId: string) {
  return apiRequest<{ items: ManagedOrganizationClass[] }>(`/organization-admin/organizations/${encodeURIComponent(organizationId)}/classes`);
}

export function listOrganizationInstructors(organizationId: string) {
  return apiRequest<{ items: OrganizationInstructor[] }>(`/organization-admin/organizations/${encodeURIComponent(organizationId)}/instructors`);
}

export function getOrganizationManagement(organizationId: string) {
  return apiRequest<OrganizationManagement>(`/organization-admin/organizations/${encodeURIComponent(organizationId)}/management`);
}

export function updateOrganizationSeatLimit(organizationId: string, seatLimit: number | null) {
  return apiRequest<{ organization: OrganizationManagement['organization'] }>(`/organization-admin/organizations/${encodeURIComponent(organizationId)}`, {
    method: 'PATCH', body: JSON.stringify({ seatLimit }),
  });
}

export function addOrganizationMember(organizationId: string, email: string, role: 'instructor' | 'admin') {
  return apiRequest(`/organization-admin/organizations/${encodeURIComponent(organizationId)}/members`, {
    method: 'POST', body: JSON.stringify({ email, role }),
  });
}

export function updateOrganizationMember(
  organizationId: string,
  membershipId: string,
  input: { role?: 'instructor' | 'admin'; status?: 'active' | 'suspended' | 'ended' },
) {
  return apiRequest(`/organization-admin/organizations/${encodeURIComponent(organizationId)}/members/${encodeURIComponent(membershipId)}`, {
    method: 'PATCH', body: JSON.stringify(input),
  });
}

export function createManagedClass(organizationId: string, name: string, academicYear: number) {
  return apiRequest<{ class: ManagedOrganizationClass }>(`/organization-admin/organizations/${encodeURIComponent(organizationId)}/classes`, {
    method: 'POST', body: JSON.stringify({ name, academicYear }),
  });
}

export function updateManagedClass(classId: string, input: { name?: string; academicYear?: number; status?: 'active' | 'archived' }) {
  return apiRequest<{ class: ManagedOrganizationClass }>(`/organization-admin/classes/${encodeURIComponent(classId)}`, {
    method: 'PATCH', body: JSON.stringify(input),
  });
}

export function assignClassInstructor(classId: string, membershipId: string) {
  return apiRequest(`/organization-admin/classes/${encodeURIComponent(classId)}/instructors/${encodeURIComponent(membershipId)}`, {
    method: 'PUT', body: JSON.stringify({}),
  });
}

export function unassignClassInstructor(classId: string, membershipId: string) {
  return apiRequest(`/organization-admin/classes/${encodeURIComponent(classId)}/instructors/${encodeURIComponent(membershipId)}`, { method: 'DELETE' });
}

export function enrollClassStudent(classId: string, email: string) {
  return apiRequest(`/organization-admin/classes/${encodeURIComponent(classId)}/students`, {
    method: 'POST', body: JSON.stringify({ email }),
  });
}

export function unenrollClassStudent(classId: string, studentId: string) {
  return apiRequest(`/organization-admin/classes/${encodeURIComponent(classId)}/students/${encodeURIComponent(studentId)}`, { method: 'DELETE' });
}
