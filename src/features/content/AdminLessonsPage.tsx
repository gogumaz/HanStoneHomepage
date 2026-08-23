import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { getCurrentUser } from '../auth/api';
import { ApiClientError } from '../../lib/api-client';
import {
  activateLessonHlsSource,
  changeAdminLessonStatus,
  createAdminLesson,
  listAdminLessons,
  listLessonAssets,
  listLessonVideoUploads,
  retryLessonVideoScan,
  retryLessonHlsTranscode,
  updateAdminLesson,
  uploadLessonVideo,
  uploadLessonAsset,
  type AdminLesson,
  type AdminLessonInput,
  type AdminLessonStatus,
  type LessonVideoAssetStatus,
} from './api';

const VIDEO_SCAN_LABEL: Record<LessonVideoAssetStatus, string> = {
  uploading: '업로드 중',
  quarantined: '검사 대기',
  scanning: '검사 중',
  ready: '검사 통과',
  rejected: '악성코드 탐지',
  error: '검사 오류',
  purged: '자동 정리됨',
};

const EMPTY_FORM: AdminLessonInput = {
  id: '',
  eraId: '',
  order: 1,
  level: '입문',
  course: '입문 1권',
  title: '',
  summary: '',
  instructor: '김바둑 선생님',
  difficulty: '처음 시작',
  durationMinutes: 10,
  isFreeSample: false,
};

const STATUS_LABEL: Record<AdminLessonStatus, string> = {
  draft: '비공개',
  published: '공개',
  archived: '보관',
};

function formFromLesson(lesson: AdminLesson): AdminLessonInput {
  return {
    id: lesson.id,
    eraId: lesson.era.id,
    order: lesson.order,
    level: lesson.level,
    course: lesson.course,
    title: lesson.title,
    summary: lesson.summary,
    instructor: lesson.instructor,
    difficulty: lesson.difficulty,
    durationMinutes: lesson.durationMinutes,
    isFreeSample: lesson.isFreeSample,
  };
}

export function AdminLessonsPage() {
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<AdminLessonInput>(EMPTY_FORM);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [hlsManifestKey, setHlsManifestKey] = useState('');
  const [assetKind, setAssetKind] = useState<'thumbnail' | 'material'>('thumbnail');
  const [assetFile, setAssetFile] = useState<File | null>(null);
  const meQuery = useQuery({ queryKey: ['current-user'], queryFn: getCurrentUser, retry: false });
  const canManage = meQuery.data?.roles.some((role) => role === 'operator' || role === 'admin') ?? false;
  const lessonsQuery = useQuery({
    queryKey: ['admin-lessons'],
    queryFn: listAdminLessons,
    enabled: canManage,
    retry: false,
  });
  const editingLesson = useMemo(
    () => lessonsQuery.data?.items.find((lesson) => lesson.id === editingId) ?? null,
    [editingId, lessonsQuery.data],
  );
  const assetsQuery = useQuery({
    queryKey: ['lesson-assets', editingId],
    queryFn: () => listLessonAssets(editingId ?? ''),
    enabled: Boolean(canManage && editingId),
    retry: false,
  });
  const videoUploadsQuery = useQuery({
    queryKey: ['lesson-video-uploads', editingId],
    queryFn: () => listLessonVideoUploads(editingId ?? ''),
    enabled: Boolean(canManage && editingId),
    retry: false,
    refetchInterval: 5_000,
  });

  useEffect(() => {
    if (!editingId && !form.eraId && lessonsQuery.data?.eras[0]) {
      setForm((current) => ({ ...current, eraId: lessonsQuery.data?.eras[0]?.id ?? '' }));
    }
  }, [editingId, form.eraId, lessonsQuery.data]);

  useEffect(() => {
    if (!editingLesson?.hasVideo && videoUploadsQuery.data?.items.some((asset) => asset.isCurrent)) {
      void queryClient.invalidateQueries({ queryKey: ['admin-lessons'] });
    }
  }, [editingLesson?.hasVideo, queryClient, videoUploadsQuery.data]);

  const refresh = async (lesson: AdminLesson) => {
    await queryClient.invalidateQueries({ queryKey: ['admin-lessons'] });
    setEditingId(lesson.id);
    setForm(formFromLesson(lesson));
  };
  const saveMutation = useMutation({
    mutationFn: () => editingId
      ? updateAdminLesson(editingId, {
          eraId: form.eraId,
          order: form.order,
          level: form.level,
          course: form.course,
          title: form.title,
          summary: form.summary,
          instructor: form.instructor,
          difficulty: form.difficulty,
          durationMinutes: form.durationMinutes,
          isFreeSample: form.isFreeSample,
        })
      : createAdminLesson(form),
    onSuccess: refresh,
  });
  const statusMutation = useMutation({
    mutationFn: ({ lessonId, status }: { lessonId: string; status: AdminLessonStatus }) =>
      changeAdminLessonStatus(lessonId, status),
    onSuccess: refresh,
  });
  const uploadMutation = useMutation({
    mutationFn: ({ lessonId, file }: { lessonId: string; file: File }) => uploadLessonVideo(lessonId, file),
    onSuccess: async () => {
      setVideoFile(null);
      await queryClient.invalidateQueries({ queryKey: ['lesson-video-uploads', editingId] });
    },
  });
  const retryVideoMutation = useMutation({
    mutationFn: ({ lessonId, assetId }: { lessonId: string; assetId: string }) =>
      retryLessonVideoScan(lessonId, assetId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['lesson-video-uploads', editingId] });
    },
  });
  const retryHlsMutation = useMutation({
    mutationFn: ({ lessonId, assetId }: { lessonId: string; assetId: string }) =>
      retryLessonHlsTranscode(lessonId, assetId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['lesson-video-uploads', editingId] });
    },
  });
  const hlsMutation = useMutation({
    mutationFn: ({ lessonId, manifestKey }: { lessonId: string; manifestKey: string }) =>
      activateLessonHlsSource(lessonId, manifestKey),
    onSuccess: async () => {
      setHlsManifestKey('');
      await queryClient.invalidateQueries({ queryKey: ['admin-lessons'] });
    },
  });
  const assetMutation = useMutation({
    mutationFn: ({ lessonId, kind, file }: { lessonId: string; kind: 'thumbnail' | 'material'; file: File }) =>
      uploadLessonAsset(lessonId, kind, file),
    onSettled: async () => {
      setAssetFile(null);
      await queryClient.invalidateQueries({ queryKey: ['lesson-assets', editingId] });
    },
  });
  const errors = [
    meQuery.error,
    lessonsQuery.error,
    assetsQuery.error,
    videoUploadsQuery.error,
    saveMutation.error,
    statusMutation.error,
    uploadMutation.error,
    retryVideoMutation.error,
    retryHlsMutation.error,
    hlsMutation.error,
    assetMutation.error,
  ];
  const error = errors.find((item): item is ApiClientError => item instanceof ApiClientError);

  const beginCreate = () => {
    setEditingId(null);
    setForm({ ...EMPTY_FORM, eraId: lessonsQuery.data?.eras[0]?.id ?? '' });
    setVideoFile(null);
    saveMutation.reset();
    statusMutation.reset();
    uploadMutation.reset();
    hlsMutation.reset();
    setHlsManifestKey('');
    assetMutation.reset();
  };
  const beginEdit = (lesson: AdminLesson) => {
    setEditingId(lesson.id);
    setForm(formFromLesson(lesson));
    setVideoFile(null);
    saveMutation.reset();
    statusMutation.reset();
    uploadMutation.reset();
    hlsMutation.reset();
    setHlsManifestKey('');
    assetMutation.reset();
  };

  if (meQuery.isLoading) {
    return <main className="catalog-page"><p role="status">관리자 권한을 확인하고 있습니다.</p></main>;
  }
  if (!meQuery.data) {
    return <main className="catalog-page"><p>강의 CMS를 사용하려면 <Link to="/account">로그인</Link>해 주세요.</p></main>;
  }
  if (!canManage) {
    return <main className="catalog-page"><p role="alert">운영자 또는 관리자만 강의 CMS를 사용할 수 있습니다.</p></main>;
  }

  return (
    <main className="catalog-page admin-lessons-page">
      <Link className="back-link" to="/lessons">← 공개 강의 여행으로</Link>
      <header className="catalog-header">
        <p className="react-stack-eyebrow">LESSON CMS</p>
        <h1>강의 콘텐츠 관리</h1>
        <p>강의를 비공개로 등록하고 영상을 연결한 뒤 공개합니다. 삭제 대신 보관 상태를 사용합니다.</p>
        <Link className="catalog-subscription-link" to="/admin/payments">결제 대사 관리 →</Link>
      </header>

      <div className="admin-lessons-layout">
        <section className="admin-lesson-list" aria-labelledby="admin-lesson-list-title">
          <div className="admin-section-heading">
            <h2 id="admin-lesson-list-title">전체 강의</h2>
            <button type="button" onClick={beginCreate}>새 강의 등록</button>
          </div>
          {lessonsQuery.isLoading ? <p role="status">강의 목록을 불러오고 있습니다.</p> : null}
          <div className="admin-lesson-items">
            {lessonsQuery.data?.items.map((lesson) => (
              <button
                type="button"
                className={editingId === lesson.id ? 'selected' : ''}
                key={lesson.id}
                onClick={() => beginEdit(lesson)}
              >
                <span><strong>{lesson.id}</strong><small>{lesson.era.name} · {lesson.order}강</small></span>
                <span><em data-status={lesson.status}>{STATUS_LABEL[lesson.status]}</em><small>{lesson.hasVideo ? '영상 연결됨' : '영상 없음'}</small></span>
              </button>
            ))}
          </div>
        </section>

        <section className="admin-lesson-editor" aria-labelledby="admin-lesson-editor-title">
          <div className="admin-section-heading">
            <div>
              <p className="react-stack-eyebrow">{editingId ? 'EDIT' : 'CREATE'}</p>
              <h2 id="admin-lesson-editor-title">{editingId ? `${editingId} 수정` : '새 강의 등록'}</h2>
            </div>
            {editingLesson ? <span className="admin-status-badge" data-status={editingLesson.status}>{STATUS_LABEL[editingLesson.status]}</span> : null}
          </div>
          <form
            className="admin-lesson-form"
            onSubmit={(event) => {
              event.preventDefault();
              saveMutation.mutate();
            }}
          >
            <label>강의 ID<input required disabled={Boolean(editingId)} value={form.id} onChange={(event) => setForm({ ...form, id: event.target.value.toUpperCase() })} placeholder="PRE-02" /></label>
            <label>시대<select required value={form.eraId} onChange={(event) => setForm({ ...form, eraId: event.target.value })}>{lessonsQuery.data?.eras.map((era) => <option value={era.id} key={era.id}>{era.name}</option>)}</select></label>
            <label>강의 순서<input required type="number" min="1" max="999" value={form.order} onChange={(event) => setForm({ ...form, order: Number(event.target.value) })} /></label>
            <label>단계<input required value={form.level} onChange={(event) => setForm({ ...form, level: event.target.value })} /></label>
            <label>과정<input required value={form.course} onChange={(event) => setForm({ ...form, course: event.target.value })} /></label>
            <label>강사<input required value={form.instructor} onChange={(event) => setForm({ ...form, instructor: event.target.value })} /></label>
            <label className="wide">제목<input required minLength={2} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label>
            <label className="wide">요약<textarea required minLength={10} rows={4} value={form.summary} onChange={(event) => setForm({ ...form, summary: event.target.value })} /></label>
            <label>난이도<input required value={form.difficulty} onChange={(event) => setForm({ ...form, difficulty: event.target.value })} /></label>
            <label>예상 시간(분)<input required type="number" min="1" max="600" value={form.durationMinutes} onChange={(event) => setForm({ ...form, durationMinutes: Number(event.target.value) })} /></label>
            <label className="admin-checkbox"><input type="checkbox" checked={form.isFreeSample} onChange={(event) => setForm({ ...form, isFreeSample: event.target.checked })} /> 누구나 볼 수 있는 무료 샘플</label>
            <button type="submit" disabled={saveMutation.isPending}>{saveMutation.isPending ? '저장 중…' : editingId ? '수정 저장' : '비공개 강의 등록'}</button>
          </form>
          {saveMutation.data ? <p className="completion-message" role="status">강의 정보를 저장했습니다.</p> : null}

          {editingLesson ? (
            <div className="admin-publish-panel">
              <h3>영상과 공개 상태</h3>
              <p>기본 단계 {editingLesson.stepCount}/6 · {editingLesson.hasVideo ? '영상 연결 완료' : '영상 업로드 필요'}</p>
              <p>업로드한 MP4는 비공개 격리 상태에서 스트리밍 악성코드 검사를 통과한 뒤 자동 연결됩니다.</p>
              <div className="admin-upload-row">
                <input type="file" aria-label="CMS MP4 영상 파일" accept="video/mp4,.mp4" onChange={(event) => setVideoFile(event.target.files?.[0] ?? null)} />
                <button type="button" disabled={!videoFile || uploadMutation.isPending} onClick={() => videoFile && uploadMutation.mutate({ lessonId: editingLesson.id, file: videoFile })}>
                  {uploadMutation.isPending ? '업로드·등록 중…' : '영상 업로드'}
                </button>
              </div>
              {uploadMutation.data ? <p className="completion-message" role="status">영상 업로드를 완료했고 비동기 악성코드 검사를 요청했습니다.</p> : null}
              <div className="admin-upload-row">
                <input
                  type="text"
                  aria-label="HLS 마스터 재생목록 경로"
                  value={hlsManifestKey}
                  placeholder={`lesson-hls/${editingLesson.id}/version-1/master.m3u8`}
                  onChange={(event) => {
                    setHlsManifestKey(event.target.value);
                    hlsMutation.reset();
                  }}
                />
                <button
                  type="button"
                  disabled={!hlsManifestKey.trim() || hlsMutation.isPending}
                  onClick={() => hlsMutation.mutate({ lessonId: editingLesson.id, manifestKey: hlsManifestKey.trim() })}
                >
                  {hlsMutation.isPending ? 'HLS 확인 중…' : '준비된 HLS 연결'}
                </button>
              </div>
              {hlsMutation.data ? <p className="completion-message" role="status">HLS 재생목록을 강의에 연결했습니다.</p> : null}
              {videoUploadsQuery.isLoading ? <p role="status">영상 검사 상태를 불러오고 있습니다.</p> : null}
              <ul className="admin-asset-list admin-video-scan-list">
                {videoUploadsQuery.data?.items.map((asset) => (
                  <li key={asset.id} data-status={asset.status}>
                    <span>
                      <strong>{asset.fileName}</strong>
                      <small>{((asset.size ?? asset.expectedSize) / 1024 / 1024).toFixed(1)}MB · 시도 {asset.attempts}회</small>
                    </span>
                    <span>
                      <em>{VIDEO_SCAN_LABEL[asset.status]}{asset.isCurrent ? ' · 현재 영상' : ''}</em>
                      <small>{asset.scanProvider ? `${asset.scanProvider}: ${asset.scanResult}` : asset.lastError ?? '검사 대기'}</small>
                      {asset.hlsTranscode ? (
                        <small>HLS: {asset.hlsTranscode.status} · 시도 {asset.hlsTranscode.attempts}회{asset.hlsTranscode.lastError ? ` · ${asset.hlsTranscode.lastError}` : ''}</small>
                      ) : null}
                      {asset.status === 'error' ? (
                        <button
                          type="button"
                          disabled={retryVideoMutation.isPending}
                          onClick={() => retryVideoMutation.mutate({ lessonId: editingLesson.id, assetId: asset.id })}
                        >검사 다시 시도</button>
                      ) : null}
                      {asset.hlsTranscode?.status === 'error' ? (
                        <button
                          type="button"
                          disabled={retryHlsMutation.isPending}
                          onClick={() => retryHlsMutation.mutate({ lessonId: editingLesson.id, assetId: asset.id })}
                        >HLS 변환 다시 시도</button>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="admin-status-actions">
                <button type="button" disabled={statusMutation.isPending || editingLesson.status === 'draft'} onClick={() => statusMutation.mutate({ lessonId: editingLesson.id, status: 'draft' })}>비공개</button>
                <button type="button" disabled={statusMutation.isPending || editingLesson.status === 'published' || !editingLesson.hasVideo || editingLesson.stepCount !== 6} onClick={() => statusMutation.mutate({ lessonId: editingLesson.id, status: 'published' })}>공개</button>
                <button type="button" disabled={statusMutation.isPending || editingLesson.status === 'archived'} onClick={() => statusMutation.mutate({ lessonId: editingLesson.id, status: 'archived' })}>보관</button>
              </div>
              {statusMutation.data ? <p className="completion-message" role="status">강의 상태를 {STATUS_LABEL[statusMutation.data.status]}로 변경했습니다.</p> : null}

              <div className="admin-assets-panel">
                <h3>썸네일·학습자료</h3>
                <p>업로드 파일은 격리 후 형식 검사와 ClamAV 악성코드 검사를 통과해야 활성화됩니다.</p>
                <div className="admin-asset-upload">
                  <label>자료 종류
                    <select value={assetKind} onChange={(event) => {
                      setAssetKind(event.target.value as 'thumbnail' | 'material');
                      setAssetFile(null);
                      assetMutation.reset();
                    }}>
                      <option value="thumbnail">썸네일</option>
                      <option value="material">학습자료</option>
                    </select>
                  </label>
                  <input
                    key={`${assetKind}-${assetMutation.data?.id ?? 'input'}`}
                    type="file"
                    aria-label="썸네일 또는 학습자료 파일"
                    accept={assetKind === 'thumbnail' ? 'image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp' : 'application/pdf,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/x-hwp,application/hwp+zip,.pdf,.ppt,.pptx,.doc,.docx,.hwp,.hwpx'}
                    onChange={(event) => setAssetFile(event.target.files?.[0] ?? null)}
                  />
                  <button
                    type="button"
                    disabled={!assetFile || assetMutation.isPending}
                    onClick={() => assetFile && assetMutation.mutate({ lessonId: editingLesson.id, kind: assetKind, file: assetFile })}
                  >
                    {assetMutation.isPending ? '격리·검사 중…' : '자료 업로드·검사'}
                  </button>
                </div>
                {assetMutation.data ? <p className="completion-message" role="status">파일 검사와 활성화를 완료했습니다.</p> : null}
                {assetsQuery.isLoading ? <p role="status">자료 검사 상태를 불러오고 있습니다.</p> : null}
                <ul className="admin-asset-list">
                  {assetsQuery.data?.items.map((asset) => (
                    <li key={asset.id} data-status={asset.status}>
                      <span><strong>{asset.originalName}</strong><small>{asset.kind === 'thumbnail' ? '썸네일' : '학습자료'} · {(asset.size / 1024 / 1024).toFixed(1)}MB</small></span>
                      <span><em>{asset.status === 'ready' ? '검사 통과' : asset.status === 'rejected' ? '거부됨' : '격리 중'}</em><small>{asset.scanProvider ? `${asset.scanProvider}: ${asset.scanResult}` : '검사 대기'}</small></span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}
          {error ? <p className="auth-error" role="alert">{error.message}{error.requestId ? ` (요청 ID: ${error.requestId})` : ''}</p> : null}
        </section>
      </div>
    </main>
  );
}
