import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import type { ApiRequest } from "../common/http-types.js";
import { AuthService } from "./auth.service.js";
import { readSessionToken } from "./session-cookie.js";

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ApiRequest>();
    const config = this.authService.getConfig();
    request.user = await this.authService.authenticate(
      readSessionToken(request, config.sessionCookieName),
    );
    return true;
  }
}
