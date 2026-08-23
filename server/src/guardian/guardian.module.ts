import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { GuardianController } from "./guardian.controller.js";
import { GuardianService } from "./guardian.service.js";

@Module({
  imports: [AuthModule],
  controllers: [GuardianController],
  providers: [GuardianService],
})
export class GuardianModule {}
