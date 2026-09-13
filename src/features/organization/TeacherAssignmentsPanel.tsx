import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiClientError } from '../../lib/api-client';
import {
  cancelClassAssignment,
  createClassAssignment,
  downloadClassAssignmentResults,
  getClassAssignmentOptions,
  getClassAssignmentResults,
  getTeacherClassAssignment,
  listClassAssignments,
  publishClassAssignment,
  reassignClassAssignment,
  updateClassAssignment,
  updateClassAssignmentComment,
} from './api';

const statusLabels = { draft: '초안', published: '배포됨', canceled: '취소됨' } as const;
const progressLabels = { not_started: '미시작', in_progress: '진행 중', completed: '완료' } as const;

function localDateTime(days = 7): string {
  const value = new Date(Date.now() + days * 24 * 60 * 60_000);
  value.setMinutes(value.getMinutes() - value.getTimezoneOffset());
  return value.toISOString().slice(0, 16);
}

function message(error: unknown): string {
  return error instanceof ApiClientError ? error.message : '요청을 처리하지 못했습니다.';
}

export function TeacherAssignmentsPanel({ classId }: { classId: string }) {
  const client = useQueryClient();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueAt, setDueAt] = useState(localDateTime());
  const [selectedResources, setSelectedResources] = useState<string[]>([]);
  const [targetStudentIds, setTargetStudentIds] = useState<string[] | null>(null);
  const [resultsId, setResultsId] = useState<string | null>(null);
  const [comments, setComments] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    setSelectedResources([]);
    setTargetStudentIds(null);
    setResultsId(null);
    setNotice('');
    setEditingId(null);
  }, [classId]);

  const options = useQuery({
    queryKey: ['class-assignment-options', classId],
    queryFn: () => getClassAssignmentOptions(classId),
    retry: false,
  });
  const assignments = useQuery({
    queryKey: ['class-assignments', classId],
    queryFn: () => listClassAssignments(classId),
    retry: false,
  });
  const results = useQuery({
    queryKey: ['class-assignment-results', resultsId],
    queryFn: () => getClassAssignmentResults(resultsId ?? ''),
    enabled: Boolean(resultsId),
    retry: false,
  });

  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ['class-assignments', classId] });
    if (resultsId) await client.invalidateQueries({ queryKey: ['class-assignment-results', resultsId] });
  };
  const create = useMutation({
    mutationFn: () => createClassAssignment(classId, {
      title,
      description,
      dueAt: new Date(dueAt).toISOString(),
      items: selectedResources.map((value) => {
        const [type, ...parts] = value.split(':');
        return { type: type as 'lesson' | 'baduk_mission', resourceId: parts.join(':') };
      }),
      targetStudentIds: targetStudentIds ?? [],
    }),
    onSuccess: async () => {
      setTitle('');
      setDescription('');
      setSelectedResources([]);
      setTargetStudentIds(null);
      setNotice('과제 초안을 만들었습니다. 목록에서 확인 후 배포해 주세요.');
      await refresh();
    },
  });
  const update = useMutation({
    mutationFn: () => updateClassAssignment(editingId ?? '', {
      title,
      description,
      dueAt: new Date(dueAt).toISOString(),
      items: selectedResources.map((value) => {
        const [type, ...parts] = value.split(':');
        return { type: type as 'lesson' | 'baduk_mission', resourceId: parts.join(':') };
      }),
      targetStudentIds: targetStudentIds ?? [],
    }),
    onSuccess: async () => {
      resetForm();
      setNotice('과제 초안을 수정했습니다.');
      await refresh();
    },
  });
  const loadDraft = useMutation({
    mutationFn: getTeacherClassAssignment,
    onSuccess: ({ assignment }) => {
      setEditingId(assignment.id);
      setTitle(assignment.title);
      setDescription(assignment.description ?? '');
      const localDueAt = new Date(assignment.dueAt);
      localDueAt.setMinutes(localDueAt.getMinutes() - localDueAt.getTimezoneOffset());
      setDueAt(localDueAt.toISOString().slice(0, 16));
      setSelectedResources(assignment.items.map((item) => `${item.type}:${item.resource.id}`));
      setTargetStudentIds(assignment.targets.map((target) => target.student.id));
      setNotice('초안을 편집 중입니다. 수정 후 저장해 주세요.');
    },
  });
  const publish = useMutation({ mutationFn: publishClassAssignment, onSuccess: async () => { setNotice('과제를 학생에게 배포했습니다.'); await refresh(); } });
  const cancel = useMutation({ mutationFn: cancelClassAssignment, onSuccess: async () => { setNotice('과제를 취소하고 학생에게 알렸습니다.'); await refresh(); } });
  const comment = useMutation({
    mutationFn: ({ assignmentId, studentId, value }: { assignmentId: string; studentId: string; value: string }) => updateClassAssignmentComment(assignmentId, studentId, value),
    onSuccess: async () => { setNotice('지도자 코멘트를 저장했습니다.'); await refresh(); },
  });
  const reassign = useMutation({
    mutationFn: ({ assignmentId, studentId }: { assignmentId: string; studentId: string }) => reassignClassAssignment(
      assignmentId,
      [studentId],
      new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString(),
    ),
    onSuccess: async () => { setNotice('선택한 학생에게 7일 기한의 재과제를 배포했습니다.'); await refresh(); },
  });
  const download = useMutation({
    mutationFn: downloadClassAssignmentResults,
    onSuccess: ({ blob, filename }) => {
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename ?? 'class-assignment-results.csv';
      anchor.click();
      URL.revokeObjectURL(url);
    },
  });

  const resources = useMemo(() => [
    ...(options.data?.lessons ?? []).map((item) => ({ key: `lesson:${item.id}`, label: `강의 · ${item.era.name} · ${item.title}` })),
    ...(options.data?.missions ?? []).map((item) => ({ key: `baduk_mission:${item.id}`, label: `바둑미션 · ${item.boardSize}줄 · ${item.title}` })),
  ], [options.data]);
  const errors = [options.error, assignments.error, results.error, create.error, update.error, loadDraft.error, publish.error, cancel.error, comment.error, reassign.error, download.error];
  const error = errors.find(Boolean);

  function submit(event: FormEvent) {
    event.preventDefault();
    setNotice('');
    if (!selectedResources.length) return setNotice('강의 또는 바둑미션을 한 개 이상 선택해 주세요.');
    if (editingId) update.mutate();
    else create.mutate();
  }

  function resetForm() {
    setEditingId(null);
    setTitle('');
    setDescription('');
    setDueAt(localDateTime());
    setSelectedResources([]);
    setTargetStudentIds(null);
  }

  return (
    <section className="teacher-assignment-panel" aria-labelledby="teacher-assignment-title">
      <div className="teacher-section-heading">
        <div><p className="react-stack-eyebrow">CLASS ASSIGNMENTS</p><h3 id="teacher-assignment-title">반별 과제</h3></div>
        <strong>{assignments.data?.items.length ?? 0}개</strong>
      </div>
      <form className="teacher-assignment-form" onSubmit={submit}>
        <label>과제 제목<input required maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
        <label>마감일<input type="datetime-local" required value={dueAt} onChange={(event) => setDueAt(event.target.value)} /></label>
        <label className="wide">과제 설명<textarea maxLength={1000} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
        <fieldset className="wide"><legend>강의·바둑미션 선택</legend>
          {options.isLoading ? <p role="status">과제 항목을 불러오고 있습니다…</p> : null}
          <div className="teacher-assignment-checks">{resources.map((resource) => <label key={resource.key}>
            <input type="checkbox" checked={selectedResources.includes(resource.key)} onChange={(event) => setSelectedResources((current) => event.target.checked ? [...current, resource.key] : current.filter((key) => key !== resource.key))} />
            {resource.label}
          </label>)}</div>
        </fieldset>
        <fieldset className="wide"><legend>대상 학생</legend><p>선택하지 않으면 재학 중인 전체 학생에게 배포됩니다.</p>
          <div className="teacher-assignment-checks">{options.data?.students.map((student) => <label key={student.id}>
            <input type="checkbox" checked={targetStudentIds === null || targetStudentIds.includes(student.id)} onChange={(event) => {
              const current = targetStudentIds ?? options.data?.students.map((item) => item.id) ?? [];
              setTargetStudentIds(event.target.checked ? [...new Set([...current, student.id])] : current.filter((id) => id !== student.id));
            }} />
            {student.displayName}
          </label>)}</div>
        </fieldset>
        <div className="teacher-assignment-form-actions"><button type="submit" disabled={create.isPending || update.isPending || !title || !dueAt}>{create.isPending || update.isPending ? '저장 중…' : editingId ? '초안 수정 저장' : '과제 초안 만들기'}</button>{editingId ? <button type="button" className="secondary" onClick={() => { resetForm(); setNotice('초안 편집을 취소했습니다.'); }}>편집 취소</button> : null}</div>
      </form>
      {notice ? <p className="teacher-progress-success" role="status">{notice}</p> : null}
      {error ? <p className="auth-error" role="alert">{message(error)}</p> : null}

      <div className="teacher-assignment-list">
        {assignments.isLoading ? <p role="status">과제 목록을 불러오고 있습니다…</p> : null}
        {assignments.data?.items.map((item) => <article key={item.id} data-status={item.status}>
          <div><span>{statusLabels[item.status]}</span><h4>{item.title}</h4><p>{new Date(item.dueAt).toLocaleString('ko-KR')} 마감 · {item.itemCount}개 항목 · {item.targetCount}명</p></div>
          <div className="teacher-assignment-actions">
            {item.status === 'draft' ? <><button type="button" className="secondary" disabled={loadDraft.isPending} onClick={() => loadDraft.mutate(item.id)}>초안 수정</button><button type="button" disabled={publish.isPending} onClick={() => publish.mutate(item.id)}>배포</button></> : null}
            {item.status === 'published' ? <><button type="button" onClick={() => setResultsId(item.id)}>결과 보기</button><button type="button" className="secondary" disabled={cancel.isPending} onClick={() => cancel.mutate(item.id)}>취소</button></> : null}
          </div>
        </article>)}
      </div>

      {results.data ? <section className="teacher-assignment-results" aria-labelledby="assignment-results-title">
        <div className="teacher-section-heading"><div><h3 id="assignment-results-title">{results.data.assignment.title} 결과</h3><p>완료율과 학생별 수행 상태를 실시간 학습기록으로 집계합니다.</p></div><button type="button" disabled={download.isPending} onClick={() => download.mutate(results.data.assignment.id)}>CSV 내려받기</button></div>
        <div className="teacher-assignment-summary"><span>완료율 <strong>{results.data.summary.completionRate}%</strong></span><span>완료 <strong>{results.data.summary.completedStudents}명</strong></span><span>진행 중 <strong>{results.data.summary.inProgressStudents}명</strong></span><span>미제출 <strong>{results.data.summary.notStartedStudents}명</strong></span><span>마감 초과 <strong>{results.data.summary.overdueStudents}명</strong></span></div>
        <ul className="teacher-assignment-item-stats">{results.data.itemStatistics.map((item) => <li key={item.id}><strong>{item.resource.title}</strong><span>{item.type === 'baduk_mission' ? `정답률 ${item.correctnessRate}%` : `완료율 ${item.completionRate}%`}</span></li>)}</ul>
        <div className="teacher-assignment-students">{results.data.students.map((student) => <article key={student.student.id}>
          <div><strong>{student.student.displayName}</strong><span>{progressLabels[student.status]} · {student.completedItems}/{student.totalItems}{student.isLate ? ' · 마감 초과' : ''}</span></div>
          <label>지도자 코멘트<input maxLength={1000} value={comments[student.student.id] ?? student.teacherComment ?? ''} onChange={(event) => setComments((current) => ({ ...current, [student.student.id]: event.target.value }))} /></label>
          <div><button type="button" disabled={comment.isPending} onClick={() => comment.mutate({ assignmentId: results.data.assignment.id, studentId: student.student.id, value: comments[student.student.id] ?? student.teacherComment ?? '' })}>코멘트 저장</button>{student.status !== 'completed' ? <button type="button" className="secondary" disabled={reassign.isPending} onClick={() => reassign.mutate({ assignmentId: results.data.assignment.id, studentId: student.student.id })}>7일 재과제</button> : null}</div>
        </article>)}</div>
      </section> : null}
    </section>
  );
}
