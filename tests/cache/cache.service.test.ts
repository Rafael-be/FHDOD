import { RedisCacheService } from "../../src/cache/cache.service.js";
import type { RedisClient } from "../../src/cache/redis.client.js";

class MemoryRedis implements RedisClient {
  readonly values = new Map<string, string>();
  async connect(): Promise<void> {}
  async close(): Promise<void> {}
  isReady(): boolean { return true; }
  async get(key: string): Promise<string | null> { return this.values.get(key) ?? null; }
  async set(key: string, value: string): Promise<void> { this.values.set(key, value); }
  async del(key: string): Promise<void> { this.values.delete(key); }
  async increment(key: string): Promise<number> { const value = Number(this.values.get(key) ?? "0") + 1; this.values.set(key, String(value)); return value; }
  async incrementWithExpiry(key: string): Promise<number> { return this.increment(key); }
  async ttl(): Promise<number> { return 60; }
}

describe("RedisCacheService", () => {
  it("isolates effective questions by sector and makes old entries obsolete on invalidation", async () => {
    const redis = new MemoryRedis();
    const cache = new RedisCacheService(redis, true, 60);
    const sector4 = await cache.getEffective<{ id: number }[]>(4);
    const sector5 = await cache.getEffective<{ id: number }[]>(5);
    await cache.setEffective(4, [{ id: 1 }], sector4.state === "miss" ? sector4.version : undefined);
    await cache.setEffective(5, [{ id: 2 }], sector5.state === "miss" ? sector5.version : undefined);
    await expect(cache.getEffective<{ id: number }[]>(4)).resolves.toEqual({ state: "hit", value: [{ id: 1 }] });
    await expect(cache.getEffective<{ id: number }[]>(5)).resolves.toEqual({ state: "hit", value: [{ id: 2 }] });
    await cache.invalidateQuestions();
    await expect(cache.getEffective<{ id: number }[]>(4)).resolves.toEqual({ state: "miss", version: 1 });
  });

  it("treats an unavailable Redis client as a cache miss", async () => {
    const redis: RedisClient = { connect: async () => undefined, close: async () => undefined, isReady: () => false, get: async () => { throw new Error("unavailable"); }, set: async () => undefined, del: async () => undefined, increment: async () => 0, incrementWithExpiry: async () => 0, ttl: async () => 0 };
    await expect(new RedisCacheService(redis, true, 60).getEffective(4)).resolves.toEqual({ state: "miss" });
  });

  it("never writes a late pre-invalidation value under the new version", async () => {
    const cache = new RedisCacheService(new MemoryRedis(), true, 60);
    const pending = await cache.getEffective<{ id: number }[]>(4);
    expect(pending).toMatchObject({ state: "miss", version: 0 });
    await cache.invalidateQuestions();
    await cache.setEffective(4, [{ id: 1 }], pending.state === "miss" ? pending.version : undefined);
    await expect(cache.getEffective<{ id: number }[]>(4)).resolves.toEqual({ state: "miss", version: 1 });
  });

  it("reports a Redis operation failure without exposing it to callers", async () => {
    const redis: RedisClient = { connect: async () => undefined, close: async () => undefined, isReady: () => true, get: async () => { throw new Error("unavailable"); }, set: async () => undefined, del: async () => undefined, increment: async () => 0, incrementWithExpiry: async () => 0, ttl: async () => 0 };
    await expect(new RedisCacheService(redis, true, 60).getEffective(4)).resolves.toEqual({ state: "error" });
  });
});

it("counts cache outcomes without retaining keys or payloads",async()=>{
  const redis=new MemoryRedis();const cache=new RedisCacheService(redis,true,60);
  const miss=await cache.getEffective(1);
  await cache.setEffective(1,[{id:9}],miss.state==='miss'?miss.version:undefined);
  await cache.getEffective(1);await cache.invalidateQuestions();
  expect(cache.metrics()).toMatchObject({hits:1,misses:1,postgresFallbacks:1,reads:2,writes:1,invalidations:1,errors:0});
  expect(cache.metrics().averageReadMs).toBeGreaterThanOrEqual(0);
  redis.get=async()=>{throw new Error('unavailable');};
  await cache.getEffective(1);
  expect(cache.metrics()).toMatchObject({errors:1,postgresFallbacks:2});
  expect(JSON.stringify(cache.metrics())).not.toContain('fhdod:');
});
