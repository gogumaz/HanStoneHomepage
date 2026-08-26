import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AuthModule } from "./auth/auth.module.js";
import { DatabaseModule } from "./database/database.module.js";
import { ContentModule } from "./content/content.module.js";
import { HealthController } from "./health/health.controller.js";
import { HealthService } from "./health/health.service.js";
import { GuardianModule } from "./guardian/guardian.module.js";
import { SubscriptionModule } from "./subscription/subscription.module.js";
import { MissionModule } from "./mission/mission.module.js";
import { SessionCsrfGuard } from "./auth/session-csrf.guard.js";
import { ConsultationModule } from "./consultation/consultation.module.js";
import { InquiryModule } from "./inquiry/inquiry.module.js";
import { NotificationModule } from "./notification/notification.module.js";
import { EditorialModule } from "./editorial/editorial.module.js";
import { CommunityModule } from "./community/community.module.js";
import { MaterialModule } from "./material/material.module.js";
import { ClassHelperModule } from "./class-helper/class-helper.module.js";
import { StoreModule } from "./store/store.module.js";
import { OperationsModule } from "./operations/operations.module.js";

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    GuardianModule,
    ContentModule,
    SubscriptionModule,
    MissionModule,
    ConsultationModule,
    InquiryModule,
    NotificationModule,
    EditorialModule,
    CommunityModule,
    MaterialModule,
    ClassHelperModule,
    StoreModule,
    OperationsModule,
  ],
  controllers: [HealthController],
  providers: [
    HealthService,
    { provide: APP_GUARD, useClass: SessionCsrfGuard },
  ],
})
export class AppModule {}
