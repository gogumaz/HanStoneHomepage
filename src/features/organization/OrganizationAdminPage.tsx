import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getCurrentUser } from '../auth/api';
import { ApiClientError } from '../../lib/api-client';
import {
  addOrganizationMember,
  assignClassInstructor,
  createManagedClass,
  enrollClassStudent,
  getOrganizationAdminContext,
  getOrganizationManagement,
  listManagedOrganizationClasses,
  listOrganizationInstructors,
  unassignClassInstructor,
  unenrollClassStudent,
  updateManagedClass,
  updateOrganizationMember,
  updateOrganizationSeatLimit,
} from './api';

function errorMessage(error: unknown): string {
  return error instanceof ApiClientError ? error.message : '기관 관리 요청을 처리하지 못했습니다.';
}

export function OrganizationAdminPage() {
  const client = useQueryClient();
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [className, setClassName] = useState('');
  const [academicYear, setAcademicYear] = useState(new Date().getFullYear());
  const [studentEmails, setStudentEmails] = useState<Record<string, string>>({});
  const [instructorChoices, setInstructorChoices] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState('');
  const [memberEmail, setMemberEmail] = useState('');
  const [memberRole, setMemberRole] = useState<'instructor' | 'admin'>('instructor');
  const [seatLimitInput, setSeatLimitInput] = useState('');
  const meQuery = useQuery({ queryKey: ['current-user'], queryFn: getCurrentUser, retry: false });
  const canManage = meQuery.data?.roles.includes('organization_admin') ?? false;
  const contextQuery = useQuery({ queryKey: ['organization-admin-context'], queryFn: getOrganizationAdminContext, enabled: canManage, retry: false });
  const selectedOrganizationId = contextQuery.data?.items.some((item) => item.organization.id === organizationId)
    ? organizationId
    : contextQuery.data?.items[0]?.organization.id ?? null;
  useEffect(() => { setNotice(''); }, [selectedOrganizationId]);
  const classesQuery = useQuery({
    queryKey: ['organization-admin-classes', selectedOrganizationId],
    queryFn: () => listManagedOrganizationClasses(selectedOrganizationId ?? ''),
    enabled: Boolean(canManage && selectedOrganizationId),
    retry: false,
  });
  const instructorsQuery = useQuery({
    queryKey: ['organization-admin-instructors', selectedOrganizationId],
    queryFn: () => listOrganizationInstructors(selectedOrganizationId ?? ''),
    enabled: Boolean(canManage && selectedOrganizationId),
    retry: false,
  });
  const managementQuery = useQuery({
    queryKey: ['organization-management', selectedOrganizationId],
    queryFn: () => getOrganizationManagement(selectedOrganizationId ?? ''),
    enabled: Boolean(canManage && selectedOrganizationId),
    retry: false,
  });
  useEffect(() => {
    if (managementQuery.data) setSeatLimitInput(managementQuery.data.organization.seatLimit?.toString() ?? '');
  }, [managementQuery.data]);
  const refresh = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ['organization-admin-classes', selectedOrganizationId] }),
      client.invalidateQueries({ queryKey: ['organization-admin-instructors', selectedOrganizationId] }),
      client.invalidateQueries({ queryKey: ['organization-management', selectedOrganizationId] }),
    ]);
  };
  const createClass = useMutation({
    mutationFn: () => createManagedClass(selectedOrganizationId ?? '', className, academicYear),
    onSuccess: async () => { setClassName(''); setNotice('새 학급을 만들었습니다.'); await refresh(); },
  });
  const archiveClass = useMutation({ mutationFn: (classId: string) => updateManagedClass(classId, { status: 'archived' }), onSuccess: async () => { setNotice('학급을 보관하고 현재 배정·등록을 종료했습니다.'); await refresh(); } });
  const assignInstructor = useMutation({ mutationFn: ({ classId, membershipId }: { classId: string; membershipId: string }) => assignClassInstructor(classId, membershipId), onSuccess: async () => { setNotice('지도자를 학급에 배정했습니다.'); await refresh(); } });
  const unassignInstructor = useMutation({ mutationFn: ({ classId, membershipId }: { classId: string; membershipId: string }) => unassignClassInstructor(classId, membershipId), onSuccess: async () => { setNotice('지도자 배정을 종료했습니다.'); await refresh(); } });
  const enrollStudent = useMutation({ mutationFn: ({ classId, email }: { classId: string; email: string }) => enrollClassStudent(classId, email), onSuccess: async (_result, variables) => { setStudentEmails((current) => ({ ...current, [variables.classId]: '' })); setNotice('학생을 학급에 등록했습니다.'); await refresh(); } });
  const unenrollStudent = useMutation({ mutationFn: ({ classId, studentId }: { classId: string; studentId: string }) => unenrollClassStudent(classId, studentId), onSuccess: async () => { setNotice('학생의 학급 등록을 종료했습니다.'); await refresh(); } });
  const saveSeatLimit = useMutation({
    mutationFn: () => updateOrganizationSeatLimit(selectedOrganizationId ?? '', seatLimitInput.trim() ? Number(seatLimitInput) : null),
    onSuccess: async () => { setNotice('기관 좌석 한도를 저장했습니다.'); await refresh(); },
  });
  const addMember = useMutation({
    mutationFn: () => addOrganizationMember(selectedOrganizationId ?? '', memberEmail, memberRole),
    onSuccess: async () => { setMemberEmail(''); setNotice('기존 계정을 기관 구성원으로 등록했습니다.'); await refresh(); },
  });
  const changeMember = useMutation({
    mutationFn: ({ membershipId, status }: { membershipId: string; status: 'active' | 'suspended' }) => updateOrganizationMember(selectedOrganizationId ?? '', membershipId, { status }),
    onSuccess: async () => { setNotice('구성원 상태를 변경했습니다.'); await refresh(); },
  });
  const errors = [contextQuery.error, classesQuery.error, instructorsQuery.error, managementQuery.error, createClass.error, archiveClass.error, assignInstructor.error, unassignInstructor.error, enrollStudent.error, unenrollStudent.error, saveSeatLimit.error, addMember.error, changeMember.error];
  const error = errors.find(Boolean);

  if (meQuery.isLoading) return <main className="react-stack-page"><p role="status">기관 관리자 권한을 확인하고 있습니다…</p></main>;
  if (!canManage) return <main className="react-stack-page"><section className="react-stack-card" role="alert"><h1>기관 관리 권한이 없습니다.</h1><p>일반 지도자는 기관·학급·배정 관리 메뉴를 이용할 수 없습니다.</p></section></main>;

  function submitClass(event: FormEvent) {
    event.preventDefault();
    setNotice('');
    createClass.mutate();
  }

  return <main className="organization-admin-page">
    <header className="teacher-page-header"><div><p className="react-stack-eyebrow">ORGANIZATION ADMIN</p><h1>기관·학급·배정 관리</h1><p>활성 기관 관리자 멤버십 범위에서 학급, 지도자 배정과 학생 등록을 관리합니다.</p></div></header>
    {contextQuery.data && contextQuery.data.items.length > 1 ? <nav className="organization-tabs" aria-label="관리 기관 선택">{contextQuery.data.items.map((item) => <button type="button" key={item.membershipId} aria-pressed={selectedOrganizationId === item.organization.id} onClick={() => setOrganizationId(item.organization.id)}>{item.organization.name}</button>)}</nav> : null}
    {contextQuery.isLoading ? <p role="status">기관 권한을 불러오고 있습니다…</p> : null}
    {error ? <p className="auth-error" role="alert">{errorMessage(error)}</p> : null}
    {notice ? <p className="teacher-progress-success" role="status">{notice}</p> : null}
    {selectedOrganizationId ? <>
      <section className="organization-settings-grid" aria-label="기관 구성원 및 좌석 관리">
        <article><h2>학생 좌석</h2><p>현재 <strong>{managementQuery.data?.organization.usedSeats ?? 0}석</strong> 사용 중입니다. 비워 두면 무제한입니다.</p><form onSubmit={(event) => { event.preventDefault(); saveSeatLimit.mutate(); }}><label>좌석 한도<input type="number" min="1" max="100000" placeholder="무제한" value={seatLimitInput} onChange={(event) => setSeatLimitInput(event.target.value)} /></label><button type="submit" disabled={saveSeatLimit.isPending}>한도 저장</button></form></article>
        <article><h2>구성원 등록</h2><p>가입 및 역할 인증이 끝난 계정을 이메일로 기관에 추가합니다.</p><form onSubmit={(event) => { event.preventDefault(); addMember.mutate(); }}><label>계정 이메일<input type="email" required value={memberEmail} onChange={(event) => setMemberEmail(event.target.value)} /></label><label>역할<select value={memberRole} onChange={(event) => setMemberRole(event.target.value as 'instructor' | 'admin')}><option value="instructor">지도자</option><option value="admin">기관 관리자</option></select></label><button type="submit" disabled={addMember.isPending}>구성원 등록</button></form></article>
      </section>
      <section className="organization-member-management" aria-labelledby="organization-members-title"><div className="teacher-section-heading"><div><h2 id="organization-members-title">기관 구성원</h2><p>중지한 지도자의 현재 학급 배정은 즉시 종료됩니다.</p></div><strong>{managementQuery.data?.members.length ?? 0}명</strong></div><ul>{managementQuery.data?.members.map((member) => <li key={member.membershipId}><div><strong>{member.user.displayName}</strong><span>{member.user.email} · {member.role === 'admin' ? '기관 관리자' : '지도자'} · {member.status === 'active' ? '활성' : member.status === 'suspended' ? '중지' : '종료'}</span></div><button type="button" className="secondary" disabled={changeMember.isPending} onClick={() => changeMember.mutate({ membershipId: member.membershipId, status: member.status === 'active' ? 'suspended' : 'active' })}>{member.status === 'active' ? '이용 중지' : '다시 활성화'}</button></li>)}</ul></section>
      <section className="organization-create-class" aria-labelledby="organization-create-title"><h2 id="organization-create-title">새 학급 만들기</h2><form onSubmit={submitClass}><label>학급 이름<input required maxLength={100} value={className} onChange={(event) => setClassName(event.target.value)} /></label><label>학년도<input type="number" min="2000" max="2200" required value={academicYear} onChange={(event) => setAcademicYear(Number(event.target.value))} /></label><button type="submit" disabled={createClass.isPending}>학급 생성</button></form></section>
      <section className="organization-class-management" aria-labelledby="organization-classes-title"><div className="teacher-section-heading"><div><h2 id="organization-classes-title">학급 현황</h2><p>보관된 학급의 배정과 재학 상태는 자동 종료됩니다.</p></div><strong>{classesQuery.data?.items.length ?? 0}개</strong></div>
        {classesQuery.isLoading ? <p role="status">학급 정보를 불러오고 있습니다…</p> : null}
        {classesQuery.data?.items.map((item) => {
          const activeTeachers = item.teachers.filter((teacher) => teacher.active);
          const activeStudents = item.students.filter((student) => student.active);
          const assignedIds = new Set(activeTeachers.map((teacher) => teacher.membershipId));
          const availableInstructors = instructorsQuery.data?.items.filter((instructor) => !assignedIds.has(instructor.membershipId)) ?? [];
          return <article key={item.id} data-status={item.status}>
            <header><div><span>{item.status === 'active' ? '운영 중' : '보관됨'}</span><h3>{item.name}</h3><p>{item.academicYear}학년도 · 지도자 {activeTeachers.length}명 · 학생 {activeStudents.length}명</p></div>{item.status === 'active' ? <button type="button" className="secondary" disabled={archiveClass.isPending} onClick={() => archiveClass.mutate(item.id)}>학급 보관</button> : null}</header>
            <section><h4>지도자 배정</h4>{activeTeachers.length ? <ul>{activeTeachers.map((teacher) => <li key={teacher.assignmentId}><span>{teacher.instructor.displayName}</span><button type="button" disabled={unassignInstructor.isPending} onClick={() => unassignInstructor.mutate({ classId: item.id, membershipId: teacher.membershipId })}>배정 종료</button></li>)}</ul> : <p>현재 배정된 지도자가 없습니다.</p>}
              {item.status === 'active' && availableInstructors.length ? <form onSubmit={(event) => { event.preventDefault(); const membershipId = instructorChoices[item.id] || availableInstructors[0]?.membershipId; if (membershipId) assignInstructor.mutate({ classId: item.id, membershipId }); }}><select aria-label={`${item.name} 지도자 선택`} value={instructorChoices[item.id] ?? ''} onChange={(event) => setInstructorChoices((current) => ({ ...current, [item.id]: event.target.value }))}><option value="">지도자 선택</option>{availableInstructors.map((instructor) => <option key={instructor.membershipId} value={instructor.membershipId}>{instructor.user.displayName}</option>)}</select><button type="submit" disabled={assignInstructor.isPending}>배정</button></form> : null}
            </section>
            <section><h4>학생 등록</h4>{activeStudents.length ? <ul>{activeStudents.map((student) => <li key={student.enrollmentId}><span>{student.student.displayName}</span><button type="button" disabled={unenrollStudent.isPending} onClick={() => unenrollStudent.mutate({ classId: item.id, studentId: student.student.id })}>퇴실</button></li>)}</ul> : <p>현재 등록된 학생이 없습니다.</p>}
              {item.status === 'active' ? <form onSubmit={(event) => { event.preventDefault(); const email = studentEmails[item.id]?.trim(); if (email) enrollStudent.mutate({ classId: item.id, email }); }}><label className="sr-only" htmlFor={`student-email-${item.id}`}>학생 이메일</label><input id={`student-email-${item.id}`} type="email" placeholder="학생 계정 이메일" value={studentEmails[item.id] ?? ''} onChange={(event) => setStudentEmails((current) => ({ ...current, [item.id]: event.target.value }))} required /><button type="submit" disabled={enrollStudent.isPending}>학생 등록</button></form> : null}
            </section>
          </article>;
        })}
      </section>
    </> : null}
  </main>;
}
