import type { RedisClient } from "./redis.client.js";

export type CacheResult<T> = { state: "hit"; value: T } | { state: "miss" | "error" };

export interface QuestionsCache {
  getEffective<T>(sectorId: number): Promise<CacheResult<T>>;
  setEffective<T>(sectorId: number, value: T): Promise<void>;
  invalidateQuestions(): Promise<void>;
}

const PREFIX = "fhdod:cache:v1";

/** Cache-aside storage with versioned key groups; no scans or Redis-wide wipes. */
export class RedisCacheService implements QuestionsCache {
  constructor(private readonly redis: RedisClient | undefined, private readonly enabled: boolean, private readonly questionsTtlSeconds: number) {}

  private async version(key: string): Promise<number | undefined> {
    if (!this.enabled || !this.redis?.isReady()) return undefined;
    return Number((await this.redis.get(key)) ?? "0");
  }

  private async effectiveKey(sectorId: number): Promise<string | undefined> {
    const version = await this.version(`${PREFIX}:questions:version`);
    return version === undefined ? undefined : `${PREFIX}:questions:effective:sector:${sectorId}:v${version}`;
  }

  async getEffective<T>(sectorId: number): Promise<CacheResult<T>> {
    try {
      const key = await this.effectiveKey(sectorId);
      if (!key || !this.redis) return { state: "miss" };
      const raw = await this.redis.get(key);
      return raw === null ? { state: "miss" } : { state: "hit", value: JSON.parse(raw) as T };
    } catch { return { state: "error" }; }
  }

  async setEffective<T>(sectorId: number, value: T): Promise<void> {
    try {
      const key = await this.effectiveKey(sectorId);
      if (!key || !this.redis) return;
      await this.redis.set(key, JSON.stringify(value), this.questionsTtlSeconds);
    } catch { /* fail open */ }
  }

  /** Makes every prior questions key obsolete after a committed data mutation. */
  async invalidateQuestions(): Promise<void> {
    if (!this.enabled || !this.redis?.isReady()) return;
    try { await this.redis.increment(`${PREFIX}:questions:version`); } catch { /* fail open */ }
  }
}
