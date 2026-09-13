import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ApiClientError } from '../../lib/api-client';
import { getCurrentUser } from '../auth/api';
import {
  createTeacherClassInviteCode,
  getTeacherClassProgressSetting,
  listTeacherClasses,
  listTeacherClassStudents,
  updateTeacherClassProgressSetting,
} from './api';

function formatDate(value: string | null): string {
  if (!value) return '종료일 없음';
  return new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium' }).format(new Date(value));
}

function errorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof ApiClientError)) return fallback;
  return `${error.message}${error.requestId ? ` (요청 ID: ${error.requestId})` : ''}`;
}

export function TeacherClassroomPage() {
  const [requestedClassId, setRequestedClassId] = useState<string | null>(null);
  const [progressDrafts, setProgressDrafts] = useState<Record<string, string>>({});
  const queryClient = useQueryClient();
  const meQuery = useQuery({ queryKey: ['current-user'], queryFn: getCurrentUser, retry: false });
  const isInstructor = meQuery.data?.roles.includes('instructor') ?? false;
  const classesQuery = useQuery({
    queryKey: ['teacher-classes', meQuery.data?.id],
    queryFn: listTeacherClasses,
    enabled: isInstructor,
    retry: false,
  });
  const classes = classesQuery.data?.items ?? [];
  const selectedClassId = classes.some((item) => item.id === requestedClassId)
    ? requestedClassId
    : classes[0]?.id ?? null;
  const studentsQuery = useQuery({
    queryKey: ['teacher-class-students', meQuery.data?.id, selectedClassId],
    queryFn: () => listTeacherClassStudents(selectedClassId ?? ''),
    enabled: Boolean(isInstructor && selectedClassId),
    retry: false,
  });
  const inviteMutation = useMutation({ mutationFn: createTeacherClassInviteCode });
  const progressQuery = useQuery({
    queryKey: ['teacher-class-progress-setting', meQuery.data?.id, selectedClassId],
    queryFn: () => getTeacherClassProgressSetting(selectedClassId ?? ''),
    enabled: Boolean(isInstructor && selectedClassId),
    retry: false,
  });
  const progressMutation = useMutation({
    mutationFn: ({ classId, lessonId }: { classId: string; lessonId: string | null }) => (
      updateTeacherClassProgressSetting(classId, lessonId)
    ),
    onSuccess: async (_result, variables) => {
      await queryClient.invalidateQueries({
        queryKey: ['teacher-class-progress-setting', meQuery.data?.id, variables.classId],
      });
    },
  });
  const selectedClass = classes.find((item) => item.id === selectedClassId) ?? null;
  const savedProgressLessonId = progressQuery.data?.progressSetting.currentLesson?.id ?? '';
  const progressDraft = selectedClassId
    ? progressDrafts[selectedClassId] ?? savedProgressLessonId
    : '';

  if (meQuery.isLoading) {
    return <main className="react-stack-page"><p role="status">지도자 권한을 확인하고 있습니다…</p></main>;
  }

  if (!isInstructor) {
    return (
      <main className="react-stack-page">
        <section className="react-stack-card" role="alert">
          <h1>지도자 권한이 필요합니다.</h1>
          <p>인증된 지도자 계정으로 로그인하면 담당 학급과 학생 명단을 확인할 수 있습니다.</p>
          <Link className="back-link" to="/account">계정 확인하기</Link>
        </section>
      </main>
    );
  }

  return (
    <main className="teacher-page">
      <header className="teacher-page-header">
        <div>
          <p className="react-stack-eyebrow">TEACHER CLASSROOM</p>
          <h1>{meQuery.data?.displayName}님의 지도자 교실</h1>
          <p>현재 기관 멤버십에서 배정된 학급과 재학 중인 학생만 표시합니다.</p>
        </div>
        <nav aria-label="지도자 바로가기">
          <Link to="/board.html?type=classHelper">수업도우미 열기</Link>
          <Link to="/lessons">강의 살펴보기</Link>
        </nav>
      </header>

      {classesQuery.isLoading ? <p className="teacher-status" role="status">담당 학급을 불러오고 있습니다…</p> : null}
      {classesQuery.isError ? (
        <p className="auth-error teacher-query-error" role="alert">
          {errorMessage(classesQuery.error, '담당 학급을 불러오지 못했습니다.')}
        </p>
      ) : null}

      {!classesQuery.isLoading && !classesQuery.isError && classes.length === 0 ? (
        <section className="teacher-empty" aria-labelledby="teacher-empty-title">
          <h2 id="teacher-empty-title">현재 배정된 학급이 없습니다.</h2>
          <p>기관 관리자에게 활성 지도자 멤버십과 학급 배정을 확인해 달라고 요청해 주세요.</p>
        </section>
      ) : null}

      {classes.length > 0 ? (
        <div className="teacher-workspace">
          <section className="teacher-classes" aria-labelledby="teacher-classes-title">
            <div className="teacher-section-heading">
              <div>
                <p className="react-stack-eyebrow">MY CLASSES</p>
                <h2 id="teacher-classes-title">담당 학급</h2>
              </div>
              <strong>{classes.length}개</strong>
            </div>
            <div className="teacher-class-list">
              {classes.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={selectedClassId === item.id}
                  onClick={() => {
                    inviteMutation.reset();
                    progressMutation.reset();
                    setRequestedClassId(item.id);
                  }}
                >
                  <span>{item.organization.name}</span>
                  <strong>{item.name}</strong>
                  <small>{item.academicYear}학년도 · {formatDate(item.assignment.startsAt)}부터</small>
                </button>
              ))}
            </div>
          </section>

          <section className="teacher-roster" aria-labelledby="teacher-roster-title">
            <div className="teacher-section-heading">
              <div>
                <p className="react-stack-eyebrow">ACTIVE ROSTER</p>
                <h2 id="teacher-roster-title">{selectedClass?.name ?? '학급'} 학생 명단</h2>
              </div>
              {studentsQuery.data ? <strong>{studentsQuery.data.items.length}명</strong> : null}
            </div>
            {selectedClass ? (
              <p className="teacher-class-meta">
                {selectedClass.organization.name} · {selectedClass.academicYear}학년도 · 배정 종료 {formatDate(selectedClass.assignment.endsAt)}
              </p>
            ) : null}
            <section className="teacher-invite-panel" aria-labelledby="teacher-invite-title">
              <div>
                <h3 id="teacher-invite-title">학생 등록 코드</h3>
                <p>코드는 표시된 만료 시각까지 한 번만 사용할 수 있습니다. 새 코드를 만들면 이 지도자가 앞서 발급한 미사용 코드는 취소됩니다.</p>
              </div>
              <button
                type="button"
                disabled={!selectedClassId || inviteMutation.isPending}
                onClick={() => selectedClassId && inviteMutation.mutate(selectedClassId)}
              >
                {inviteMutation.isPending ? '발급 중…' : '새 등록 코드 만들기'}
              </button>
              {inviteMutation.data?.inviteCode.class.id === selectedClassId ? (
                <div className="teacher-invite-result" role="status">
                  <span>학생에게 전달할 일회용 코드</span>
                  <code>{inviteMutation.data.inviteCode.code}</code>
                  <small>{new Date(inviteMutation.data.inviteCode.expiresAt).toLocaleString('ko-KR')}까지 유효</small>
                </div>
              ) : null}
              {inviteMutation.isError ? (
                <p className="auth-error" role="alert">
                  {errorMessage(inviteMutation.error, '학생 등록 코드를 만들지 못했습니다.')}
                </p>
              ) : null}
            </section>
            <section className="teacher-progress-setting" aria-labelledby="teacher-progress-setting-title">
              <div>
                <h3 id="teacher-progress-setting-title">반별 현재 수업</h3>
                <p>학생 대시보드에 우리 반이 함께 학습할 강의를 안내합니다. 강의 이용권은 기존 구독 정책을 그대로 따릅니다.</p>
              </div>
              {progressQuery.isLoading ? <p role="status">현재 수업 설정을 불러오고 있습니다…</p> : null}
              {progressQuery.isError ? (
                <p className="auth-error" role="alert">
                  {errorMessage(progressQuery.error, '현재 수업 설정을 불러오지 못했습니다.')}
                </p>
              ) : null}
              {progressQuery.data ? (
                <form onSubmit={(event) => {
                  event.preventDefault();
                  if (!selectedClassId) return;
                  progressMutation.reset();
                  progressMutation.mutate({ classId: selectedClassId, lessonId: progressDraft || null });
                }}>
                  <label htmlFor="teacher-progress-lesson">현재 수업 강의</label>
                  <select
                    id="teacher-progress-lesson"
                    value={progressDraft}
                    onChange={(event) => {
                      if (!selectedClassId) return;
                      setProgressDrafts((current) => ({
                        ...current,
                        [selectedClassId]: event.target.value,
                      }));
                    }}
                  >
                    <option value="">현재 수업 지정 안 함</option>
                    {progressQuery.data.progressSetting.availableLessons.map((lesson) => (
                      <option key={lesson.id} value={lesson.id}>
                        {lesson.era.name} · {lesson.course} · {lesson.title}
                      </option>
                    ))}
                  </select>
                  <button
                    type="submit"
                    disabled={progressMutation.isPending || progressDraft === savedProgressLessonId}
                  >
                    {progressMutation.isPending ? '저장 중…' : '현재 수업 저장'}
                  </button>
                </form>
              ) : null}
              {progressMutation.isSuccess ? (
                <p className="teacher-progress-success" role="status">반별 현재 수업 설정을 저장했습니다.</p>
              ) : null}
              {progressMutation.isError ? (
                <p className="auth-error" role="alert">
                  {errorMessage(progressMutation.error, '현재 수업 설정을 저장하지 못했습니다.')}
                </p>
              ) : null}
            </section>
            {studentsQuery.isLoading ? <p role="status">학생 명단을 불러오고 있습니다…</p> : null}
            {studentsQuery.isError ? (
              <p className="auth-error" role="alert">
                {errorMessage(studentsQuery.error, '학생 명단을 불러오지 못했습니다.')}
              </p>
            ) : null}
            {studentsQuery.data?.items.length === 0 ? <p>현재 재학 중인 학생이 없습니다.</p> : null}
            {studentsQuery.data?.items.length ? (
              <ol className="teacher-student-list">
                {studentsQuery.data.items.map((student) => (
                  <li key={student.id}>
                    <span aria-hidden="true">{student.displayName.slice(0, 1)}</span>
                    <div>
                      <strong>{student.displayName}</strong>
                      <small>{formatDate(student.enrolledAt)} 등록</small>
                    </div>
                  </li>
                ))}
              </ol>
            ) : null}
          </section>
        </div>
      ) : null}
    </main>
  );
}
