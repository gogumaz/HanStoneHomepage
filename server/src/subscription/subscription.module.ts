import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { PaymentComponentModule } from "../components/payments/index.js";
import { loadAppConfig } from "../config/app-config.js";
import { TossSubscriptionWebhookController } from "./toss-subscription-webhook.controller.js";
import { SubscriptionController } from "./subscription.controller.js";
import { SubscriptionService } from "./subscription.service.js";

@Module({
  imports: [
    AuthModule,
    PaymentComponentModule.registerAsync({
      useFactory: () => {
        const config = loadAppConfig();
        return {
          provider: "toss-payments" as const,
          tossPayments: { secretKey: config.tossPaymentsSecretKey },
        };
      },
    }),
  ],
  controllers: [SubscriptionController, TossSubscriptionWebhookController],
  providers: [SubscriptionService],
  exports: [SubscriptionService],
})
export class SubscriptionModule {}
