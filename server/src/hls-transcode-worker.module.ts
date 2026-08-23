import { Module } from "@nestjs/common";
import { HlsTranscoderService } from "./content/hls-transcoder.service.js";
import { LessonHlsTranscodeWorkerService } from "./content/lesson-hls-transcode-worker.service.js";
import { DatabaseModule } from "./database/database.module.js";
import { StorageModule } from "./storage/storage.module.js";

@Module({
  imports: [DatabaseModule, StorageModule],
  providers: [HlsTranscoderService, LessonHlsTranscodeWorkerService],
})
export class HlsTranscodeWorkerModule {}
