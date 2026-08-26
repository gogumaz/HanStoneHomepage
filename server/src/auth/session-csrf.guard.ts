import { CanActivate, ExecutionContext, HttpStatus, Injectable } from "@nestjs/common";
import { ApiError } from "../common/api-error.js";
import type { ApiRequest } from "../common/http-types.js";
import type { AppConfig } from "../config/app-config.js";
import { loadAppConfig } from "../config/app-config.js";
import { readSessionToken } from "./session-cookie.js";

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

type CsrfRequest = ApiRequest & {
  method?: string;
};

type CsrfConfig = Pick<AppConfig, "sessionCookieName" | "corsOrigins" | "publicAppUrl">;

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function normalizedOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function isSessionMutationAllowed(request: CsrfRequest, config: CsrfConfig): boolean {
  const method = request.method?.toUpperCase() ?? "GET";
  if (!STATE_CHANGING_METHODS.has(method)) return true;
  if (!readSessionToken(request, config.sessionCookieName)) return true;

  const originHeader = firstHeader(request.headers.origin);
  if (originHeader) {
    const origin = normalizedOrigin(originHeader);
    if (!origin) return false;
    const allowedOrigins = new Set([
      ...config.corsOrigins.map(normalizedOrigin).filter((item): item is string => Boolean(item)),
      new URL(config.publicAppUrl).origin,
    ]);
    return allowedOrigins.has(origin);
  }

  const fetchSite = firstHeader(request.headers["sec-fetch-site"])?.toLowerCase();
  return fetchSite !== "cross-site";
}

@Injectable()
export class SessionCsrfGuard implements CanActivate {
  private readonly config = loadAppConfig();

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<CsrfRequest>();
    if (isSessionMutationAllowed(request, this.config)) return true;
    throw new ApiError(
      "CSRF_ORIGIN_REJECTED",
      "허용되지 않은 출처의 요청입니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.",
      HttpStatus.FORBIDDEN,
    );
  }
}
