import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { getCurrentUser } from '../auth/api';
import { ApiClientError } from '../../lib/api-client';
import {
  completeLesson,
  completeLessonStep,
  getLesson,
  getLessonMaterials,
  getLessonPlayback,
  getLessonProgress,
  getLessonThumbnail,
  startLesson,
  uploadLessonVideo,
  type LessonProgress,
} from './api';
import { LessonVideoPlayer } from './LessonVideoPlayer';

export function LessonDetailPage() {
  const { lessonId = '' } = useParams();
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const queryClient = useQueryClient();
  const lessonQuery = useQuery({
    queryKey: ['lesson', lessonId],
    queryFn: () => getLesson(lessonId),
    enabled: Boolean(lessonId),
    retry: false,
  });
  const meQuery = useQuery({ queryKey: ['current-user'], queryFn: getCurrentUser, retry: false });
  const progressQuery = useQuery({
    queryKey: ['lesson-progress', lessonId],
    queryFn: () => getLessonProgress(lessonId),
    enabled: Boolean(lessonId && meQuery.data),
    retry: false,
  });
  const playbackMutation = useMutation({ mutationFn: () => getLessonPlayback(lessonId) });
  const thumbnailQuery = useQuery({
    queryKey: ['lesson-thumbnail', lessonId],
    queryFn: () => getLessonThumbnail(lessonId),
    enabled: Boolean(lessonId && lessonQuery.data?.hasThumbnail),
    staleTime: 4 * 60 * 1000,
    refetchInterval: (query) => {
      const expiresAt = query.state.data?.expiresAt;
      return expiresAt ? Math.max(10_000, Date.parse(expiresAt) - Date.now() - 30_000) : false;
    },
    retry: false,
  });
  const materialsMutation = useMutation({ mutationFn: () => getLessonMaterials(lessonId) });
  const updateProgress = (progress: LessonProgress) => {
    queryClient.setQueryData(['lesson-progress', lessonId], progress);
  };
  const startMutation = useMutation({
    mutationFn: () => startLesson(lessonId),
    onSuccess: updateProgress,
  });
  const stepMutation = useMutation({
    mutationFn: (stepId: string) => completeLessonStep(lessonId, stepId),
    onSuccess: updateProgress,
  });
  const completeMutation = useMutation({
    mutationFn: () => completeLesson(lessonId),
    onSuccess: updateProgress,
  });
  const uploadMutation = useMutation({
    mutationFn: (file: File) => uploadLessonVideo(lessonId, file),
    onSuccess: () => {
      playbackMutation.reset();
      setVideoFile(null);
    },
  });
  const errors = [
    lessonQuery.error,
    playbackMutation.error,
    materialsMutation.error,
    progressQuery.error,
    startMutation.error,
    stepMutation.error,
    completeMutation.error,
    uploadMutation.error,
  ];
  const error = errors.find((item): item is ApiClientError => item instanceof ApiClientError);
  const progress = progressQuery.data;
  const canManageVideo = meQuery.data?.roles.some((role) => role === 'operator' || role === 'admin') ?? false;

  return (
    <main className="catalog-page lesson-detail-page">
      <Link className="back-link" to="/lessons">← 시대별 강의로</Link>
      {lessonQuery.isLoading ? <p role="status">강의 정보를 불러오고 있습니다.</p> : null}
      {lessonQuery.data ? (
        <article className="lesson-detail-card">
          {thumbnailQuery.data ? (
            <img
              className="lesson-detail-thumbnail"
              src={thumbnailQuery.data.url}
              alt={`${lessonQuery.data.title} 강의 썸네일`}
            />
          ) : null}
          <p className="react-stack-eyebrow">{lessonQuery.data.era.name} · {lessonQuery.data.id}</p>
          <div className="lesson-card-topline">
            <span>{lessonQuery.data.course} · {lessonQuery.data.order}강</span>
            <span>{lessonQuery.data.isFreeSample ? '무료 샘플' : '구독 전용'}</span>
          </div>
          <h1>{lessonQuery.data.title}</h1>
          <p className="lesson-summary">{lessonQuery.data.summary}</p>
          <dl className="lesson-metadata">
            <div><dt>강사</dt><dd>{lessonQuery.data.instructor}</dd></div>
            <div><dt>난이도</dt><dd>{lessonQuery.data.difficulty}</dd></div>
            <div><dt>예상 시간</dt><dd>{lessonQuery.data.durationMinutes}분</dd></div>
            <div><dt>이용 조건</dt><dd>{lessonQuery.data.isFreeSample ? '누구나 무료' : '활성 구독 필요'}</dd></div>
          </dl>
          <div className="player-placeholder">
            <strong>강의 재생 권한</strong>
            <p>무료 샘플·활성 구독·운영자 권한을 서버에서 확인합니다.</p>
            <button type="button" disabled={playbackMutation.isPending} onClick={() => playbackMutation.mutate()}>
              {playbackMutation.isPending ? '권한 확인 중…' : '재생 권한 확인'}
            </button>
            {playbackMutation.data ? (
              <div className="playback-result" role="status">
                <span>접근 허용: {playbackMutation.data.access.source}</span>
                <p>{playbackMutation.data.playback.message}</p>
                {playbackMutation.data.playback.url ? (
                  <LessonVideoPlayer
                    src={playbackMutation.data.playback.url}
                    format={playbackMutation.data.playback.format ?? 'mp4'}
                  />
                ) : null}
                {playbackMutation.data.playback.expiresAt ? (
                  <small>재생 URL 만료: {new Date(playbackMutation.data.playback.expiresAt).toLocaleString('ko-KR')}</small>
                ) : null}
                {playbackMutation.data.access.subscriptionEndsAt ? (
                  <small>구독 종료: {new Date(playbackMutation.data.access.subscriptionEndsAt).toLocaleString('ko-KR')}</small>
                ) : null}
              </div>
            ) : null}
          </div>

          <section className="lesson-materials" aria-labelledby="lesson-materials-title">
            <h2 id="lesson-materials-title">학습자료</h2>
            <p>무료 샘플·활성 구독·운영자 권한을 확인한 뒤, 짧게 유효한 다운로드 링크를 발급합니다.</p>
            <button
              type="button"
              disabled={materialsMutation.isPending}
              onClick={() => materialsMutation.mutate()}
            >
              {materialsMutation.isPending ? '자료 확인 중…' : '학습자료 확인'}
            </button>
            {materialsMutation.data ? (
              <div className="lesson-materials-result" role="status">
                {materialsMutation.data.items.length ? (
                  <ul>
                    {materialsMutation.data.items.map((material) => (
                      <li key={material.id}>
                        <span>
                          <strong>{material.originalName}</strong>
                          <small>{(material.size / 1024 / 1024).toFixed(1)}MB</small>
                        </span>
                        <a href={material.url}>다운로드</a>
                      </li>
                    ))}
                  </ul>
                ) : <p>현재 제공 중인 학습자료가 없습니다.</p>}
                {materialsMutation.data.items[0] ? (
                  <small>다운로드 링크 만료: {new Date(materialsMutation.data.items[0].expiresAt).toLocaleString('ko-KR')}</small>
                ) : null}
              </div>
            ) : null}
          </section>

          {canManageVideo ? (
            <section className="lesson-video-upload" aria-labelledby="video-upload-title">
              <p className="react-stack-eyebrow">OPERATOR</p>
              <h2 id="video-upload-title">강의 영상 업로드</h2>
              <p>MP4 파일만 업로드할 수 있습니다. 서버가 크기·강의 귀속·파일 시그니처를 확인하고 비동기 악성코드 검사를 통과한 뒤 연결합니다.</p>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  if (videoFile) uploadMutation.mutate(videoFile);
                }}
              >
                <label htmlFor="lesson-video-file">MP4 영상 파일</label>
                <input
                  key={uploadMutation.data?.id ?? 'video-input'}
                  id="lesson-video-file"
                  type="file"
                  accept="video/mp4,.mp4"
                  disabled={uploadMutation.isPending}
                  onChange={(event) => {
                    setVideoFile(event.target.files?.[0] ?? null);
                    uploadMutation.reset();
                  }}
                />
                <button type="submit" disabled={!videoFile || uploadMutation.isPending}>
                  {uploadMutation.isPending ? '업로드·등록 중…' : '영상 업로드'}
                </button>
              </form>
              {videoFile ? <small>선택 파일: {videoFile.name} · {(videoFile.size / 1024 / 1024).toFixed(1)}MB</small> : null}
              {uploadMutation.data ? (
                <p className="completion-message" role="status">
                  영상 업로드를 완료했습니다. 악성코드 검사 통과 후 자동으로 강의에 연결됩니다.
                </p>
              ) : null}
              <p><Link to="/admin/lessons">강의 CMS에서 정보와 공개 상태 관리 →</Link></p>
            </section>
          ) : null}

          <section className="lesson-progress-panel" aria-labelledby="progress-title">
            <div className="progress-heading">
              <div>
                <p className="react-stack-eyebrow">PROGRESS</p>
                <h2 id="progress-title">강의 단계</h2>
              </div>
              <strong>{progress?.completedSteps ?? 0} / {lessonQuery.data.steps.length}</strong>
            </div>

            {!meQuery.isLoading && !meQuery.data ? (
              <p>진도를 저장하려면 <Link to="/account">로그인</Link>해 주세요.</p>
            ) : null}
            {meQuery.data && (!progress || progress.status === 'not_started') ? (
              <button type="button" disabled={startMutation.isPending} onClick={() => startMutation.mutate()}>
                {startMutation.isPending ? '시작 중…' : '강의 시작'}
              </button>
            ) : null}

            <ol className="lesson-steps">
              {lessonQuery.data.steps.map((step) => {
                const completed = progress?.completedStepIds.includes(step.id) ?? false;
                return (
                  <li key={step.id} data-completed={completed}>
                    <span><small>{step.order}단계</small><strong>{step.title}</strong></span>
                    {completed ? <span>완료</span> : meQuery.data && progress?.status === 'in_progress' ? (
                      <button type="button" disabled={stepMutation.isPending} onClick={() => stepMutation.mutate(step.id)}>단계 완료</button>
                    ) : <span>대기</span>}
                  </li>
                );
              })}
            </ol>

            {meQuery.data && progress?.status === 'in_progress' ? (
              <button
                type="button"
                disabled={completeMutation.isPending || progress.completedSteps < progress.totalSteps}
                onClick={() => completeMutation.mutate()}
              >
                {completeMutation.isPending ? '완료 처리 중…' : '강의 완료'}
              </button>
            ) : null}
            {progress?.status === 'completed' ? <p className="completion-message" role="status">강의를 완료했습니다.</p> : null}
          </section>
        </article>
      ) : null}
      {error ? <p className="auth-error" role="alert">{error.message}{error.requestId ? ` (요청 ID: ${error.requestId})` : ''}</p> : null}
    </main>
  );
}
