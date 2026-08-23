import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
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

@Controller()
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("auth/signup")
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
  @HttpCode(HttpStatus.ACCEPTED)
  requestPasswordReset(@Body() body: unknown, @Req() request: ApiRequest) {
    return this.authService.requestPasswordReset(body, request.requestId);
  }

  @Post("auth/password-reset/confirm")
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
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(SessionAuthGuard)
  requestEmailVerification(
    @CurrentUser() user: CurrentUserValue,
    @Req() request: ApiRequest,
  ) {
    return this.authService.requestEmailVerification(user, request.requestId);
  }

  @Post("auth/email-verification/confirm")
  @HttpCode(HttpStatus.OK)
  confirmEmailVerification(@Body() body: unknown, @Req() request: ApiRequest) {
    return this.authService.confirmEmailVerification(body, request.requestId);
  }

  @Post("auth/login")
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
    setSessionCookie(response, config, result.sessionToken, result.expiresAt);
    response.redirect(HttpStatus.FOUND, new URL(result.returnTo, config.publicAppUrl).toString());
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
}
