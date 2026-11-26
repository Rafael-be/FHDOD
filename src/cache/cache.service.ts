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
  private readonly counters = { hits:0, misses:0, errors:0, reads:0, writes:0, invalidations:0, postgresFallbacks:0, readMs:0, writeMs:0 };
  metrics() { return {...this.counters, averageReadMs:this.counters.readMs/Math.max(1,this.counters.reads), averageWriteMs:this.counters.writeMs/Math.max(1,this.counters.writes)}; }
  constructor(private readonly redis: RedisClient | undefined, private readonly enabled: boolean, private readonly questionsTtlSeconds: number) {}

  private async version(key: string): Promise<number | undefined> {
    if (!this.enabled || !this.redis?.isReady()) return undefined;
    return Number((await this.redis.get(key)) ?? "0");
  }

  private effectiveKey(sectorId: number, version: number): string {
    return `${PREFIX}:questions:effective:sector:${sectorId}:v${version}`;
  }

  async getEffective<T>(sectorId: number): Promise<CacheResult<T>> {
    const started=performance.now(); this.counters.reads++;
    try {
      const version = await this.version(`${PREFIX}:questions:version`);
      if (version === undefined || !this.redis) {this.counters.misses++;this.counters.postgresFallbacks++;return { state: "miss" };}
      const key = this.effectiveKey(sectorId, version);
      const raw = await this.redis.get(key);
      if (raw === null) {this.counters.misses++;this.counters.postgresFallbacks++;return {state:"miss",version};}
      const value=JSON.parse(raw) as T; this.counters.hits++; return {state:"hit",value};
    } catch { this.counters.errors++;this.counters.postgresFallbacks++;return { state: "error" }; }
    finally {this.counters.readMs+=performance.now()-started;}
  }

  async setEffective<T>(sectorId: number, value: T, version?: number): Promise<void> {
    try {
      if (version === undefined || !this.redis || !this.enabled) return;
      const started=performance.now(); this.counters.writes++;
      try {await this.redis.set(this.effectiveKey(sectorId, version), JSON.stringify(value), this.questionsTtlSeconds);}
      finally {this.counters.writeMs+=performance.now()-started;}
    } catch { this.counters.errors++; /* fail open */ }
  }

  /** Makes every prior questions key obsolete after a committed data mutation. */
  async invalidateQuestions(): Promise<void> {
    if (!this.enabled || !this.redis?.isReady()) return;
    try { await this.redis.increment(`${PREFIX}:questions:version`);this.counters.invalidations++; } catch { this.counters.errors++; /* fail open */ }
  }
}
