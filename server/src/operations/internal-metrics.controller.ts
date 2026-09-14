import { Controller, Get, Header, Res, UseGuards } from "@nestjs/common";
import { MetricsTokenGuard } from "./metrics-token.guard.js";
import { WorkerHealthService, type WorkerHealthReport } from "./worker-health.service.js";
import { loadReleaseIdentity, type ReleaseIdentity } from "./release-identity.js";

type TextResponse = {
  setHeader(name: string, value: string): void;
  send(body: string): void;
};

const QUEUE_NAMES = {
  accountMail: "account_mail",
  inquiryNotification: "inquiry_notification",
  videoScan: "video_scan",
  hlsTranscode: "hls_transcode",
  objectDeletion: "object_deletion",
} as const;

const STATUS_VALUES = { healthy: 0, attention: 1, critical: 2 } as const;
const STORAGE_STATUS_VALUES = { disabled: -1, healthy: 0, attention: 1, critical: 2 } as const;

export function formatWorkerHealthMetrics(report: WorkerHealthReport): string {
  const lines = [
    "# HELP baduk_worker_health_status Overall worker health: 0 healthy, 1 attention, 2 critical.",
    "# TYPE baduk_worker_health_status gauge",
    `baduk_worker_health_status ${STATUS_VALUES[report.status]}`,
    "# HELP baduk_worker_queue_due Jobs whose processing time has arrived.",
    "# TYPE baduk_worker_queue_due gauge",
  ];
  for (const queue of report.queues) {
    const label = QUEUE_NAMES[queue.name];
    lines.push(`baduk_worker_queue_due{queue="${label}"} ${queue.due}`);
  }
  lines.push(
    "# HELP baduk_worker_queue_stale_locks Jobs whose processing lock has expired.",
    "# TYPE baduk_worker_queue_stale_locks gauge",
  );
  for (const queue of report.queues) {
    lines.push(`baduk_worker_queue_stale_locks{queue="${QUEUE_NAMES[queue.name]}"} ${queue.staleLocks}`);
  }
  lines.push(
    "# HELP baduk_worker_queue_terminal_errors Jobs that exhausted automatic retries.",
    "# TYPE baduk_worker_queue_terminal_errors gauge",
  );
  for (const queue of report.queues) {
    lines.push(`baduk_worker_queue_terminal_errors{queue="${QUEUE_NAMES[queue.name]}"} ${queue.terminalErrors}`);
  }
  lines.push(
    "# HELP baduk_worker_health_checked_timestamp_seconds Unix timestamp of this worker health snapshot.",
    "# TYPE baduk_worker_health_checked_timestamp_seconds gauge",
    `baduk_worker_health_checked_timestamp_seconds ${Math.floor(Date.parse(report.checkedAt) / 1_000)}`,
    "# HELP baduk_local_video_storage_status Local video storage: -1 disabled, 0 healthy, 1 attention, 2 critical.",
    "# TYPE baduk_local_video_storage_status gauge",
    `baduk_local_video_storage_status ${STORAGE_STATUS_VALUES[report.localVideoStorage.status]}`,
    "# HELP baduk_local_video_file_count Valid local lesson video files.",
    "# TYPE baduk_local_video_file_count gauge",
    `baduk_local_video_file_count ${report.localVideoStorage.fileCount}`,
    "# HELP baduk_local_video_invalid_entry_count Invalid local MP4 entries.",
    "# TYPE baduk_local_video_invalid_entry_count gauge",
    `baduk_local_video_invalid_entry_count ${report.localVideoStorage.invalidEntries}`,
    "# HELP baduk_local_video_bytes Bytes used by valid local lesson videos.",
    "# TYPE baduk_local_video_bytes gauge",
    `baduk_local_video_bytes ${report.localVideoStorage.totalVideoBytes}`,
  );
  if (report.localVideoStorage.enabled) {
    lines.push(
      "# HELP baduk_local_video_filesystem_available_bytes Bytes available on the local video filesystem.",
      "# TYPE baduk_local_video_filesystem_available_bytes gauge",
      `baduk_local_video_filesystem_available_bytes ${report.localVideoStorage.availableBytes ?? 0}`,
      "# HELP baduk_local_video_filesystem_capacity_bytes Total bytes on the local video filesystem.",
      "# TYPE baduk_local_video_filesystem_capacity_bytes gauge",
      `baduk_local_video_filesystem_capacity_bytes ${report.localVideoStorage.capacityBytes ?? 0}`,
      "# HELP baduk_local_video_filesystem_used_percent Used percentage of the local video filesystem.",
      "# TYPE baduk_local_video_filesystem_used_percent gauge",
      `baduk_local_video_filesystem_used_percent ${report.localVideoStorage.usedPercent ?? 100}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

@Controller("internal")
@UseGuards(MetricsTokenGuard)
export class InternalMetricsController {
  constructor(private readonly workerHealth: WorkerHealthService) {}

  @Get("worker-metrics")
  async workerMetrics(@Res() response: TextResponse): Promise<void> {
    const report = await this.workerHealth.inspect();
    response.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
    response.setHeader("Cache-Control", "private, no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.send(formatWorkerHealthMetrics(report));
  }

  @Get("release-identity")
  @Header("Cache-Control", "private, no-store")
  releaseIdentity(): ReleaseIdentity {
    return loadReleaseIdentity();
  }
}
