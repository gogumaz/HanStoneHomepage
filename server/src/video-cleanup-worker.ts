import "reflect-metadata";
import "dotenv/config";
import { NestFactory } from "@nestjs/core";
import { LessonVideoCleanupWorkerService } from "./content/lesson-video-cleanup-worker.service.js";
import { VideoCleanupWorkerModule } from "./video-cleanup-worker.module.js";

async function bootstrap(): Promise<void> {
  const application = await NestFactory.createApplicationContext(VideoCleanupWorkerModule);
  const worker = application.get(LessonVideoCleanupWorkerService);
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    await worker.runForever(controller.signal);
  } finally {
    await application.close();
  }
}

void bootstrap();
