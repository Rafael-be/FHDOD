import type { RedisClient } from "./redis.client.js";

export type CacheResult<T> = { state: "hit"; value: T } | { state: "miss"; version?: number } | { state: "error" };

export interface QuestionsCache {
  getEffective<T>(sectorId: number): Promise<CacheResult<T>>;
  setEffective<T>(sectorId: number, value: T, version?: number): Promise<void>;
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

  private effectiveKey(sectorId: number, version: number): string {
    return `${PREFIX}:questions:effective:sector:${sectorId}:v${version}`;
  }

  async getEffective<T>(sectorId: number): Promise<CacheResult<T>> {
    try {
      const version = await this.version(`${PREFIX}:questions:version`);
      if (version === undefined || !this.redis) return { state: "miss" };
      const key = this.effectiveKey(sectorId, version);
      const raw = await this.redis.get(key);
      return raw === null ? { state: "miss", version } : { state: "hit", value: JSON.parse(raw) as T };
    } catch { return { state: "error" }; }
  }

  async setEffective<T>(sectorId: number, value: T, version?: number): Promise<void> {
    try {
      if (version === undefined || !this.redis || !this.enabled) return;
      await this.redis.set(this.effectiveKey(sectorId, version), JSON.stringify(value), this.questionsTtlSeconds);
    } catch { /* fail open */ }
  }

  /** Makes every prior questions key obsolete after a committed data mutation. */
  async invalidateQuestions(): Promise<void> {
    if (!this.enabled || !this.redis?.isReady()) return;
    try { await this.redis.increment(`${PREFIX}:questions:version`); } catch { /* fail open */ }
  }
}
