import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { StorageModule } from "../storage/storage.module.js";
import { CommunityAttachmentController } from "./community-attachment.controller.js";
import { CommunityAttachmentService } from "./community-attachment.service.js";
import { CommunityReportController } from "./community-report.controller.js";
import { CommunityReportService } from "./community-report.service.js";
import { CommunityController } from "./community.controller.js";
import { CommunityService } from "./community.service.js";

@Module({
  imports: [AuthModule, StorageModule],
  controllers: [CommunityController, CommunityReportController, CommunityAttachmentController],
  providers: [CommunityService, CommunityReportService, CommunityAttachmentService],
})
export class CommunityModule {}
