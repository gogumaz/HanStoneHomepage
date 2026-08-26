import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { MissionAdminService } from "./mission-admin.service.js";
import { MissionController } from "./mission.controller.js";
import { MissionService } from "./mission.service.js";

@Module({
  imports: [AuthModule],
  controllers: [MissionController],
  providers: [MissionService, MissionAdminService],
})
export class MissionModule {}
