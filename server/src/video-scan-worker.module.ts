import { Module } from "@nestjs/common";
import { LessonVideoScanWorkerService } from "./content/lesson-video-scan-worker.service.js";
import { DatabaseModule } from "./database/database.module.js";
import { StorageModule } from "./storage/storage.module.js";

@Module({
  imports: [DatabaseModule, StorageModule],
  providers: [LessonVideoScanWorkerService],
})
export class VideoScanWorkerModule {}
