import type { RedisClient } from "../../src/cache/redis.client.js";
import { SecurityRateLimiter } from "../../src/security/rate-limiter.js";

class FakeRedis implements RedisClient {
  readonly values = new Map<string, number>();
  async connect(): Promise<void> {}
  async close(): Promise<void> {}
  isReady(): boolean { return true; }
  async get(key: string): Promise<string | null> { const value = this.values.get(key); return value === undefined ? null : String(value); }
  async set(): Promise<void> {}
  async del(key: string): Promise<void> { this.values.delete(key); }
  async increment(key: string): Promise<number> { return this.incrementWithExpiry(key, 60); }
  async incrementWithExpiry(key: string): Promise<number> { const count = (this.values.get(key) ?? 0) + 1; this.values.set(key, count); return count; }
  async ttl(): Promise<number> { return 60; }
}

describe("SecurityRateLimiter", () => {
  const policy = { limit: 2, windowSeconds: 60 };
  it("allows requests within the shared limit and rejects the next one atomically", async () => {
    const redis = new FakeRedis();
    const limiter = new SecurityRateLimiter(redis, true, "a secret used exclusively for tests");
    await expect(limiter.consume("login", "203.0.113.1", policy)).resolves.toMatchObject({ allowed: true, source: "redis" });
    await expect(limiter.consume("login", "203.0.113.1", policy)).resolves.toMatchObject({ allowed: true });
    await expect(limiter.consume("login", "203.0.113.1", policy)).resolves.toMatchObject({ allowed: false, retryAfterSeconds: 60 });
  });

  it("does not place the raw IP or identifier in Redis keys", async () => {
    const redis = new FakeRedis();
    const limiter = new SecurityRateLimiter(redis, true, "test-key");
    await limiter.consume("login", "person@hospital.test", policy);
    const key = [...redis.values.keys()][0]!;
    expect(key).toContain("fhdod:security:v1:login:");
    expect(key).not.toContain("person@hospital.test");
  });

  it("falls back to process-local protection when Redis is unavailable", async () => {
    const redis: RedisClient = { connect: async () => undefined, close: async () => undefined, isReady: () => true, get: async () => { throw new Error("down"); }, set: async () => undefined, del: async () => undefined, increment: async () => 0, incrementWithExpiry: async () => { throw new Error("down"); }, ttl: async () => 0 };
    const limiter = new SecurityRateLimiter(redis, true, "test-key");
    await expect(limiter.consume("public", "shared-network", { limit: 1, windowSeconds: 60 })).resolves.toMatchObject({ allowed: true, source: "local" });
    await expect(limiter.consume("public", "shared-network", { limit: 1, windowSeconds: 60 })).resolves.toMatchObject({ allowed: false, source: "local" });
  });

  it("isolates subjects and resets an identifier after successful login", async () => {
    const redis = new FakeRedis();
    const limiter = new SecurityRateLimiter(redis, true, "test-key");
    await limiter.consume("failure", "a@hospital.test", policy);
    expect((await limiter.current("failure", "b@hospital.test"))?.count).toBeUndefined();
    await limiter.reset("failure", "a@hospital.test");
    await expect(limiter.current("failure", "a@hospital.test")).resolves.toBeUndefined();
  });
});
