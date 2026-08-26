import "reflect-metadata";
import "dotenv/config";
import { NestFactory } from "@nestjs/core";
import { InquiryNotificationWorkerModule } from "./inquiry-notification-worker.module.js";
import { InquiryNotificationWorkerService } from "./inquiry/inquiry-notification-worker.service.js";

async function bootstrap(): Promise<void> {
  const application = await NestFactory.createApplicationContext(InquiryNotificationWorkerModule);
  const worker = application.get(InquiryNotificationWorkerService);
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
