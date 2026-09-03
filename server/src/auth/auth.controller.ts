import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import type { ApiRequest } from "../common/http-types.js";
import { AuthService } from "./auth.service.js";
import type { CurrentUser as CurrentUserValue } from "./auth.types.js";
import { CurrentUser } from "./current-user.decorator.js";
import { SessionAuthGuard } from "./session-auth.guard.js";
import {
  clearSessionCookie,
  readSessionToken,
  setSessionCookie,
  type CookieResponse,
} from "./session-cookie.js";
import {
  AUTH_RATE_LIMIT_POLICIES,
  AuthRateLimit,
  AuthRateLimitGuard,
} from "./auth-rate-limit.guard.js";

@Controller()
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("auth/signup")
  @AuthRateLimit(AUTH_RATE_LIMIT_POLICIES.signup)
  @UseGuards(AuthRateLimitGuard)
  async signup(
    @Body() body: unknown,
    @Req() request: ApiRequest,
    @Res({ passthrough: true }) response: CookieResponse,
  ): Promise<{ user: CurrentUserValue; developmentVerificationToken?: string }> {
    const result = await this.authService.signup(body, request.requestId);
    setSessionCookie(response, this.authService.getConfig(), result.sessionToken, result.expiresAt);
    return {
      user: result.user,
      ...(result.developmentVerificationToken
        ? { developmentVerificationToken: result.developmentVerificationToken }
        : {}),
    };
  }

  @Post("auth/password-reset/request")
  @AuthRateLimit(AUTH_RATE_LIMIT_POLICIES.recovery)
  @UseGuards(AuthRateLimitGuard)
  @HttpCode(HttpStatus.ACCEPTED)
  requestPasswordReset(@Body() body: unknown, @Req() request: ApiRequest) {
    return this.authService.requestPasswordReset(body, request.requestId);
  }

  @Post("auth/password-reset/confirm")
  @AuthRateLimit(AUTH_RATE_LIMIT_POLICIES.recovery)
  @UseGuards(AuthRateLimitGuard)
  @HttpCode(HttpStatus.OK)
  async confirmPasswordReset(
    @Body() body: unknown,
    @Req() request: ApiRequest,
    @Res({ passthrough: true }) response: CookieResponse,
  ) {
    const result = await this.authService.confirmPasswordReset(body, request.requestId);
    clearSessionCookie(response, this.authService.getConfig());
    return result;
  }

  @Post("auth/email-verification/request")
  @AuthRateLimit(AUTH_RATE_LIMIT_POLICIES.recovery)
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(SessionAuthGuard, AuthRateLimitGuard)
  requestEmailVerification(
    @CurrentUser() user: CurrentUserValue,
    @Req() request: ApiRequest,
  ) {
    return this.authService.requestEmailVerification(user, request.requestId);
  }

  @Post("auth/email-verification/confirm")
  @AuthRateLimit(AUTH_RATE_LIMIT_POLICIES.recovery)
  @UseGuards(AuthRateLimitGuard)
  @HttpCode(HttpStatus.OK)
  confirmEmailVerification(@Body() body: unknown, @Req() request: ApiRequest) {
    return this.authService.confirmEmailVerification(body, request.requestId);
  }

  @Post("auth/login")
  @AuthRateLimit(AUTH_RATE_LIMIT_POLICIES.login)
  @UseGuards(AuthRateLimitGuard)
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() body: unknown,
    @Req() request: ApiRequest,
    @Res({ passthrough: true }) response: CookieResponse,
  ): Promise<{ user: CurrentUserValue }> {
    const result = await this.authService.login(body, request.requestId);
    setSessionCookie(response, this.authService.getConfig(), result.sessionToken, result.expiresAt);
    return { user: result.user };
  }

  @Get("auth/oauth/:provider/start")
  @AuthRateLimit(AUTH_RATE_LIMIT_POLICIES.oauthStart)
  @UseGuards(AuthRateLimitGuard)
  async startOAuth(
    @Param("provider") provider: string,
    @Query("returnTo") returnTo: unknown,
    @Req() request: ApiRequest,
    @Res() response: CookieResponse & { redirect(status: number, url: string): void },
  ): Promise<void> {
    const result = await this.authService.startOAuth(provider, returnTo, request.requestId);
    response.redirect(HttpStatus.FOUND, result.url);
  }

  @Get("auth/oauth/:provider/callback")
  async completeOAuth(
    @Param("provider") provider: string,
    @Query() query: Record<string, unknown>,
    @Req() request: ApiRequest,
    @Res() response: CookieResponse & { redirect(status: number, url: string): void },
  ): Promise<void> {
    const result = await this.authService.completeOAuth(provider, query, request.requestId);
    const config = this.authService.getConfig();
    if (result.mode === "login") {
      setSessionCookie(response, config, result.sessionToken, result.expiresAt);
    } else if (result.mode === "delete_account") {
      clearSessionCookie(response, config);
    }
    response.redirect(HttpStatus.FOUND, new URL(result.returnTo, config.publicAppUrl).toString());
  }

  @Get("me/oauth-accounts")
  @UseGuards(SessionAuthGuard)
  listOAuthAccounts(@CurrentUser() user: CurrentUserValue) {
    return this.authService.listOAuthAccounts(user);
  }

  @Get("me/oauth-accounts/:provider/start")
  @AuthRateLimit(AUTH_RATE_LIMIT_POLICIES.oauthStart)
  @UseGuards(AuthRateLimitGuard, SessionAuthGuard)
  async startOAuthLink(
    @CurrentUser() user: CurrentUserValue,
    @Param("provider") provider: string,
    @Query("returnTo") returnTo: unknown,
    @Req() request: ApiRequest,
    @Res() response: CookieResponse & { redirect(status: number, url: string): void },
  ): Promise<void> {
    const result = await this.authService.startOAuthLink(user, provider, returnTo, request.requestId);
    response.redirect(HttpStatus.FOUND, result.url);
  }

  @Delete("me/oauth-accounts/:provider")
  @UseGuards(SessionAuthGuard)
  unlinkOAuthAccount(
    @CurrentUser() user: CurrentUserValue,
    @Param("provider") provider: string,
    @Req() request: ApiRequest,
  ) {
    return this.authService.unlinkOAuthAccount(user, provider, request.requestId);
  }

  @Get("me/account-deletion/oauth/:provider/start")
  @AuthRateLimit(AUTH_RATE_LIMIT_POLICIES.oauthStart)
  @UseGuards(AuthRateLimitGuard, SessionAuthGuard)
  async startOAuthAccountDeletion(
    @CurrentUser() user: CurrentUserValue,
    @Param("provider") provider: string,
    @Query("returnTo") returnTo: unknown,
    @Req() request: ApiRequest,
    @Res() response: CookieResponse & { redirect(status: number, url: string): void },
  ): Promise<void> {
    const result = await this.authService.startOAuthAccountDeletion(
      user,
      provider,
      returnTo,
      request.requestId,
    );
    response.redirect(HttpStatus.FOUND, result.url);
  }

  @Delete("me")
  @UseGuards(SessionAuthGuard)
  async deleteAccount(
    @CurrentUser() user: CurrentUserValue,
    @Body() body: unknown,
    @Req() request: ApiRequest,
    @Res({ passthrough: true }) response: CookieResponse,
  ): Promise<{ deleted: true }> {
    const result = await this.authService.deleteAccount(user, body, request.requestId);
    clearSessionCookie(response, this.authService.getConfig());
    return result;
  }

  @Post("auth/refresh")
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() request: ApiRequest,
    @Res({ passthrough: true }) response: CookieResponse,
  ): Promise<{ user: CurrentUserValue }> {
    const config = this.authService.getConfig();
    const result = await this.authService.refresh(
      readSessionToken(request, config.sessionCookieName),
      request.requestId,
    );
    setSessionCookie(response, config, result.sessionToken, result.expiresAt);
    return { user: result.user };
  }

  @Post("auth/logout")
  @HttpCode(HttpStatus.OK)
  async logout(
    @Req() request: ApiRequest,
    @Res({ passthrough: true }) response: CookieResponse,
  ): Promise<{ loggedOut: true }> {
    const config = this.authService.getConfig();
    await this.authService.logout(readSessionToken(request, config.sessionCookieName), request.requestId);
    clearSessionCookie(response, config);
    return { loggedOut: true };
  }

  @Get("me")
  @UseGuards(SessionAuthGuard)
  me(@CurrentUser() user: CurrentUserValue): { user: CurrentUserValue } {
    return { user };
  }

  @Patch("me/age-band")
  @UseGuards(SessionAuthGuard)
  declareAgeBand(
    @CurrentUser() user: CurrentUserValue,
    @Body() body: unknown,
    @Req() request: ApiRequest,
  ) {
    return this.authService.declareAgeBand(user, body, request.requestId);
  }
}
