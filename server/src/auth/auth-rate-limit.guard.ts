import {
  RateLimit,
  type RateLimitPolicy,
} from "../common/rate-limit.guard.js";

export {
  RateLimitGuard as AuthRateLimitGuard,
  type RateLimitPolicy,
  type RateLimitResult,
} from "../common/rate-limit.guard.js";
export { FixedWindowRateLimiter } from "../common/rate-limit.store.js";

export const AUTH_RATE_LIMIT_POLICIES = {
  signup: { name: "signup", limit: 10, windowMs: 10 * 60_000 },
  login: { name: "login", limit: 10, windowMs: 5 * 60_000 },
  recovery: { name: "recovery", limit: 5, windowMs: 15 * 60_000 },
  oauthStart: { name: "oauth-start", limit: 20, windowMs: 5 * 60_000 },
} as const satisfies Record<string, RateLimitPolicy>;

export const AuthRateLimit = (policy: RateLimitPolicy): MethodDecorator & ClassDecorator => RateLimit({
  ...policy,
  errorCode: "AUTH_RATE_LIMITED",
  errorMessage: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.",
});
