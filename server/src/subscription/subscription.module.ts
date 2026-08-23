import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { PaymentComponentModule } from "../components/payments/index.js";
import { loadAppConfig } from "../config/app-config.js";
import { PortOneWebhookController } from "./portone-webhook.controller.js";
import { SubscriptionController } from "./subscription.controller.js";
import { SubscriptionService } from "./subscription.service.js";

@Module({
  imports: [
    AuthModule,
    PaymentComponentModule.registerAsync({
      useFactory: () => {
        const config = loadAppConfig();
        return {
          provider: "portone-v1" as const,
          portoneV1: {
            apiKey: config.portoneV1ApiKey,
            apiSecret: config.portoneV1ApiSecret,
          },
        };
      },
    }),
  ],
  controllers: [SubscriptionController, PortOneWebhookController],
  providers: [SubscriptionService],
  exports: [SubscriptionService],
})
export class SubscriptionModule {}
