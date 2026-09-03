import { Body, Controller, Headers, HttpCode, HttpStatus, Post } from "@nestjs/common";
import { MailBounceService } from "./mail-bounce.service.js";

@Controller("mail/webhooks")
export class MailBounceController {
  constructor(private readonly bounces: MailBounceService) {}

  @Post("bounce")
  @HttpCode(HttpStatus.OK)
  receive(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: unknown,
  ) {
    return this.bounces.receive(authorization, body);
  }
}
