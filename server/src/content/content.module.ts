import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { ContentController } from "./content.controller.js";
import { ContentService } from "./content.service.js";
import { LessonAccessService } from "./lesson-access.service.js";
import { LessonProgressService } from "./lesson-progress.service.js";
import { LessonVideoService } from "./lesson-video.service.js";
import { LessonAdminService } from "./lesson-admin.service.js";
import { LessonAssetService } from "./lesson-asset.service.js";
import { StorageModule } from "../storage/storage.module.js";
import { StudentDashboardService } from "./student-dashboard.service.js";
import { HlsManifestService } from "./hls-manifest.service.js";

@Module({
  imports: [AuthModule, StorageModule],
  controllers: [ContentController],
  providers: [
    ContentService,
    LessonAccessService,
    LessonProgressService,
    LessonVideoService,
    LessonAdminService,
    LessonAssetService,
    StudentDashboardService,
    HlsManifestService,
  ],
})
export class ContentModule {}
