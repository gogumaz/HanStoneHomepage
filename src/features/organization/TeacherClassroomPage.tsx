import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ApiClientError } from '../../lib/api-client';
import { getCurrentUser } from '../auth/api';
import { listTeacherClasses, listTeacherClassStudents } from './api';

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
  const selectedClass = classes.find((item) => item.id === selectedClassId) ?? null;

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
                  onClick={() => setRequestedClassId(item.id)}
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
