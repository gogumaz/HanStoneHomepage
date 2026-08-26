import { Body, Controller, Get, Header, Param, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import type { CurrentUser as CurrentUserValue } from "../auth/auth.types.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { SessionAuthGuard } from "../auth/session-auth.guard.js";
import { Roles } from "../auth/roles.decorator.js";
import { RolesGuard } from "../auth/roles.guard.js";
import type { ApiRequest } from "../common/http-types.js";
import { SubscriptionService } from "./subscription.service.js";

type CsvResponse = {
  setHeader(name: string, value: string): void;
  send(body: string): void;
};

@Controller()
@UseGuards(SessionAuthGuard)
export class SubscriptionController {
  constructor(private readonly subscriptionService: SubscriptionService) {}

  @Post("orders/checkout")
  createCheckout(
    @CurrentUser() user: CurrentUserValue,
    @Body() body: unknown,
    @Req() request: ApiRequest,
  ) {
    return this.subscriptionService.createCheckout(user, body, request.requestId);
  }

  @Post("payments/toss/subscriptions/confirm")
  verifyPayment(
    @CurrentUser() user: CurrentUserValue,
    @Body() body: unknown,
    @Req() request: ApiRequest,
  ) {
    return this.subscriptionService.verifyPayment(user, body, request.requestId);
  }

  @Get("me/orders")
  listOrders(@CurrentUser() user: CurrentUserValue) {
    return this.subscriptionService.listOrders(user);
  }

  @Get("me/subscriptions")
  listSubscriptions(@CurrentUser() user: CurrentUserValue) {
    return this.subscriptionService.listSubscriptions(user);
  }

  @Get("admin/payments/reconciliation")
  @UseGuards(RolesGuard)
  @Roles("operator", "admin")
  @Header("Cache-Control", "private, no-store")
  listPaymentReconciliation(@Query() query: Record<string, unknown>) {
    return this.subscriptionService.listPaymentReconciliation(query);
  }

  @Get("admin/payments/reconciliation.csv")
  @UseGuards(RolesGuard)
  @Roles("operator", "admin")
  async exportPaymentReconciliation(
    @CurrentUser() user: CurrentUserValue,
    @Query() query: Record<string, unknown>,
    @Req() request: ApiRequest,
    @Res() response: CsvResponse,
  ): Promise<void> {
    const file = await this.subscriptionService.exportPaymentReconciliationCsv(
      user,
      query,
      request.requestId,
    );
    response.setHeader("Cache-Control", "private, no-store");
    response.setHeader("Content-Type", "text/csv; charset=utf-8");
    response.setHeader("Content-Disposition", `attachment; filename="${file.filename}"`);
    response.send(file.content);
  }

  @Post("admin/orders/:orderId/reconcile")
  @UseGuards(RolesGuard)
  @Roles("operator", "admin")
  reconcileOrder(
    @Param("orderId") orderId: string,
    @CurrentUser() user: CurrentUserValue,
    @Body() body: unknown,
    @Req() request: ApiRequest,
  ) {
    return this.subscriptionService.reconcileOrder(user, orderId, body, request.requestId);
  }

  @Post("admin/subscriptions/:subscriptionId/refund")
  @UseGuards(RolesGuard)
  @Roles("operator", "admin")
  refundSubscription(
    @Param("subscriptionId") subscriptionId: string,
    @CurrentUser() user: CurrentUserValue,
    @Body() body: unknown,
    @Req() request: ApiRequest,
  ) {
    return this.subscriptionService.refundSubscription(
      user,
      subscriptionId,
      body,
      request.requestId,
    );
  }
}
