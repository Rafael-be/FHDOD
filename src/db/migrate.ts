import "dotenv/config";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";
import postgres from "postgres";
import { loadMigrationConfig } from "../config/env.js";

const migrationsFolder = resolve(process.cwd(), "src/db/migrations");

type LedgerEntry = { hash: string; createdAt: number };

export function assertMigrationLedger(
  expected: Array<{ hash: string; folderMillis: number }>,
  actual: LedgerEntry[],
): void {
  if (actual.length !== expected.length) {
    throw new Error(`Ledger Drizzle incompleto: esperadas ${expected.length} migrations, encontradas ${actual.length}.`);
  }
  for (const [index, migration] of expected.entries()) {
    const ledger = actual[index];
    if (!ledger || ledger.hash !== migration.hash || ledger.createdAt !== migration.folderMillis) {
      throw new Error(`Ledger Drizzle divergente na posição ${index + 1}; a atualização foi interrompida.`);
    }
  }
}

export async function runMigrations(): Promise<void> {
  const { DATABASE_URL_MIGRATIONS } = loadMigrationConfig();
  const expected = readMigrationFiles({ migrationsFolder });
  const client = postgres(DATABASE_URL_MIGRATIONS, { max: 1 });
  try {
    await migrate(drizzle(client), { migrationsFolder });
    const rows = await client<{ hash: string; createdAt: string }[]>`
      select hash, created_at as "createdAt"
      from drizzle.__drizzle_migrations
      order by created_at
    `;
    const actual = rows.map((row) => ({ ...row, createdAt: Number(row.createdAt) }));
    assertMigrationLedger(expected, actual);
    console.log(`Migrations confirmadas no ledger: ${actual.length}.`);
  } finally {
    await client.end({ timeout: 5 });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runMigrations().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "falha desconhecida";
    console.error(`Falha na migration: ${message}`);
    process.exitCode = 1;
  });
}
