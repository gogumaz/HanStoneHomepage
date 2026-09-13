import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { GuardianController } from "./guardian.controller.js";
import { GuardianService } from "./guardian.service.js";
import { OrganizationModule } from "../organization/organization.module.js";

@Module({
  imports: [AuthModule, OrganizationModule],
  controllers: [GuardianController],
  providers: [GuardianService],
})
export class GuardianModule {}
