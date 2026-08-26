import { Injectable } from "@nestjs/common";
import { loadAppConfig, type AppConfig } from "../config/app-config.js";
import { PrismaService } from "../database/prisma.service.js";
import {
  AccountMailStatus,
  HlsTranscodeJobStatus,
  InquiryNotificationStatus,
  LessonVideoAssetStatus,
  ObjectDeletionJobStatus,
} from "../generated/prisma/enums.js";

export type WorkerQueueHealth = {
  name: "accountMail" | "inquiryNotification" | "videoScan" | "hlsTranscode" | "objectDeletion";
  status: "healthy" | "attention" | "critical";
  due: number;
  staleLocks: number;
  terminalErrors: number;
  oldestDueAt: string | null;
};

export type WorkerHealthReport = {
  status: "healthy" | "attention" | "critical";
  checkedAt: string;
  backlogThresholdMinutes: number;
  queues: WorkerQueueHealth[];
};

type QueueName = WorkerQueueHealth["name"];

@Injectable()
export class WorkerHealthService {
  private readonly config: AppConfig;

  constructor(private readonly prisma: PrismaService) {
    this.config = loadAppConfig();
  }

  async inspect(now = new Date()): Promise<WorkerHealthReport> {
    const queues = await Promise.all([
      this.accountMail(now),
      this.inquiryNotification(now),
      this.videoScan(now),
      this.hlsTranscode(now),
      this.objectDeletion(now),
    ]);
    const status = queues.some((queue) => queue.status === "critical")
      ? "critical"
      : queues.some((queue) => queue.status === "attention") ? "attention" : "healthy";
    return {
      status,
      checkedAt: now.toISOString(),
      backlogThresholdMinutes: this.config.workerHealthBacklogMinutes,
      queues,
    };
  }

  private async accountMail(now: Date) {
    const dueWhere = {
      status: { in: [AccountMailStatus.PENDING, AccountMailStatus.ERROR] },
      attempts: { lt: this.config.accountMailMaxAttempts },
      nextAttemptAt: { lte: now },
    };
    return this.snapshot(
      "accountMail",
      now,
      this.prisma.accountMailJob.count({ where: dueWhere }),
      this.prisma.accountMailJob.count({ where: {
        status: AccountMailStatus.SENDING,
        lockedAt: { lt: new Date(now.getTime() - this.config.accountMailLockTimeoutMs) },
      } }),
      this.prisma.accountMailJob.count({ where: {
        status: AccountMailStatus.ERROR,
        attempts: { gte: this.config.accountMailMaxAttempts },
      } }),
      this.prisma.accountMailJob.findFirst({ where: dueWhere, orderBy: { nextAttemptAt: "asc" }, select: { nextAttemptAt: true } }),
    );
  }

  private async inquiryNotification(now: Date) {
    const dueWhere = {
      status: { in: [InquiryNotificationStatus.PENDING, InquiryNotificationStatus.ERROR] },
      attempts: { lt: this.config.inquiryNotificationMaxAttempts },
      nextAttemptAt: { lte: now },
    };
    return this.snapshot(
      "inquiryNotification",
      now,
      this.prisma.inquiryNotificationJob.count({ where: dueWhere }),
      this.prisma.inquiryNotificationJob.count({ where: {
        status: InquiryNotificationStatus.SENDING,
        lockedAt: { lt: new Date(now.getTime() - this.config.inquiryNotificationLockTimeoutMs) },
      } }),
      this.prisma.inquiryNotificationJob.count({ where: {
        status: InquiryNotificationStatus.ERROR,
        attempts: { gte: this.config.inquiryNotificationMaxAttempts },
      } }),
      this.prisma.inquiryNotificationJob.findFirst({ where: dueWhere, orderBy: { nextAttemptAt: "asc" }, select: { nextAttemptAt: true } }),
    );
  }

  private async videoScan(now: Date) {
    const dueWhere = {
      status: { in: [LessonVideoAssetStatus.QUARANTINED, LessonVideoAssetStatus.ERROR] },
      attempts: { lt: this.config.videoScanMaxAttempts },
      nextAttemptAt: { lte: now },
    };
    return this.snapshot(
      "videoScan",
      now,
      this.prisma.lessonVideoAsset.count({ where: dueWhere }),
      this.prisma.lessonVideoAsset.count({ where: {
        status: LessonVideoAssetStatus.SCANNING,
        lockedAt: { lt: new Date(now.getTime() - this.config.videoScanLockTimeoutMs) },
      } }),
      this.prisma.lessonVideoAsset.count({ where: {
        status: LessonVideoAssetStatus.ERROR,
        attempts: { gte: this.config.videoScanMaxAttempts },
      } }),
      this.prisma.lessonVideoAsset.findFirst({ where: dueWhere, orderBy: { nextAttemptAt: "asc" }, select: { nextAttemptAt: true } }),
    );
  }

  private async hlsTranscode(now: Date) {
    const dueWhere = {
      status: { in: [HlsTranscodeJobStatus.PENDING, HlsTranscodeJobStatus.ERROR] },
      attempts: { lt: this.config.hlsTranscodeMaxAttempts },
      nextAttemptAt: { lte: now },
    };
    return this.snapshot(
      "hlsTranscode",
      now,
      this.prisma.hlsTranscodeJob.count({ where: dueWhere }),
      this.prisma.hlsTranscodeJob.count({ where: {
        status: HlsTranscodeJobStatus.TRANSCODING,
        lockedAt: { lt: new Date(now.getTime() - this.config.hlsTranscodeLockTimeoutMs) },
      } }),
      this.prisma.hlsTranscodeJob.count({ where: {
        status: HlsTranscodeJobStatus.ERROR,
        attempts: { gte: this.config.hlsTranscodeMaxAttempts },
      } }),
      this.prisma.hlsTranscodeJob.findFirst({ where: dueWhere, orderBy: { nextAttemptAt: "asc" }, select: { nextAttemptAt: true } }),
    );
  }

  private async objectDeletion(now: Date) {
    const dueWhere = {
      status: { in: [ObjectDeletionJobStatus.PENDING, ObjectDeletionJobStatus.ERROR] },
      attempts: { lt: this.config.videoCleanupMaxAttempts },
      nextAttemptAt: { lte: now },
    };
    return this.snapshot(
      "objectDeletion",
      now,
      this.prisma.objectDeletionJob.count({ where: dueWhere }),
      this.prisma.objectDeletionJob.count({ where: {
        status: ObjectDeletionJobStatus.DELETING,
        lockedAt: { lt: new Date(now.getTime() - this.config.videoCleanupLockTimeoutMs) },
      } }),
      this.prisma.objectDeletionJob.count({ where: {
        status: ObjectDeletionJobStatus.ERROR,
        attempts: { gte: this.config.videoCleanupMaxAttempts },
      } }),
      this.prisma.objectDeletionJob.findFirst({ where: dueWhere, orderBy: { nextAttemptAt: "asc" }, select: { nextAttemptAt: true } }),
    );
  }

  private async snapshot(
    name: QueueName,
    now: Date,
    dueQuery: Promise<number>,
    staleLocksQuery: Promise<number>,
    terminalErrorsQuery: Promise<number>,
    oldestQuery: Promise<{ nextAttemptAt: Date | null } | null>,
  ): Promise<WorkerQueueHealth> {
    const [due, staleLocks, terminalErrors, oldest] = await Promise.all([
      dueQuery,
      staleLocksQuery,
      terminalErrorsQuery,
      oldestQuery,
    ]);
    const oldestDueAt = oldest?.nextAttemptAt ?? null;
    const backlogExpired = Boolean(oldestDueAt && (
      now.getTime() - oldestDueAt.getTime() >= this.config.workerHealthBacklogMinutes * 60_000
    ));
    const status = staleLocks > 0 || backlogExpired
      ? "critical"
      : due > 0 || terminalErrors > 0 ? "attention" : "healthy";
    return {
      name,
      status,
      due,
      staleLocks,
      terminalErrors,
      oldestDueAt: oldestDueAt?.toISOString() ?? null,
    };
  }
}
