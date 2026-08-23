import { type FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { getCurrentUser } from '../auth/api';
import { ApiClientError } from '../../lib/api-client';
import {
  acceptGuardianInvitation,
  createGuardianInvitation,
  getGuardianInvitation,
  getGuardianStudentReport,
  listGuardianStudents,
  revokeGuardianLink,
} from './api';

export function GuardianPage() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [email, setEmail] = useState('');
  const [tokenInput, setTokenInput] = useState(searchParams.get('token') ?? '');
  const [agreed, setAgreed] = useState(false);
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const token = searchParams.get('token') ?? '';

  const meQuery = useQuery({ queryKey: ['current-user'], queryFn: getCurrentUser, retry: false });
  const isStudent = meQuery.data?.roles.includes('student') ?? false;
  const isGuardian = meQuery.data?.roles.includes('guardian') ?? false;
  const invitationQuery = useQuery({
    queryKey: ['guardian-invitation', token],
    queryFn: () => getGuardianInvitation(token),
    enabled: Boolean(token),
    retry: false,
  });
  const studentsQuery = useQuery({
    queryKey: ['guardian-students'],
    queryFn: listGuardianStudents,
    enabled: isGuardian,
    retry: false,
  });
  const reportQuery = useQuery({
    queryKey: ['guardian-student-report', selectedStudentId],
    queryFn: () => getGuardianStudentReport(selectedStudentId ?? ''),
    enabled: Boolean(isGuardian && selectedStudentId),
    retry: false,
  });
  const createMutation = useMutation({ mutationFn: () => createGuardianInvitation(email) });
  const acceptMutation = useMutation({
    mutationFn: () => acceptGuardianInvitation(token),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['guardian-students'] });
      queryClient.invalidateQueries({ queryKey: ['guardian-invitation', token] });
    },
  });
  const revokeMutation = useMutation({
    mutationFn: revokeGuardianLink,
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['guardian-students'] });
      queryClient.removeQueries({ queryKey: ['guardian-student-report', result.link.student.id] });
      if (selectedStudentId === result.link.student.id) setSelectedStudentId(null);
    },
  });

  function openInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSearchParams(tokenInput.trim() ? { token: tokenInput.trim() } : {});
  }

  const errors = [
    meQuery.error,
    invitationQuery.error,
    studentsQuery.error,
    reportQuery.error,
    createMutation.error,
    acceptMutation.error,
    revokeMutation.error,
  ];
  const error = errors.find((item): item is ApiClientError => item instanceof ApiClientError);

  return (
    <main className="auth-page guardian-page">
      <section className="auth-card guardian-card" aria-labelledby="guardian-title">
        <Link className="back-link" to="/account">← 계정으로</Link>
        <p className="react-stack-eyebrow">GUARDIAN LINK</p>
        <h1 id="guardian-title">보호자 연결 관리</h1>

        {!meQuery.isLoading && !meQuery.data ? (
          <p>초대를 만들거나 수락하려면 먼저 <Link to="/account">로그인</Link>해 주세요.</p>
        ) : null}

        {isStudent ? (
          <section className="guardian-section" aria-labelledby="invite-title">
            <h2 id="invite-title">보호자 초대</h2>
            <p>보호자가 가입한 이메일 주소로 일회용 초대를 만듭니다.</p>
            <form className="auth-form" onSubmit={(event) => { event.preventDefault(); createMutation.mutate(); }}>
              <label>보호자 이메일<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
              <button type="submit" disabled={createMutation.isPending}>초대 만들기</button>
            </form>
            {createMutation.data?.developmentToken ? (
              <div className="invitation-result" role="status">
                <strong>개발용 초대 토큰</strong>
                <code>{createMutation.data.developmentToken}</code>
                <Link to={`/guardian?token=${encodeURIComponent(createMutation.data.developmentToken)}`}>초대 확인 화면 열기</Link>
              </div>
            ) : null}
          </section>
        ) : null}

        <section className="guardian-section" aria-labelledby="accept-title">
          <h2 id="accept-title">초대 확인</h2>
          <form className="token-form" onSubmit={openInvitation}>
            <label>초대 토큰<input value={tokenInput} onChange={(event) => setTokenInput(event.target.value)} required /></label>
            <button type="submit">확인</button>
          </form>
          {invitationQuery.data ? (
            <div className="invitation-preview">
              <p><strong>{invitationQuery.data.student.displayName}</strong> 학생의 보호자 초대입니다.</p>
              <p>초대 이메일: {invitationQuery.data.inviteeEmail}</p>
              <p>만료: {new Date(invitationQuery.data.expiresAt).toLocaleString('ko-KR')}</p>
              {isGuardian ? (
                <>
                  <label className="consent-check">
                    <input type="checkbox" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} />
                    학생의 학습 진도와 학습 리포트 조회에 동의합니다.
                  </label>
                  <button type="button" disabled={!agreed || acceptMutation.isPending} onClick={() => acceptMutation.mutate()}>
                    보호자로 연결하기
                  </button>
                </>
              ) : <p>초대를 수락하려면 보호자 역할 계정으로 로그인해야 합니다.</p>}
            </div>
          ) : null}
        </section>

        {isGuardian ? (
          <section className="guardian-section" aria-labelledby="students-title">
            <h2 id="students-title">연결된 학생</h2>
            {studentsQuery.data?.students.length ? (
              <ul className="student-links">
                {studentsQuery.data.students.map((link) => (
                  <li key={link.id}>
                    <span><strong>{link.student.displayName}</strong><small>연결됨</small></span>
                    <span className="student-link-actions">
                      <button
                        type="button"
                        aria-pressed={selectedStudentId === link.student.id}
                        onClick={() => setSelectedStudentId(link.student.id)}
                      >학습 리포트</button>
                      <button type="button" className="secondary" disabled={revokeMutation.isPending} onClick={() => revokeMutation.mutate(link.id)}>연결 해제</button>
                    </span>
                  </li>
                ))}
              </ul>
            ) : <p>현재 연결된 학생이 없습니다.</p>}
          </section>
        ) : null}

        {isGuardian && selectedStudentId ? (
          <section className="guardian-section guardian-report" aria-labelledby="guardian-report-title">
            {reportQuery.isLoading ? <p role="status">학생 학습 리포트를 불러오고 있습니다.</p> : null}
            {reportQuery.data ? (
              <>
                <div className="guardian-report-heading">
                  <div>
                    <p className="react-stack-eyebrow">LEARNING REPORT</p>
                    <h2 id="guardian-report-title">{reportQuery.data.student.displayName} 학생의 학습 리포트</h2>
                  </div>
                  <small>{new Date(reportQuery.data.generatedAt).toLocaleString('ko-KR')} 기준</small>
                </div>
                <div className="guardian-report-summary">
                  <div><span>완료 강의</span><strong>{reportQuery.data.summary.completedLessons} / {reportQuery.data.summary.totalLessons}</strong></div>
                  <div><span>시작한 강의</span><strong>{reportQuery.data.summary.startedLessons}개</strong></div>
                  <div><span>완료 단계</span><strong>{reportQuery.data.summary.completedSteps} / {reportQuery.data.summary.totalSteps}</strong></div>
                  <div><span>최근 학습</span><strong>{reportQuery.data.summary.lastActivityAt ? new Date(reportQuery.data.summary.lastActivityAt).toLocaleDateString('ko-KR') : '아직 없음'}</strong></div>
                </div>
                <div className="guardian-progress-overview">
                  <span><strong>전체 단계 진행률</strong><b>{reportQuery.data.summary.stepCompletionRate}%</b></span>
                  <progress max="100" value={reportQuery.data.summary.stepCompletionRate}>{reportQuery.data.summary.stepCompletionRate}%</progress>
                </div>
                {reportQuery.data.items.length ? (
                  <ul className="guardian-lesson-progress">
                    {reportQuery.data.items.map((item) => (
                      <li key={item.lesson.id} data-status={item.progress.status}>
                        <div>
                          <small>{item.lesson.era.name} · {item.lesson.order}강</small>
                          <strong>{item.lesson.title}</strong>
                          <span>{item.lesson.course} · {item.lesson.durationMinutes}분</span>
                        </div>
                        <div>
                          <b>{item.progress.status === 'completed' ? '완료' : item.progress.status === 'in_progress' ? '학습 중' : '미시작'}</b>
                          <span>{item.progress.completedSteps} / {item.progress.totalSteps}단계</span>
                          {item.progress.lastActivityAt ? <small>{new Date(item.progress.lastActivityAt).toLocaleDateString('ko-KR')}</small> : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : <p>현재 공개된 강의가 없습니다.</p>}
              </>
            ) : null}
          </section>
        ) : null}

        {error ? <p className="auth-error" role="alert">{error.message}{error.requestId ? ` (요청 ID: ${error.requestId})` : ''}</p> : null}
      </section>
    </main>
  );
}
