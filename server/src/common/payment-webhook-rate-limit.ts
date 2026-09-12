import type { RateLimitPolicy } from "./rate-limit.guard.js";

export const TOSS_PAYMENT_WEBHOOK_RATE_LIMIT: RateLimitPolicy = Object.freeze({
  name: "toss-payment-webhook",
  limit: 120,
  windowMs: 60_000,
  errorCode: "TOSS_PAYMENT_WEBHOOK_RATE_LIMITED",
  errorMessage: "결제 상태 알림 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.",
});
