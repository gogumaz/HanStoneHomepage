import "reflect-metadata";
import "dotenv/config";
import { NestFactory } from "@nestjs/core";
import { LessonVideoScanWorkerService } from "./content/lesson-video-scan-worker.service.js";
import { VideoScanWorkerModule } from "./video-scan-worker.module.js";

async function bootstrap(): Promise<void> {
  const application = await NestFactory.createApplicationContext(VideoScanWorkerModule);
  const worker = application.get(LessonVideoScanWorkerService);
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
