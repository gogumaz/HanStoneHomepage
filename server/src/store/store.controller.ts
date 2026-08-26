import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import type { CurrentUser as CurrentUserValue } from "../auth/auth.types.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { SessionAuthGuard } from "../auth/session-auth.guard.js";
import { Roles } from "../auth/roles.decorator.js";
import { RolesGuard } from "../auth/roles.guard.js";
import type { ApiRequest } from "../common/http-types.js";
import { StoreService } from "./store.service.js";

@Controller()
export class StoreController {
  constructor(private readonly storeService: StoreService) {}

  @Get("store/products")
  listProducts() {
    return this.storeService.listProducts();
  }

  @Get("cart")
  @UseGuards(SessionAuthGuard)
  listCart(@CurrentUser() user: CurrentUserValue) {
    return this.storeService.listCart(user);
  }

  @Post("cart/items")
  @UseGuards(SessionAuthGuard)
  setCartItem(@CurrentUser() user: CurrentUserValue, @Body() body: unknown) {
    return this.storeService.setCartItem(user, body);
  }

  @Delete("cart/items/:productId")
  @UseGuards(SessionAuthGuard)
  removeCartItem(@CurrentUser() user: CurrentUserValue, @Param("productId") productId: string) {
    return this.storeService.removeCartItem(user, productId);
  }

  @Post("store/orders/checkout")
  @UseGuards(SessionAuthGuard)
  createCheckout(
    @CurrentUser() user: CurrentUserValue,
    @Body() body: unknown,
    @Req() request: ApiRequest,
  ) {
    return this.storeService.createCheckout(user, body, request.requestId);
  }

  @Post("payments/toss/confirm")
  @UseGuards(SessionAuthGuard)
  confirmPayment(
    @CurrentUser() user: CurrentUserValue,
    @Body() body: unknown,
    @Req() request: ApiRequest,
  ) {
    return this.storeService.confirmPayment(user, body, request.requestId);
  }

  @Get("me/store-orders")
  @UseGuards(SessionAuthGuard)
  listMyOrders(@CurrentUser() user: CurrentUserValue) {
    return this.storeService.listOrders(user);
  }

  @Post("payments/toss/webhook")
  tossWebhook(@Body() body: unknown, @Req() request: ApiRequest) {
    return this.storeService.syncWebhook(body, request.requestId);
  }

  @Get("admin/store-orders")
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles("operator", "admin")
  listAdminOrders() {
    return this.storeService.listAdminOrders();
  }

  @Post("admin/store-orders/:orderId/refund")
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles("operator", "admin")
  refundOrder(
    @Param("orderId") orderId: string,
    @CurrentUser() user: CurrentUserValue,
    @Body() body: unknown,
    @Req() request: ApiRequest,
  ) {
    return this.storeService.refundOrder(user, orderId, body, request.requestId);
  }
}
