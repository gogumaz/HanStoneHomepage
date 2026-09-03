import { CanActivate, ExecutionContext, HttpStatus, Injectable } from "@nestjs/common";
import { ApiError } from "../common/api-error.js";
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
    const status = request.user.minorAccountStatus;
    if (status === "age_declaration_required" || status === "guardian_consent_pending") {
      const path = (request.originalUrl ?? request.url ?? "").split("?", 1)[0] ?? "";
      const method = request.method?.toUpperCase() ?? "GET";
      const allowed = (
        (method === "GET" && path.endsWith("/api/v1/me"))
        || (method === "PATCH" && path.endsWith("/api/v1/me/age-band"))
        || (method === "POST" && path.endsWith("/api/v1/me/guardian-invitations"))
        || (method === "POST" && path.includes("/api/v1/me/guardian-links/"))
        || (method === "POST" && path.endsWith("/api/v1/auth/email-verification/request"))
        || (method === "DELETE" && path.endsWith("/api/v1/me"))
      );
      if (!allowed) {
        throw new ApiError(
          status === "age_declaration_required" ? "AGE_DECLARATION_REQUIRED" : "GUARDIAN_CONSENT_REQUIRED",
          status === "age_declaration_required"
            ? "서비스 이용 전에 연령대를 확인해 주세요."
            : "법정대리인 동의가 확인될 때까지 계정 이용이 제한됩니다.",
          HttpStatus.FORBIDDEN,
        );
      }
    }
    return true;
  }
}
