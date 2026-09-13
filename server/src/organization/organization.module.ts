import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { OrganizationAccessService } from "./organization-access.service.js";
import { OrganizationAdminController } from "./organization-admin.controller.js";
import { OrganizationController, OrganizationEnrollmentController } from "./organization.controller.js";
import { ClassAssignmentController } from "./class-assignment.controller.js";
import { ClassAssignmentService } from "./class-assignment.service.js";
import { OrganizationManagementController } from "./organization-management.controller.js";
import { OrganizationManagementService } from "./organization-management.service.js";

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [
    OrganizationController,
    OrganizationEnrollmentController,
    OrganizationAdminController,
    OrganizationManagementController,
    ClassAssignmentController,
  ],
  providers: [OrganizationAccessService, OrganizationManagementService, ClassAssignmentService],
  exports: [OrganizationAccessService, ClassAssignmentService],
})
export class OrganizationModule {}
