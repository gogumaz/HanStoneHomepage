import { Module } from "@nestjs/common";
import { AccountMailService } from "./account-mail.service.js";

@Module({
  providers: [AccountMailService],
  exports: [AccountMailService],
})
export class MailModule {}
