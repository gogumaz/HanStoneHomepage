import { CanActivate, ExecutionContext, Inject, Injectable, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ApiError } from "./api-error.js";
import type { ApiRequest, ApiResponse } from "./http-types.js";
import { RATE_LIMIT_STORE, type RateLimitStore } from "./rate-limit.store.js";

export type RateLimitPolicy = {
  name: string;
  limit: number;
  windowMs: number;
  errorCode?: string;
  errorMessage?: string;
};

const RATE_LIMIT = Symbol("RATE_LIMIT");

export const RateLimit = (policy: RateLimitPolicy): MethodDecorator & ClassDecorator =>
  SetMetadata(RATE_LIMIT, policy);

export type RateLimitResult = { allowed: boolean; remaining: number; resetAt: number };

type RateLimitedRequest = ApiRequest & {
  ip?: string;
  socket?: { remoteAddress?: string };
};

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(RATE_LIMIT_STORE) private readonly store: RateLimitStore,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const policy = this.reflector.getAllAndOverride<RateLimitPolicy>(RATE_LIMIT, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!policy) return true;

    const http = context.switchToHttp();
    const request = http.getRequest<RateLimitedRequest>();
    const response = http.getResponse<ApiResponse>();
    const clientAddress = request.ip || request.socket?.remoteAddress || "unknown";
    const now = Date.now();
    let result: RateLimitResult;
    try {
      result = await this.store.consume(`${policy.name}:${clientAddress}`, policy, now);
    } catch {
      throw new ApiError(
        "RATE_LIMIT_UNAVAILABLE",
        "요청 보호 서비스를 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.",
        503,
      );
    }
    const resetSeconds = Math.max(1, Math.ceil((result.resetAt - now) / 1_000));

    response.setHeader("RateLimit-Limit", String(policy.limit));
    response.setHeader("RateLimit-Remaining", String(result.remaining));
    response.setHeader("RateLimit-Reset", String(resetSeconds));
    if (!result.allowed) {
      response.setHeader("Retry-After", String(resetSeconds));
      throw new ApiError(
        policy.errorCode ?? "RATE_LIMITED",
        policy.errorMessage ?? "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.",
        429,
      );
    }
    return true;
  }
}
