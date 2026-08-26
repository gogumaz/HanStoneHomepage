import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { RateLimitModule } from "../common/rate-limit.module.js";
import { StorageModule } from "../storage/storage.module.js";
import { InquiryAttachmentService } from "./inquiry-attachment.service.js";
import { InquiryNotificationAdminService } from "./inquiry-notification-admin.service.js";
import { InquiryController } from "./inquiry.controller.js";
import { InquiryService } from "./inquiry.service.js";

@Module({
  imports: [AuthModule, RateLimitModule, StorageModule],
  controllers: [InquiryController],
  providers: [InquiryService, InquiryAttachmentService, InquiryNotificationAdminService],
})
export class InquiryModule {}
