import { CanActivate, ExecutionContext, HttpStatus, Injectable } from "@nestjs/common";
import { createHash, timingSafeEqual } from "node:crypto";
import { ApiError } from "../common/api-error.js";
import type { ApiRequest } from "../common/http-types.js";
import { loadAppConfig } from "../config/app-config.js";

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

@Injectable()
export class MetricsTokenGuard implements CanActivate {
  private readonly expected = loadAppConfig().operationsMetricsToken;

  canActivate(context: ExecutionContext): boolean {
    if (!this.expected) {
      throw new ApiError(
        "OPERATIONS_METRICS_NOT_CONFIGURED",
        "운영 메트릭 인증 설정이 필요합니다.",
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    const request = context.switchToHttp().getRequest<ApiRequest>();
    const authorization = request.headers.authorization;
    const match = typeof authorization === "string" ? authorization.match(/^Bearer ([A-Za-z0-9_-]{32,200})$/i) : null;
    if (!match?.[1] || !timingSafeEqual(digest(match[1]), digest(this.expected))) {
      throw new ApiError(
        "OPERATIONS_METRICS_UNAUTHORIZED",
        "운영 메트릭 인증이 필요합니다.",
        HttpStatus.UNAUTHORIZED,
      );
    }
    return true;
  }
}
