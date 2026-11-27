import "dotenv/config";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { loadMigrationConfig } from "../config/env.js";

export const migrationsFolder = resolve(process.cwd(), "src/db/migrations");
// Stable application-level lock. It coordinates all runners using this protocol.
export const MIGRATION_LOCK_KEY = 7_083_408_465n;

export type MigrationEntry = {
  idx: number;
  tag: string;
  folderMillis: number;
  hash: string;
};

export type LedgerEntry = { id?: number; hash: string; createdAt: number };
type Journal = { entries: Array<{ idx: number; tag: string; when: number }> };
type MigrationSql = postgres.Sql;

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function canonicalMigrationHash(sql: string | Buffer): string {
  const text = Buffer.isBuffer(sql) ? sql.toString("utf8") : sql;
  return sha256(Buffer.from(text.replace(/\r\n/g, "\n").replace(/\r/g, "\n"), "utf8"));
}

function assertJournal(journal: Journal): void {
  if (!Array.isArray(journal.entries) || journal.entries.length === 0) {
    throw new Error("Journal de migrations vazio ou inválido.");
  }
  const tags = new Set<string>();
  const indexes = new Set<number>();
  let previousWhen = -Infinity;
  for (const [position, entry] of journal.entries.entries()) {
    if (entry.idx !== position || indexes.has(entry.idx) || tags.has(entry.tag)) {
      throw new Error(`Journal de migrations inválido na posição ${position + 1}.`);
    }
    if (!entry.tag || !Number.isSafeInteger(entry.when) || entry.when <= previousWhen) {
      throw new Error(`Journal de migrations fora de ordem na posição ${position + 1}.`);
    }
    indexes.add(entry.idx);
    tags.add(entry.tag);
    previousWhen = entry.when;
  }
}

export function loadMigrationInventory(folder = migrationsFolder): MigrationEntry[] {
  const journal = JSON.parse(readFileSync(resolve(folder, "meta/_journal.json"), "utf8")) as Journal;
  assertJournal(journal);
  return journal.entries.map((entry) => {
    const raw = readFileSync(resolve(folder, `${entry.tag}.sql`));
    return { idx: entry.idx, tag: entry.tag, folderMillis: entry.when, hash: canonicalMigrationHash(raw) };
  });
}

function canonicalizeTree(folder: string): void {
  for (const name of readdirSync(folder)) {
    const path = resolve(folder, name);
    if (statSync(path).isDirectory()) {
      canonicalizeTree(path);
    } else if (/\.(sql|json)$/i.test(name)) {
      const text = readFileSync(path, "utf8").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      writeFileSync(path, text, "utf8");
    }
  }
}

export function prepareCanonicalMigrationFolder(source = migrationsFolder): { folder: string; cleanup: () => void } {
  const folder = mkdtempSync(resolve(tmpdir(), "fhdod-migrations-"));
  cpSync(source, folder, { recursive: true });
  canonicalizeTree(folder);
  return { folder, cleanup: () => rmSync(folder, { recursive: true, force: true }) };
}

function validateLedgerShape(actual: LedgerEntry[]): void {
  const ids = new Set<number>();
  const timestamps = new Set<number>();
  for (const [position, row] of actual.entries()) {
    if (row.id !== undefined && (!Number.isInteger(row.id) || row.id <= 0 || ids.has(row.id))) {
      throw new Error(`Ledger Drizzle contém ID duplicado ou inválido na posição ${position + 1}.`);
    }
    if (!Number.isSafeInteger(row.createdAt) || timestamps.has(row.createdAt)) {
      throw new Error(`Ledger Drizzle contém timestamp duplicado ou inválido na posição ${position + 1}.`);
    }
    if (row.id !== undefined) ids.add(row.id);
    timestamps.add(row.createdAt);
  }
}

export function assertMigrationPrefix(
  expected: Array<Pick<MigrationEntry, "hash" | "folderMillis" | "tag">>,
  actual: LedgerEntry[],
): void {
  validateLedgerShape(actual);
  if (actual.length > expected.length) {
    throw new Error(`Ledger Drizzle contém ${actual.length} entradas, mas o journal local contém apenas ${expected.length}.`);
  }
  for (const [index, row] of actual.entries()) {
    const migration = expected[index];
    if (!migration || row.hash !== migration.hash || row.createdAt !== migration.folderMillis) {
      throw new Error(`Ledger Drizzle divergente na posição ${index + 1}; esperado ${migration?.tag ?? "desconhecido"}.`);
    }
  }
}

export function assertMigrationLedger(
  expected: Array<{ hash: string; folderMillis: number }>,
  actual: LedgerEntry[],
): void {
  assertMigrationPrefix(expected.map((entry, idx) => ({ ...entry, tag: String(idx) })), actual);
  if (actual.length !== expected.length) {
    throw new Error(`Ledger Drizzle incompleto: esperadas ${expected.length} migrations, encontradas ${actual.length}.`);
  }
}

export async function readMigrationLedger(sql: MigrationSql): Promise<{ exists: boolean; entries: LedgerEntry[] }> {
  const [state] = await sql<{ exists: boolean }[]>`
    select to_regclass('drizzle.__drizzle_migrations') is not null as exists
  `;
  if (!state?.exists) return { exists: false, entries: [] };
  const rows = await sql<{ id: number; hash: string; createdAt: string }[]>`
    select id, hash, created_at as "createdAt"
    from drizzle.__drizzle_migrations
    order by created_at, id
  `;
  return { exists: true, entries: rows.map((row) => ({ id: Number(row.id), hash: row.hash, createdAt: Number(row.createdAt) })) };
}

export async function acquireMigrationLock(sql: MigrationSql): Promise<void> {
  const [row] = await sql.unsafe<{ acquired: boolean }[]>(`select pg_try_advisory_lock(${MIGRATION_LOCK_KEY}::bigint) as acquired`);
  if (!row?.acquired) {
    throw new Error("Outra execução de migrations está em andamento; nenhuma alteração foi realizada.");
  }
}

export async function releaseMigrationLock(sql: MigrationSql): Promise<void> {
  await sql.unsafe(`select pg_advisory_unlock(${MIGRATION_LOCK_KEY}::bigint)`);
}

function prepareReservedSession(client: postgres.Sql, reserved: postgres.ReservedSql): MigrationSql {
  Object.defineProperty(reserved, "options", { value: client.options });
  // ReservedSql intentionally exposes only one physical connection and does
  // not expose begin(). Drizzle needs begin() for its migration transaction.
  Object.defineProperty(reserved, "begin", {
    value: async <T>(callback: (transaction: postgres.ReservedSql) => Promise<T> | T): Promise<T> => {
      await reserved.unsafe("begin");
      try {
        const result = await callback(reserved);
        await reserved.unsafe("commit");
        return result;
      } catch (error) {
        await reserved.unsafe("rollback");
        throw error;
      }
    },
  });
  return reserved as unknown as MigrationSql;
}

export type MigrationCheckResult = { applied: MigrationEntry[]; pending: MigrationEntry[] };

export async function inspectMigrations(sql: MigrationSql, expected = loadMigrationInventory()): Promise<MigrationCheckResult> {
  const ledger = await readMigrationLedger(sql);
  if (!ledger.exists) {
    throw new Error("Ledger Drizzle inexistente; confirme o bootstrap e use MIGRATIONS_ALLOW_EMPTY_LEDGER=true apenas em banco novo preparado.");
  }
  assertMigrationPrefix(expected, ledger.entries);
  return { applied: expected.slice(0, ledger.entries.length), pending: expected.slice(ledger.entries.length) };
}

export async function runMigrations(): Promise<void> {
  const config = loadMigrationConfig();
  const canonical = prepareCanonicalMigrationFolder();
  try {
    const expected = loadMigrationInventory(canonical.folder);
    const client = postgres(config.DATABASE_URL_MIGRATIONS, { max: 1 });
    const reserved = await client.reserve();
    const session = prepareReservedSession(client, reserved);
    let locked = false;
    try {
      await acquireMigrationLock(session);
      locked = true;
      const ledger = await readMigrationLedger(session);
      if (!ledger.exists) {
        if (!config.MIGRATIONS_ALLOW_EMPTY_LEDGER) {
          throw new Error("Ledger Drizzle inexistente; migração interrompida antes de qualquer DDL.");
        }
      } else {
        assertMigrationPrefix(expected, ledger.entries);
      }
      await migrate(drizzle(session), { migrationsFolder: canonical.folder });
      const finalLedger = await readMigrationLedger(session);
      if (!finalLedger.exists) throw new Error("Ledger Drizzle não foi criado pelo migrador.");
      assertMigrationLedger(expected, finalLedger.entries);
      console.log(`Migrations confirmadas no ledger: ${finalLedger.entries.length}.`);
    } finally {
      try {
        if (locked) await releaseMigrationLock(session);
      } finally {
        reserved.release();
        await client.end({ timeout: 5 });
      }
    }
  } finally {
    canonical.cleanup();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runMigrations().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "falha desconhecida";
    console.error(`Falha na migration: ${message}`);
    process.exitCode = 1;
  });
}
