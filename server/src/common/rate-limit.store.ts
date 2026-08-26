import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { createClient, type RedisClientType } from "redis";
import type { AppConfig } from "../config/app-config.js";
import { loadAppConfig } from "../config/app-config.js";
import type { RateLimitPolicy, RateLimitResult } from "./rate-limit.guard.js";

export const RATE_LIMIT_STORE = Symbol("RATE_LIMIT_STORE");

export interface RateLimitStore {
  consume(key: string, policy: RateLimitPolicy, now?: number): Promise<RateLimitResult>;
  verifyConnection(): Promise<"memory" | "redis">;
  close(): Promise<void>;
}

type WindowBucket = { count: number; resetAt: number };

export class FixedWindowRateLimiter {
  private readonly buckets = new Map<string, WindowBucket>();

  consume(key: string, policy: RateLimitPolicy, now = Date.now()): RateLimitResult {
    let bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + policy.windowMs };
      this.buckets.set(key, bucket);
    }
    if (bucket.count >= policy.limit) {
      return { allowed: false, remaining: 0, resetAt: bucket.resetAt };
    }
    bucket.count += 1;
    if (this.buckets.size > 10_000) this.evictExpired(now);
    return {
      allowed: true,
      remaining: Math.max(0, policy.limit - bucket.count),
      resetAt: bucket.resetAt,
    };
  }

  private evictExpired(now: number): void {
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
    if (this.buckets.size > 10_000) {
      const oldestKey = this.buckets.keys().next().value as string | undefined;
      if (oldestKey) this.buckets.delete(oldestKey);
    }
  }
}

@Injectable()
export class MemoryRateLimitStore implements RateLimitStore {
  private readonly limiter = new FixedWindowRateLimiter();

  async consume(key: string, policy: RateLimitPolicy, now = Date.now()): Promise<RateLimitResult> {
    return this.limiter.consume(key, policy, now);
  }

  async verifyConnection(): Promise<"memory"> {
    return "memory";
  }

  async close(): Promise<void> {}
}

const CONSUME_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
return {count, ttl}
`;

export class RedisRateLimitStore implements RateLimitStore, OnModuleDestroy {
  private readonly client: RedisClientType;
  private connectPromise: Promise<void> | null = null;

  constructor(
    redisUrl: string,
    private readonly keyPrefix: string,
    connectTimeoutMs: number,
  ) {
    this.client = createClient({
      url: redisUrl,
      socket: {
        connectTimeout: connectTimeoutMs,
        reconnectStrategy: false,
      },
    });
    this.client.on("error", () => undefined);
  }

  async consume(key: string, policy: RateLimitPolicy, now = Date.now()): Promise<RateLimitResult> {
    await this.connect();
    const response = await this.client.sendCommand([
      "EVAL",
      CONSUME_SCRIPT,
      "1",
      `${this.keyPrefix}${key}`,
      String(policy.windowMs),
    ]);
    if (!Array.isArray(response) || response.length !== 2) throw new Error("RATE_LIMIT_REDIS_RESPONSE_INVALID");
    const count = Number(response[0]);
    const ttlMs = Number(response[1]);
    if (!Number.isSafeInteger(count) || !Number.isFinite(ttlMs) || ttlMs <= 0) {
      throw new Error("RATE_LIMIT_REDIS_RESPONSE_INVALID");
    }
    return {
      allowed: count <= policy.limit,
      remaining: Math.max(0, policy.limit - count),
      resetAt: now + ttlMs,
    };
  }

  async verifyConnection(): Promise<"redis"> {
    await this.connect();
    const probeKey = `preflight:${process.pid}:${Date.now()}`;
    await this.consume(probeKey, { name: "preflight", limit: 1, windowMs: 10_000 });
    await this.client.del(`${this.keyPrefix}${probeKey}`);
    return "redis";
  }

  async close(): Promise<void> {
    if (!this.client.isOpen) return;
    await this.client.quit().catch(() => this.client.destroy());
  }

  async onModuleDestroy(): Promise<void> {
    await this.close();
  }

  private async connect(): Promise<void> {
    if (this.client.isReady) return;
    if (!this.connectPromise) {
      this.connectPromise = this.client.connect()
        .then(() => undefined)
        .finally(() => { this.connectPromise = null; });
    }
    await this.connectPromise;
  }
}

export function createRateLimitStore(config: AppConfig = loadAppConfig()): RateLimitStore {
  if (config.rateLimitRedisUrl) {
    return new RedisRateLimitStore(
      config.rateLimitRedisUrl,
      config.rateLimitKeyPrefix,
      config.rateLimitConnectTimeoutMs,
    );
  }
  if (config.nodeEnv === "production") {
    throw new Error("RATE_LIMIT_REDIS_URL 환경 변수가 운영 환경에 필요합니다.");
  }
  return new MemoryRateLimitStore();
}
