import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { PaymentComponentModule } from "../components/payments/index.js";
import { loadAppConfig } from "../config/app-config.js";
import { StoreController } from "./store.controller.js";
import { StoreService } from "./store.service.js";

@Module({
  imports: [
    AuthModule,
    PaymentComponentModule.registerAsync({
      useFactory: () => ({
        provider: "toss-payments" as const,
        tossPayments: {
          secretKey: loadAppConfig().tossPaymentsSecretKey,
        },
      }),
    }),
  ],
  controllers: [StoreController],
  providers: [StoreService],
})
export class StoreModule {}
