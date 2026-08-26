import "reflect-metadata";
import "dotenv/config";
import { NestFactory } from "@nestjs/core";
import { AccountMailWorkerModule } from "./account-mail-worker.module.js";
import { AccountMailWorkerService } from "./mail/account-mail-worker.service.js";

async function bootstrap(): Promise<void> {
  const application = await NestFactory.createApplicationContext(AccountMailWorkerModule);
  const worker = application.get(AccountMailWorkerService);
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
