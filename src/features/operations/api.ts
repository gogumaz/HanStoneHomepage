import { apiRequest } from '../../lib/api-client';

export type WorkerQueueHealth = {
  name: 'accountMail' | 'inquiryNotification' | 'videoScan' | 'hlsTranscode' | 'objectDeletion';
  status: 'healthy' | 'attention' | 'critical';
  due: number;
  staleLocks: number;
  terminalErrors: number;
  oldestDueAt: string | null;
};

export type WorkerHealthReport = {
  status: 'healthy' | 'attention' | 'critical';
  checkedAt: string;
  backlogThresholdMinutes: number;
  queues: WorkerQueueHealth[];
};

export function getWorkerHealth() {
  return apiRequest<WorkerHealthReport>('/admin/operations/worker-health');
}
