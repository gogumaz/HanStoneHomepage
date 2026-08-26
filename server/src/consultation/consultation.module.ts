import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { RateLimitModule } from "../common/rate-limit.module.js";
import { ConsultationController } from "./consultation.controller.js";
import { ConsultationService } from "./consultation.service.js";

@Module({
  imports: [AuthModule, RateLimitModule],
  controllers: [ConsultationController],
  providers: [ConsultationService],
})
export class ConsultationModule {}
