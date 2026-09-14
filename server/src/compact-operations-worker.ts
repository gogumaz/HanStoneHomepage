import "reflect-metadata";
import "dotenv/config";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { CompactOperationsWorkerModule } from "./compact-operations-worker.module.js";
import { LessonHlsTranscodeWorkerService } from "./content/lesson-hls-transcode-worker.service.js";
import { LessonVideoCleanupWorkerService } from "./content/lesson-video-cleanup-worker.service.js";
import { LessonVideoScanWorkerService } from "./content/lesson-video-scan-worker.service.js";
import { InquiryNotificationWorkerService } from "./inquiry/inquiry-notification-worker.service.js";
import { AccountMailWorkerService } from "./mail/account-mail-worker.service.js";
import { ClassAssignmentService } from "./organization/class-assignment.service.js";

const logger = new Logger("CompactOperationsWorker");

function pollInterval(): number {
  const value = Number(process.env.COMPACT_WORKER_POLL_INTERVAL_MS ?? 5_000);
  if (!Number.isInteger(value) || value < 1_000 || value > 60_000) {
    throw new Error("COMPACT_WORKER_POLL_INTERVAL_MS_INVALID");
  }
  return value;
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const finish = () => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timeout = setTimeout(finish, milliseconds);
    signal.addEventListener("abort", finish, { once: true });
  });
}

async function runMediaJobsSerially(
  videoScan: LessonVideoScanWorkerService,
  hlsTranscode: LessonHlsTranscodeWorkerService,
  signal: AbortSignal,
): Promise<void> {
  const interval = pollInterval();
  logger.log("Compact media worker started (malware scan and HLS transcode are serialized)");
  while (!signal.aborted) {
    try {
      const scanned = await videoScan.processNext();
      if (signal.aborted) break;
      const transcoded = await hlsTranscode.processNext();
      if (!scanned && !transcoded) await wait(interval, signal);
    } catch (error) {
      logger.error(error instanceof Error ? error.name : "COMPACT_MEDIA_WORKER_FAILED");
      await wait(interval, signal);
    }
  }
  logger.log("Compact media worker stopped");
}

async function bootstrap(): Promise<void> {
  const application = await NestFactory.createApplicationContext(CompactOperationsWorkerModule);
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  const tasks = [
    runMediaJobsSerially(
      application.get(LessonVideoScanWorkerService),
      application.get(LessonHlsTranscodeWorkerService),
      controller.signal,
    ),
    application.get(LessonVideoCleanupWorkerService).runForever(controller.signal),
    application.get(AccountMailWorkerService).runForever(controller.signal),
    application.get(InquiryNotificationWorkerService).runForever(controller.signal),
    application.get(ClassAssignmentService).runReminderWorker(controller.signal),
  ];
  const guarded = tasks.map((task) => task.catch((error: unknown) => {
    controller.abort();
    throw error;
  }));

  try {
    await Promise.all(guarded);
  } finally {
    controller.abort();
    await Promise.allSettled(tasks);
    await application.close();
  }
}

void bootstrap().catch((error: unknown) => {
  logger.error(error instanceof Error ? error.name : "COMPACT_OPERATIONS_WORKER_FAILED");
  process.exitCode = 1;
});
