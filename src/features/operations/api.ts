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
  localVideoStorage: {
    enabled: boolean;
    status: 'disabled' | 'healthy' | 'attention' | 'critical';
    fileCount: number;
    totalVideoBytes: number;
    capacityBytes: number | null;
    availableBytes: number | null;
    usedPercent: number | null;
    invalidEntries: number;
    warningFreeBytes: number;
    criticalFreeBytes: number;
  };
};

export async function getWorkerHealth(): Promise<WorkerHealthReport> {
  const report = await apiRequest<Omit<WorkerHealthReport, 'localVideoStorage'> & {
    localVideoStorage?: WorkerHealthReport['localVideoStorage'];
  }>('/admin/operations/worker-health');
  return {
    ...report,
    localVideoStorage: report.localVideoStorage ?? {
      enabled: false,
      status: 'disabled',
      fileCount: 0,
      totalVideoBytes: 0,
      capacityBytes: null,
      availableBytes: null,
      usedPercent: null,
      invalidEntries: 0,
      warningFreeBytes: 0,
      criticalFreeBytes: 0,
    },
  };
}
