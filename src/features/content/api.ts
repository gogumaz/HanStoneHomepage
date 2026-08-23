import { ApiClientError, apiRequest } from '../../lib/api-client';

export type Era = {
  id: string;
  order: number;
  name: string;
  theme: string;
  description: string;
  status: 'available' | 'coming_soon';
  completedLessons: number;
  totalLessons: number;
};

export type Lesson = {
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
  access: 'free_sample' | 'subscription';
  publishedAt: string | null;
  steps: Array<{ id: string; order: number; type: string; title: string }>;
};

export type SubscriptionPlan = {
  id: string;
  label: string;
  months: number;
  price: number;
  recommended: boolean;
};

export type LessonProgress = {
  lessonId: string;
  status: 'not_started' | 'in_progress' | 'completed';
  completedStepIds: string[];
  completedSteps: number;
  totalSteps: number;
  lastPositionSeconds: number;
  startedAt: string | null;
  completedAt: string | null;
};

export type PlaybackAccess = {
  lessonId: string;
  access: {
    source: 'free_sample' | 'subscription' | 'operator_preview';
    subscriptionEndsAt: string | null;
  };
  playback: {
    status: 'asset_pending' | 'signer_pending' | 'ready';
    format: 'mp4' | 'hls' | null;
    delivery: 'object-storage' | 'cloudfront' | null;
    url: string | null;
    expiresAt: string | null;
    message: string;
  };
};

export type LessonThumbnail = {
  lessonId: string;
  url: string;
  expiresAt: string;
};

export type LessonMaterials = {
  lessonId: string;
  access: PlaybackAccess['access'];
  items: Array<{
    id: string;
    originalName: string;
    contentType: string;
    size: number;
    url: string;
    expiresAt: string;
  }>;
};

export type LessonVideoAssetStatus = 'uploading' | 'quarantined' | 'scanning' | 'ready' | 'rejected' | 'error' | 'purged';

export type LessonVideoAsset = {
  id: string;
  lessonId: string;
  status: LessonVideoAssetStatus;
  fileName: string;
  contentType: 'video/mp4';
  expectedSize: number;
  size: number | null;
  scanProvider: string | null;
  scanResult: string | null;
  scannedAt: string | null;
  attachedAt: string | null;
  attempts: number;
  nextAttemptAt: string | null;
  lastError: string | null;
  isCurrent: boolean;
  createdAt: string;
  hlsTranscode: {
    status: 'pending' | 'transcoding' | 'ready' | 'superseded' | 'error';
    attempts: number;
    manifestKey: string | null;
    lastError: string | null;
    completedAt: string | null;
  } | null;
};

export type VideoUploadResult = LessonVideoAsset;

export type AdminLessonStatus = 'draft' | 'published' | 'archived';

export type AdminLesson = {
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
  status: AdminLessonStatus;
  isFreeSample: boolean;
  hasVideo: boolean;
  stepCount: number;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AdminLessonInput = {
  id: string;
  eraId: string;
  order: number;
  level: string;
  course: string;
  title: string;
  summary: string;
  instructor: string;
  difficulty: string;
  durationMinutes: number;
  isFreeSample: boolean;
};

export type LessonAsset = {
  id: string;
  kind: 'thumbnail' | 'material';
  originalName: string;
  contentType: string;
  size: number;
  status: 'quarantined' | 'ready' | 'rejected';
  scanProvider: string | null;
  scanResult: string | null;
  scannedAt: string | null;
  createdAt: string;
  isCurrentThumbnail: boolean;
};

type VideoUploadIntent = {
  lessonId: string;
  upload: {
    method: 'POST';
    url: string;
    fields: Record<string, string>;
    assetKey: string;
    expiresAt: string;
    maxBytes: number;
  };
};

export function listEras() {
  return apiRequest<Era[]>('/eras');
}

export function listEraLessons(eraId: string) {
  return apiRequest<{ era: Era; items: Lesson[] }>(
    `/eras/${encodeURIComponent(eraId)}/lessons`,
  );
}

export function getLesson(lessonId: string) {
  return apiRequest<Lesson>(`/lessons/${encodeURIComponent(lessonId)}`);
}

export function listSubscriptionPlans() {
  return apiRequest<{ items: SubscriptionPlan[] }>('/subscription-plans');
}

export function getLessonPlayback(lessonId: string) {
  return apiRequest<PlaybackAccess>(`/lessons/${encodeURIComponent(lessonId)}/playback`);
}

export function getLessonThumbnail(lessonId: string) {
  return apiRequest<LessonThumbnail>(`/lessons/${encodeURIComponent(lessonId)}/thumbnail`);
}

export function getLessonMaterials(lessonId: string) {
  return apiRequest<LessonMaterials>(`/lessons/${encodeURIComponent(lessonId)}/materials`);
}

export function listAdminLessons() {
  return apiRequest<{
    eras: Array<{ id: string; order: number; name: string }>;
    items: AdminLesson[];
  }>('/admin/lessons');
}

export function createAdminLesson(input: AdminLessonInput) {
  return apiRequest<AdminLesson>('/admin/lessons', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateAdminLesson(lessonId: string, input: Omit<AdminLessonInput, 'id'>) {
  return apiRequest<AdminLesson>(`/admin/lessons/${encodeURIComponent(lessonId)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function changeAdminLessonStatus(lessonId: string, status: AdminLessonStatus) {
  return apiRequest<AdminLesson>(`/admin/lessons/${encodeURIComponent(lessonId)}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export function listLessonAssets(lessonId: string) {
  return apiRequest<{ items: LessonAsset[] }>(
    `/admin/lessons/${encodeURIComponent(lessonId)}/assets`,
  );
}

export function listLessonVideoUploads(lessonId: string) {
  return apiRequest<{ items: LessonVideoAsset[] }>(
    `/admin/lessons/${encodeURIComponent(lessonId)}/video-uploads`,
  );
}

export function retryLessonVideoScan(lessonId: string, assetId: string) {
  return apiRequest<LessonVideoAsset>(
    `/admin/lessons/${encodeURIComponent(lessonId)}/video-uploads/${encodeURIComponent(assetId)}/retry`,
    { method: 'POST' },
  );
}

export function retryLessonHlsTranscode(lessonId: string, assetId: string) {
  return apiRequest<NonNullable<LessonVideoAsset['hlsTranscode']>>(
    `/admin/lessons/${encodeURIComponent(lessonId)}/video-uploads/${encodeURIComponent(assetId)}/hls-retry`,
    { method: 'POST' },
  );
}

export function activateLessonHlsSource(lessonId: string, manifestKey: string) {
  return apiRequest<{ lessonId: string; format: 'hls'; manifestKey: string; activatedAt: string }>(
    `/admin/lessons/${encodeURIComponent(lessonId)}/hls-source`,
    { method: 'POST', body: JSON.stringify({ manifestKey }) },
  );
}

const LESSON_ASSET_CONTENT_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  pdf: 'application/pdf',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  hwp: 'application/x-hwp',
  hwpx: 'application/hwp+zip',
};

export function getLessonAssetContentType(file: Pick<File, 'name' | 'type'>): string {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  return LESSON_ASSET_CONTENT_TYPES[extension] ?? file.type.toLowerCase();
}

export async function uploadLessonAsset(
  lessonId: string,
  kind: 'thumbnail' | 'material',
  file: File,
): Promise<LessonAsset> {
  const contentType = getLessonAssetContentType(file);
  const intent = await apiRequest<{
    asset: { id: string; status: 'quarantined' };
    upload: { method: 'POST'; url: string; fields: Record<string, string>; expiresAt: string };
  }>(`/admin/lessons/${encodeURIComponent(lessonId)}/assets/uploads`, {
    method: 'POST',
    body: JSON.stringify({ kind, fileName: file.name, contentType, size: file.size }),
  });
  const form = new FormData();
  Object.entries(intent.upload.fields).forEach(([key, value]) => form.append(key, value));
  form.append('file', file);
  const uploaded = await fetch(intent.upload.url, { method: intent.upload.method, body: form });
  if (!uploaded.ok) {
    throw new ApiClientError(`파일 저장소 업로드에 실패했습니다. (${uploaded.status})`, uploaded.status, 'LESSON_ASSET_UPLOAD_FAILED');
  }
  return apiRequest<LessonAsset>(
    `/admin/lessons/${encodeURIComponent(lessonId)}/assets/${encodeURIComponent(intent.asset.id)}/complete`,
    { method: 'POST' },
  );
}

export async function uploadLessonVideo(lessonId: string, file: File): Promise<VideoUploadResult> {
  const intent = await apiRequest<VideoUploadIntent>(
    `/admin/lessons/${encodeURIComponent(lessonId)}/video-upload`,
    {
      method: 'POST',
      body: JSON.stringify({ fileName: file.name, contentType: file.type, size: file.size }),
    },
  );
  const form = new FormData();
  Object.entries(intent.upload.fields).forEach(([key, value]) => form.append(key, value));
  form.append('file', file);
  const uploaded = await fetch(intent.upload.url, { method: intent.upload.method, body: form });
  if (!uploaded.ok) {
    throw new ApiClientError(
      `영상 저장소 업로드에 실패했습니다. (${uploaded.status})`,
      uploaded.status,
      'VIDEO_UPLOAD_FAILED',
    );
  }
  return apiRequest<VideoUploadResult>(
    `/admin/lessons/${encodeURIComponent(lessonId)}/video-upload/complete`,
    {
      method: 'POST',
      body: JSON.stringify({ assetKey: intent.upload.assetKey }),
    },
  );
}

export function getLessonProgress(lessonId: string) {
  return apiRequest<LessonProgress>(`/me/lessons/${encodeURIComponent(lessonId)}/progress`);
}

export function startLesson(lessonId: string) {
  return apiRequest<LessonProgress>(`/lessons/${encodeURIComponent(lessonId)}/start`, {
    method: 'POST',
  });
}

export function completeLessonStep(lessonId: string, stepId: string) {
  return apiRequest<LessonProgress>(
    `/lessons/${encodeURIComponent(lessonId)}/steps/${encodeURIComponent(stepId)}/complete`,
    { method: 'POST' },
  );
}

export function completeLesson(lessonId: string) {
  return apiRequest<LessonProgress>(`/lessons/${encodeURIComponent(lessonId)}/complete`, {
    method: 'POST',
  });
}
