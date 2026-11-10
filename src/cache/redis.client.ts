import { createClient, type RedisClientType } from "redis";
import type { AppConfig } from "../config/env.js";

export interface RedisClient {
  connect(): Promise<void>;
  close(): Promise<void>;
  isReady(): boolean;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
  increment(key: string): Promise<number>;
  incrementWithExpiry(key: string, ttlSeconds: number): Promise<number>;
  ttl(key: string): Promise<number>;
}

const MAX_RECONNECT_ATTEMPTS = 3;
const COMMAND_TIMEOUT_MS = 500;

/** A single, best-effort Redis connection for the process. */
export class NodeRedisClient implements RedisClient {
  private readonly client: RedisClientType;
  private connectPromise: Promise<void> | undefined;

  constructor(config: Pick<AppConfig, "REDIS_URL" | "CACHE_ENABLED">) {
    this.client = createClient({
      url: config.REDIS_URL,
      socket: {
        connectTimeout: 1_000,
        reconnectStrategy: (retries) => retries >= MAX_RECONNECT_ATTEMPTS ? false : Math.min(100 * 2 ** retries, 1_000),
      },
      disableOfflineQueue: true,
    });
    this.client.on("error", () => {
      // Operations fail open. Do not log error objects: URLs may contain secrets.
    });
  }

  async connect(): Promise<void> {
    if (this.client.isReady) return;
    if (!this.connectPromise) {
      this.connectPromise = this.client.connect().then(() => undefined).catch((error: unknown) => {
        this.connectPromise = undefined;
        throw error;
      });
    }
    await this.connectPromise;
  }

  async close(): Promise<void> { if (this.client.isOpen) await this.client.quit(); }
  isReady(): boolean { return this.client.isReady; }
  private async command<T>(operation: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Redis command timed out")), COMMAND_TIMEOUT_MS); }),
      ]);
    } finally { if (timer) clearTimeout(timer); }
  }
  async get(key: string): Promise<string | null> { return this.command(this.client.get(key)); }
  async set(key: string, value: string, ttlSeconds: number): Promise<void> { await this.command(this.client.set(key, value, { EX: ttlSeconds })); }
  async del(key: string): Promise<void> { await this.command(this.client.del(key)); }
  async increment(key: string): Promise<number> { return this.command(this.client.incr(key)); }
  async incrementWithExpiry(key: string, ttlSeconds: number): Promise<number> {
    return this.command(this.client.eval(
      "local count=redis.call('INCR', KEYS[1]); if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]); end; return count",
      { keys: [key], arguments: [String(ttlSeconds)] },
    ) as Promise<number>);
  }
  async ttl(key: string): Promise<number> { return this.command(this.client.ttl(key)); }
}
