export type EraView = {
  id: string;
  order: number;
  name: string;
  theme: string;
  description: string;
  status: "available" | "coming_soon";
  completedLessons: number;
  totalLessons: number;
};

export type LessonView = {
  id: string;
  era: { id: string; name: string };
  order: number;
  level: string;
  course: string;
  title: string;
  summary: string;
  instructor: string;
  difficulty: string;
  durationMinutes: number;
  isFreeSample: boolean;
  hasThumbnail: boolean;
  access: "free_sample" | "subscription";
  publishedAt: Date | null;
  steps: LessonStepView[];
};

export type LessonStepView = {
  id: string;
  order: number;
  type: string;
  title: string;
};

export type LessonProgressView = {
  lessonId: string;
  status: "not_started" | "in_progress" | "completed";
  completedStepIds: string[];
  completedSteps: number;
  totalSteps: number;
  lastPositionSeconds: number;
  startedAt: Date | null;
  completedAt: Date | null;
};
