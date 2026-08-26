import { Body, Controller, HttpCode, Post, Req } from "@nestjs/common";
import type { ApiRequest } from "../common/http-types.js";
import { SubscriptionService } from "./subscription.service.js";

@Controller("payments/toss/subscriptions")
export class TossSubscriptionWebhookController {
  constructor(private readonly subscriptionService: SubscriptionService) {}

  @Post("webhook")
  @HttpCode(200)
  webhook(@Body() body: unknown, @Req() request: ApiRequest) {
    return this.subscriptionService.syncWebhook(body, request.requestId);
  }
}
