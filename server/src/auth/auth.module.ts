import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller.js";
import { AuthService } from "./auth.service.js";
import { RolesGuard } from "./roles.guard.js";
import { SessionAuthGuard } from "./session-auth.guard.js";
import { OptionalSessionGuard } from "./optional-session.guard.js";
import { MailModule } from "../mail/mail.module.js";
import { OAuthComponentModule } from "../components/oauth/index.js";
import { loadOAuthComponentOptions } from "./oauth-options.js";
import { RateLimitModule } from "../common/rate-limit.module.js";

@Module({
  imports: [
    MailModule,
    OAuthComponentModule.registerAsync({ useFactory: () => loadOAuthComponentOptions() }),
    RateLimitModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, SessionAuthGuard, OptionalSessionGuard, RolesGuard],
  exports: [AuthService, SessionAuthGuard, OptionalSessionGuard, RolesGuard],
})
export class AuthModule {}
