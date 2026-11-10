import { createHmac } from "node:crypto";
import type { RedisClient } from "../cache/redis.client.js";

export interface RateLimitPolicy { limit: number; windowSeconds: number; }
export interface RateLimitResult { allowed: boolean; retryAfterSeconds: number; remaining: number; source: "redis" | "local"; }
interface LocalCounter { count: number; expiresAt: number; }

/** Distributed fixed-window limiter. Redis failures use bounded per-process state. */
export class SecurityRateLimiter {
  private readonly local = new Map<string, LocalCounter>();
  constructor(private readonly redis: RedisClient | undefined, private readonly enabled: boolean, private readonly secret: string, private readonly now = () => Date.now()) {}

  private key(scope: string, subject: string): string {
    const digest = createHmac("sha256", this.secret).update(subject).digest("base64url");
    return `fhdod:security:v1:${scope}:${digest}`;
  }

  private localConsume(key: string, policy: RateLimitPolicy): RateLimitResult {
    const now = this.now();
    if (!this.local.has(key) && this.local.size >= 10_000) {
      for (const [candidate, counter] of this.local) if (counter.expiresAt <= now) this.local.delete(candidate);
      if (this.local.size >= 10_000) this.local.delete(this.local.keys().next().value as string);
    }
    const present = this.local.get(key);
    const state = !present || present.expiresAt <= now
      ? { count: 0, expiresAt: now + policy.windowSeconds * 1_000 }
      : present;
    state.count += 1;
    this.local.set(key, state);
    const retryAfterSeconds = Math.max(1, Math.ceil((state.expiresAt - now) / 1_000));
    return { allowed: state.count <= policy.limit, retryAfterSeconds, remaining: Math.max(0, policy.limit - state.count), source: "local" };
  }

  async consume(scope: string, subject: string, policy: RateLimitPolicy): Promise<RateLimitResult> {
    const key = this.key(scope, subject);
    if (this.enabled && this.redis?.isReady()) {
      try {
        const count = await this.redis.incrementWithExpiry(key, policy.windowSeconds);
        const ttl = await this.redis.ttl(key);
        return { allowed: count <= policy.limit, retryAfterSeconds: Math.max(1, ttl), remaining: Math.max(0, policy.limit - count), source: "redis" };
      } catch { /* retain per-process protection when Redis is unavailable */ }
    }
    return this.localConsume(key, policy);
  }

  async current(scope: string, subject: string): Promise<{ count: number; retryAfterSeconds: number } | undefined> {
    const key = this.key(scope, subject);
    if (this.enabled && this.redis?.isReady()) {
      try {
        const raw = await this.redis.get(key);
        if (raw === null) return undefined;
        return { count: Number(raw), retryAfterSeconds: Math.max(1, await this.redis.ttl(key)) };
      } catch { /* use local state */ }
    }
    const state = this.local.get(key);
    if (!state || state.expiresAt <= this.now()) { this.local.delete(key); return undefined; }
    return { count: state.count, retryAfterSeconds: Math.max(1, Math.ceil((state.expiresAt - this.now()) / 1_000)) };
  }

  async reset(scope: string, subject: string): Promise<void> {
    const key = this.key(scope, subject);
    this.local.delete(key);
    if (this.enabled && this.redis?.isReady()) {
      try { await this.redis.del(key); } catch { /* no security failure */ }
    }
  }
}
