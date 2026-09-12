import { Body, Controller, Headers, HttpCode, HttpStatus, Post, Req } from "@nestjs/common";
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

  @Post("resend")
  @HttpCode(HttpStatus.OK)
  receiveResend(
    @Headers("svix-id") id: string | undefined,
    @Headers("svix-timestamp") timestamp: string | undefined,
    @Headers("svix-signature") signature: string | undefined,
    @Req() request: { rawBody?: Buffer },
  ) {
    return this.bounces.receiveResend({ id, timestamp, signature }, request.rawBody);
  }
}
