import { Global, Module } from "@nestjs/common";
import { RateLimitGuard } from "./rate-limit.guard.js";
import { createRateLimitStore, RATE_LIMIT_STORE } from "./rate-limit.store.js";

@Global()
@Module({
  providers: [
    { provide: RATE_LIMIT_STORE, useFactory: createRateLimitStore },
    RateLimitGuard,
  ],
  exports: [RATE_LIMIT_STORE, RateLimitGuard],
})
export class RateLimitModule {}
