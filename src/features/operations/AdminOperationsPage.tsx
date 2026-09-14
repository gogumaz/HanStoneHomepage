import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { getCurrentUser } from '../auth/api';
import { ApiClientError } from '../../lib/api-client';
import { getWorkerHealth, type WorkerQueueHealth } from './api';

const QUEUE_LABELS: Record<WorkerQueueHealth['name'], string> = {
  accountMail: '계정 인증·복구 메일',
  inquiryNotification: '문의 답변 알림',
  videoScan: '영상 안전 검사',
  hlsTranscode: 'HLS 영상 변환',
  objectDeletion: '보관 파일 삭제',
};

const STATUS_LABELS = {
  healthy: '정상',
  attention: '확인 필요',
  critical: '즉시 확인',
} as const;

function formatDate(value: string | null) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'medium', hourCycle: 'h23',
  }).format(new Date(value));
}

function formatBytes(value: number | null) {
  if (value === null) return '-';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let amount = value;
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024;
    unit += 1;
  }
  return `${amount.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export function AdminOperationsPage() {
  const meQuery = useQuery({ queryKey: ['current-user'], queryFn: getCurrentUser, retry: false });
  const canManage = meQuery.data?.roles.some((role) => role === 'operator' || role === 'admin') ?? false;
  const healthQuery = useQuery({
    queryKey: ['admin-worker-health'],
    queryFn: getWorkerHealth,
    enabled: canManage,
    retry: false,
    refetchInterval: 30_000,
  });
  const error = healthQuery.error instanceof ApiClientError ? healthQuery.error : null;

  return (
    <main className="catalog-page admin-operations-page">
      <header className="catalog-header">
        <Link className="back-link" to="/">← 개발 현황으로</Link>
        <p className="react-stack-eyebrow">WORKER RECOVERY</p>
        <h1>운영 워커 상태</h1>
        <p>메일·영상·파일 작업의 적체와 오래된 잠금을 확인하고 장애 복구 시점을 판단합니다.</p>
      </header>

      {meQuery.isLoading ? <p role="status">운영 권한을 확인하고 있습니다.</p> : null}
      {!meQuery.isLoading && !canManage ? (
        <section className="subscription-callout">
          <h2>운영자 권한이 필요합니다.</h2>
          <p>내부 작업 큐 상태는 운영자 또는 관리자만 확인할 수 있습니다.</p>
          <Link to="/account">계정 확인</Link>
        </section>
      ) : null}

      {canManage && healthQuery.isLoading ? <p role="status">워커 상태를 조회하고 있습니다.</p> : null}
      {error ? <p className="auth-error" role="alert">{error.message}</p> : null}

      {canManage && healthQuery.data ? (
        <>
          <section className="worker-health-summary" data-status={healthQuery.data.status} aria-live="polite">
            <div>
              <span>전체 상태</span>
              <h2>{STATUS_LABELS[healthQuery.data.status]}</h2>
              <p>{healthQuery.data.status === 'healthy'
                ? '모든 영속 작업 큐가 정상 범위입니다.'
                : healthQuery.data.status === 'critical'
                  ? '장시간 적체 또는 오래된 잠금이 있습니다. 해당 워커를 즉시 확인하세요.'
                  : '처리 대기 또는 최종 실패 작업이 있습니다.'}</p>
            </div>
            <div className="worker-health-actions">
              <small>{formatDate(healthQuery.data.checkedAt)} 확인</small>
              <small>위험 적체 기준 {healthQuery.data.backlogThresholdMinutes}분</small>
              <button type="button" onClick={() => healthQuery.refetch()} disabled={healthQuery.isFetching}>
                {healthQuery.isFetching ? '새로고침 중…' : '상태 새로고침'}
              </button>
            </div>
          </section>

          <section className="worker-queue-grid" aria-label="로컬 영상 저장소 상태">
            <article data-status={healthQuery.data.localVideoStorage.status === 'disabled'
              ? 'healthy'
              : healthQuery.data.localVideoStorage.status}>
              <header>
                <h2>로컬 영상 저장소</h2>
                <strong>{healthQuery.data.localVideoStorage.status === 'disabled'
                  ? '사용 안 함'
                  : STATUS_LABELS[healthQuery.data.localVideoStorage.status]}</strong>
              </header>
              {healthQuery.data.localVideoStorage.enabled ? (
                <dl>
                  <div><dt>정상 영상</dt><dd>{healthQuery.data.localVideoStorage.fileCount}개</dd></div>
                  <div><dt>영상 사용량</dt><dd>{formatBytes(healthQuery.data.localVideoStorage.totalVideoBytes)}</dd></div>
                  <div><dt>디스크 여유</dt><dd>{formatBytes(healthQuery.data.localVideoStorage.availableBytes)}</dd></div>
                  <div><dt>디스크 사용률</dt><dd>{healthQuery.data.localVideoStorage.usedPercent ?? '-'}%</dd></div>
                  <div><dt>잘못된 파일</dt><dd>{healthQuery.data.localVideoStorage.invalidEntries}개</dd></div>
                  <div><dt>경고 / 위험 기준</dt><dd>{formatBytes(healthQuery.data.localVideoStorage.warningFreeBytes)} / {formatBytes(healthQuery.data.localVideoStorage.criticalFreeBytes)}</dd></div>
                </dl>
              ) : <p>현재 로컬 다운로드 영상 모드를 사용하지 않습니다.</p>}
            </article>
          </section>

          <section className="worker-queue-grid" aria-label="작업 큐 상태">
            {healthQuery.data.queues.map((queue) => (
              <article key={queue.name} data-status={queue.status}>
                <header>
                  <h2>{QUEUE_LABELS[queue.name]}</h2>
                  <strong>{STATUS_LABELS[queue.status]}</strong>
                </header>
                <dl>
                  <div><dt>처리 대기</dt><dd>{queue.due}건</dd></div>
                  <div><dt>오래된 잠금</dt><dd>{queue.staleLocks}건</dd></div>
                  <div><dt>최종 실패</dt><dd>{queue.terminalErrors}건</dd></div>
                  <div><dt>가장 오래된 대기</dt><dd>{formatDate(queue.oldestDueAt)}</dd></div>
                </dl>
              </article>
            ))}
          </section>
        </>
      ) : null}
    </main>
  );
}
