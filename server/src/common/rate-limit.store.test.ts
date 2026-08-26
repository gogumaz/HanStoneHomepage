import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { AppConfig } from "../config/app-config.js";
import {
  createRateLimitStore,
  MemoryRateLimitStore,
  RedisRateLimitStore,
} from "./rate-limit.store.js";

describe("rate-limit stores", () => {
  it("uses memory outside production and requires Redis in production", () => {
    const development = { nodeEnv: "development", rateLimitRedisUrl: null } as AppConfig;
    const production = { nodeEnv: "production", rateLimitRedisUrl: null } as AppConfig;
    expect(createRateLimitStore(development)).toBeInstanceOf(MemoryRateLimitStore);
    expect(() => createRateLimitStore(production)).toThrow(/RATE_LIMIT_REDIS_URL/);
  });

  it("fails closed when the shared store is unavailable", async () => {
    const store = new RedisRateLimitStore(
      "redis://127.0.0.1:1",
      "test:unavailable:",
      500,
    );
    await expect(store.consume("login:client", { name: "login", limit: 2, windowMs: 1_000 }))
      .rejects.toBeDefined();
    await store.close();
  });
});

const redisTestUrl = process.env.RATE_LIMIT_REDIS_TEST_URL;
const integration = redisTestUrl ? describe : describe.skip;

integration("RedisRateLimitStore integration", () => {
  it("shares one atomic fixed window across application instances", async () => {
    const prefix = `bhj:test:${randomUUID()}:`;
    const firstStore = new RedisRateLimitStore(redisTestUrl!, prefix, 2_000);
    const secondStore = new RedisRateLimitStore(redisTestUrl!, prefix, 2_000);
    const policy = { name: "shared", limit: 2, windowMs: 250 };
    try {
      expect(await firstStore.verifyConnection()).toBe("redis");
      expect(await firstStore.consume("shared:client", policy)).toMatchObject({ allowed: true, remaining: 1 });
      expect(await secondStore.consume("shared:client", policy)).toMatchObject({ allowed: true, remaining: 0 });
      expect(await firstStore.consume("shared:client", policy)).toMatchObject({ allowed: false, remaining: 0 });
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(await secondStore.consume("shared:client", policy)).toMatchObject({ allowed: true, remaining: 1 });
    } finally {
      await Promise.all([firstStore.close(), secondStore.close()]);
    }
  });
});
