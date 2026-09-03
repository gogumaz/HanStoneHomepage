import type { ExecutionContext, INestApplication } from "@nestjs/common";
import { Controller, Get, UseGuards } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Reflector } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApiExceptionFilter } from "../common/api-exception.filter.js";
import { RequestIdMiddleware } from "../common/request-id.middleware.js";
import { MemoryRateLimitStore, RATE_LIMIT_STORE } from "../common/rate-limit.store.js";
import { listenForHttpTest } from "../test-utils/listen-test-app.js";
import {
  AuthRateLimit,
  AuthRateLimitGuard,
  FixedWindowRateLimiter,
  type RateLimitPolicy,
} from "./auth-rate-limit.guard.js";

const TEST_POLICY: RateLimitPolicy = { name: "test", limit: 2, windowMs: 60_000 };

@Controller("rate-limit-test")
class RateLimitTestController {
  @Get()
  @AuthRateLimit(TEST_POLICY)
  @UseGuards(AuthRateLimitGuard)
  response() {
    return { accepted: true };
  }
}

describe("FixedWindowRateLimiter", () => {
  it("isolates keys and allows requests again after the window expires", () => {
    const limiter = new FixedWindowRateLimiter();
    const policy = { name: "unit", limit: 2, windowMs: 1_000 };

    expect(limiter.consume("unit:client-a", policy, 1_000)).toMatchObject({
      allowed: true,
      remaining: 1,
    });
    expect(limiter.consume("unit:client-a", policy, 1_100)).toMatchObject({
      allowed: true,
      remaining: 0,
    });
    expect(limiter.consume("unit:client-a", policy, 1_200)).toMatchObject({
      allowed: false,
      remaining: 0,
    });
    expect(limiter.consume("unit:client-b", policy, 1_200).allowed).toBe(true);
    expect(limiter.consume("unit:client-a", policy, 2_000)).toMatchObject({
      allowed: true,
      remaining: 1,
    });
  });
});

describe("AuthRateLimitGuard HTTP headers", () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [RateLimitTestController],
      providers: [
        AuthRateLimitGuard,
        { provide: RATE_LIMIT_STORE, useValue: new MemoryRateLimitStore() },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    const requestId = new RequestIdMiddleware();
    app.use(requestId.use.bind(requestId));
    app.useGlobalFilters(new ApiExceptionFilter());
    baseUrl = await listenForHttpTest(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns remaining quota and a retry delay when the limit is exceeded", async () => {
    const first = await fetch(`${baseUrl}/rate-limit-test`);
    const second = await fetch(`${baseUrl}/rate-limit-test`);
    const blocked = await fetch(`${baseUrl}/rate-limit-test`);
    const body = await blocked.json() as { error: { code: string; requestId: string } };

    expect(first.status).toBe(200);
    expect(first.headers.get("ratelimit-limit")).toBe("2");
    expect(first.headers.get("ratelimit-remaining")).toBe("1");
    expect(second.status).toBe(200);
    expect(second.headers.get("ratelimit-remaining")).toBe("0");
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(body.error.code).toBe("AUTH_RATE_LIMITED");
    expect(body.error.requestId).toMatch(/^req_/);
  });
});

describe("AuthRateLimitGuard store failures", () => {
  it("fails closed with a structured 503 when the shared store is unavailable", async () => {
    const reflector = { getAllAndOverride: () => TEST_POLICY } as unknown as Reflector;
    const store = {
      consume: async () => { throw new Error("redis unavailable with secret detail"); },
      verifyConnection: async () => "redis" as const,
      close: async () => undefined,
    };
    const context = {
      getHandler: () => RateLimitTestController.prototype.response,
      getClass: () => RateLimitTestController,
      switchToHttp: () => ({
        getRequest: () => ({ ip: "198.51.100.50", headers: {} }),
        getResponse: () => ({ setHeader: () => undefined }),
      }),
    } as unknown as ExecutionContext;
    const guard = new AuthRateLimitGuard(reflector, store);

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      code: "RATE_LIMIT_UNAVAILABLE",
    });
  });
});
