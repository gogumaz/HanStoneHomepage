import "reflect-metadata";
import "dotenv/config";
import { NestFactory } from "@nestjs/core";
import { LessonHlsTranscodeWorkerService } from "./content/lesson-hls-transcode-worker.service.js";
import { HlsTranscodeWorkerModule } from "./hls-transcode-worker.module.js";

async function bootstrap(): Promise<void> {
  const application = await NestFactory.createApplicationContext(HlsTranscodeWorkerModule);
  const worker = application.get(LessonHlsTranscodeWorkerService);
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
