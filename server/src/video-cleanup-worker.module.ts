import { Module } from "@nestjs/common";
import { LessonVideoCleanupWorkerService } from "./content/lesson-video-cleanup-worker.service.js";
import { DatabaseModule } from "./database/database.module.js";
import { StorageModule } from "./storage/storage.module.js";

@Module({
  imports: [DatabaseModule, StorageModule],
  providers: [LessonVideoCleanupWorkerService],
})
export class VideoCleanupWorkerModule {}
