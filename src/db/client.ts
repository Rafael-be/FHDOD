import { recordDatabaseQuery } from "../shared/performance.js";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { AppConfig } from "../config/env.js";

export function createDatabase(config: AppConfig) {
  const client = postgres(config.DATABASE_URL, { max: 10, prepare: false, ...(config.PERFORMANCE_MEASUREMENTS ? {debug: recordDatabaseQuery} : {}) });
  return { db: drizzle(client), client, close: () => client.end({ timeout: 5 }) };
}

