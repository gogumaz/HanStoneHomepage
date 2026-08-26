import { Module } from "@nestjs/common";
import { DatabaseModule } from "./database/database.module.js";
import { MailModule } from "./mail/mail.module.js";
import { AccountMailWorkerService } from "./mail/account-mail-worker.service.js";

@Module({
  imports: [DatabaseModule, MailModule],
  providers: [AccountMailWorkerService],
})
export class AccountMailWorkerModule {}
