import "dotenv/config";
import postgres from "postgres";
import { loadMigrationConfig } from "../config/env.js";
import {
  acquireMigrationLock,
  inspectMigrations,
  migrationsFolder,
  releaseMigrationLock,
  loadMigrationInventory,
} from "./migrate.js";

async function main(): Promise<void> {
  const config = loadMigrationConfig();
  const expected = loadMigrationInventory(migrationsFolder);
  const client = postgres(config.DATABASE_URL_MIGRATIONS, { max: 1 });
  const reserved = await client.reserve();
  Object.defineProperty(reserved, "options", { value: client.options });
  const session = reserved as unknown as postgres.Sql;
  let locked = false;
  try {
    await acquireMigrationLock(session);
    locked = true;
    const result = await inspectMigrations(session, expected);
    console.log("Migration history validation: PASSED");
    console.log(`Applied migrations: ${result.applied.length}`);
    console.log(`Pending migrations: ${result.pending.length}`);
    if (result.pending.length) {
      console.log("\nPending:");
      for (const migration of result.pending) console.log(migration.tag);
    }
    console.log("\nDatabase schema was not modified.");
  } finally {
    try {
      if (locked) await releaseMigrationLock(session);
    } finally {
      reserved.release();
      await client.end({ timeout: 5 });
    }
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "falha desconhecida";
  console.error(`Migration check failed: ${message}`);
  process.exitCode = 1;
});
