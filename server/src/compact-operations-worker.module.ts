import { Module } from "@nestjs/common";
import { AccountMailWorkerModule } from "./account-mail-worker.module.js";
import { AssignmentReminderWorkerModule } from "./assignment-reminder-worker.module.js";
import { HlsTranscodeWorkerModule } from "./hls-transcode-worker.module.js";
import { InquiryNotificationWorkerModule } from "./inquiry-notification-worker.module.js";
import { VideoCleanupWorkerModule } from "./video-cleanup-worker.module.js";
import { VideoScanWorkerModule } from "./video-scan-worker.module.js";

@Module({
  imports: [
    AccountMailWorkerModule,
    AssignmentReminderWorkerModule,
    HlsTranscodeWorkerModule,
    InquiryNotificationWorkerModule,
    VideoCleanupWorkerModule,
    VideoScanWorkerModule,
  ],
})
export class CompactOperationsWorkerModule {}
