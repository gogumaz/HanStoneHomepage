import "reflect-metadata";
import "dotenv/config";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AssignmentReminderWorkerModule } from "./assignment-reminder-worker.module.js";
import { ClassAssignmentService } from "./organization/class-assignment.service.js";

async function bootstrap(): Promise<void> {
  const application = await NestFactory.createApplicationContext(AssignmentReminderWorkerModule);
  const assignments = application.get(ClassAssignmentService);
  const logger = new Logger("AssignmentReminderWorker");
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  logger.log("Assignment reminder worker started");
  try {
    await assignments.runReminderWorker(controller.signal);
  } catch (error) {
    logger.error(error instanceof Error ? error.name : "ASSIGNMENT_REMINDER_FAILED");
  } finally {
    logger.log("Assignment reminder worker stopped");
    await application.close();
  }
}

void bootstrap();
