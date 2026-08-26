import { Module } from "@nestjs/common";
import { DatabaseModule } from "./database/database.module.js";
import { InquiryNotificationWorkerService } from "./inquiry/inquiry-notification-worker.service.js";
import { MailModule } from "./mail/mail.module.js";

@Module({
  imports: [DatabaseModule, MailModule],
  providers: [InquiryNotificationWorkerService],
})
export class InquiryNotificationWorkerModule {}
