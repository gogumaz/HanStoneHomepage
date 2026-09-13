import { apiRequest } from '../../lib/api-client';

export type DashboardLessonProgress = {
  lesson: {
    id: string;
    era: { id: string; name: string; order: number };
    order: number;
    course: string;
    title: string;
    durationMinutes: number;
    isFreeSample: boolean;
    accessible: boolean;
  };
  progress: {
    status: 'not_started' | 'in_progress' | 'completed';
    completedSteps: number;
    totalSteps: number;
    lastPositionSeconds: number;
    startedAt: string | null;
    completedAt: string | null;
    lastActivityAt: string | null;
  };
};

export type StudentDashboard = {
  student: { id: string; displayName: string };
  generatedAt: string;
  access: { hasActiveSubscription: boolean; subscriptionEndsAt: string | null };
  summary: {
    totalLessons: number;
    startedLessons: number;
    completedLessons: number;
    completionRate: number;
    completedSteps: number;
    totalSteps: number;
    stepCompletionRate: number;
    lastActivityAt: string | null;
    weekly: {
      periodStart: string;
      periodEnd: string;
      studyDays: number;
      firstAttemptCorrectMissions: number;
      firstAttemptMissions: number;
      firstAttemptAccuracy: number;
    };
  };
  classGoals: Array<{
    class: {
      id: string;
      name: string;
      academicYear: number;
      organization: { id: string; name: string };
    };
    currentLesson: {
      id: string;
      order: number;
      course: string;
      title: string;
      durationMinutes: number;
      era: { id: string; name: string; order: number };
      accessible: boolean;
    };
    updatedAt: string;
  }>;
  assignments: {
    total: number;
    completed: number;
    overdue: number;
    items: Array<{
      id: string;
      title: string;
      description: string | null;
      dueAt: string;
      status: 'published';
      publishedAt: string | null;
      reassignedFromId: string | null;
      class: { id: string; name: string; academicYear: number; organization: { id: string; name: string } };
      progress: { status: 'not_started' | 'in_progress' | 'completed'; completedItems: number; totalItems: number; completedAt: string | null; isLate: boolean };
      teacherComment: string | null;
      commentedAt: string | null;
      items: Array<{
        id: string;
        type: 'lesson' | 'baduk_mission';
        resource: { id: string; title: string; course?: string; boardSize?: number; era: { id: string; name: string; order: number } | null };
        progress: { status: 'not_started' | 'in_progress' | 'completed'; completedAt: string | null; score: number | null; wrongMoveCount: number | null; hintUseCount: number | null };
      }>;
    }>;
  };
  eras: Array<{
    id: string;
    order: number;
    name: string;
    theme: string;
    description: string;
    totalLessons: number;
    startedLessons: number;
    completedLessons: number;
    completionRate: number;
    status: 'coming_soon' | 'not_started' | 'in_progress' | 'completed';
  }>;
  recentLessons: DashboardLessonProgress[];
  nextLesson: (DashboardLessonProgress & { reason: 'continue' | 'next' }) | null;
};

export function getStudentDashboard() {
  return apiRequest<StudentDashboard>('/me/dashboard');
}
