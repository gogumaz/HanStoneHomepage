import { Module } from "@nestjs/common";
import { AccountMailService } from "./account-mail.service.js";
import { MailBounceController } from "./mail-bounce.controller.js";
import { MailBounceService } from "./mail-bounce.service.js";

@Module({
  controllers: [MailBounceController],
  providers: [AccountMailService, MailBounceService],
  exports: [AccountMailService],
})
export class MailModule {}
