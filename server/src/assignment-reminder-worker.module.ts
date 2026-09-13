import { Module } from "@nestjs/common";
import { DatabaseModule } from "./database/database.module.js";
import { OrganizationModule } from "./organization/organization.module.js";

@Module({ imports: [DatabaseModule, OrganizationModule] })
export class AssignmentReminderWorkerModule {}
