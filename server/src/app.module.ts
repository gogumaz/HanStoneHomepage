import { Module } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module.js";
import { DatabaseModule } from "./database/database.module.js";
import { ContentModule } from "./content/content.module.js";
import { HealthController } from "./health/health.controller.js";
import { HealthService } from "./health/health.service.js";
import { GuardianModule } from "./guardian/guardian.module.js";
import { SubscriptionModule } from "./subscription/subscription.module.js";

@Module({
  imports: [DatabaseModule, AuthModule, GuardianModule, ContentModule, SubscriptionModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class AppModule {}
