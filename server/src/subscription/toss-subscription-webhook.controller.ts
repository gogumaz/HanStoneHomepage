import { Body, Controller, HttpCode, Post, Req, UseGuards } from "@nestjs/common";
import type { ApiRequest } from "../common/http-types.js";
import { TOSS_PAYMENT_WEBHOOK_RATE_LIMIT } from "../common/payment-webhook-rate-limit.js";
import { RateLimit, RateLimitGuard } from "../common/rate-limit.guard.js";
import { SubscriptionService } from "./subscription.service.js";

@Controller("payments/toss/subscriptions")
export class TossSubscriptionWebhookController {
  constructor(private readonly subscriptionService: SubscriptionService) {}

  @Post("webhook")
  @HttpCode(200)
  @RateLimit(TOSS_PAYMENT_WEBHOOK_RATE_LIMIT)
  @UseGuards(RateLimitGuard)
  webhook(@Body() body: unknown, @Req() request: ApiRequest) {
    return this.subscriptionService.syncWebhook(body, request.requestId);
  }
}
