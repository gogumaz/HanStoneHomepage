import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { OrganizationAccessService } from "./organization-access.service.js";
import { OrganizationAdminController } from "./organization-admin.controller.js";
import { OrganizationController } from "./organization.controller.js";

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [OrganizationController, OrganizationAdminController],
  providers: [OrganizationAccessService],
  exports: [OrganizationAccessService],
})
export class OrganizationModule {}
