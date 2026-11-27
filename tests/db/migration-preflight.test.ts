import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertMigrationPrefix,
  canonicalMigrationHash,
  loadMigrationInventory,
  MIGRATION_LOCK_KEY,
} from "../../src/db/migrate.js";

const expected = [
  { idx: 0, tag: "0000_first", folderMillis: 10, hash: createHash("sha256").update("select 1").digest("hex") },
  { idx: 1, tag: "0001_second", folderMillis: 20, hash: createHash("sha256").update("select 2").digest("hex") },
];

describe("migration preflight", () => {
  it("uses the same canonical LF hash for LF and CRLF text", () => {
    expect(canonicalMigrationHash("select 1\nselect 2\n")).toBe(canonicalMigrationHash("select 1\r\nselect 2\r\n"));
  });

  it("accepts a valid prefix and identifies the pending suffix", () => {
    expect(() => assertMigrationPrefix(expected, [{ hash: expected[0]!.hash, createdAt: 10 }])).not.toThrow();
  });

  it("rejects historical hash, timestamp, duplicate and unknown entries", () => {
    expect(() => assertMigrationPrefix(expected, [{ hash: "wrong", createdAt: 10 }])).toThrow("divergente");
    expect(() => assertMigrationPrefix(expected, [{ hash: expected[0]!.hash, createdAt: 11 }])).toThrow("divergente");
    expect(() => assertMigrationPrefix(expected, [
      { hash: expected[0]!.hash, createdAt: 10 },
      { hash: expected[0]!.hash, createdAt: 10 },
    ])).toThrow("duplicado");
    expect(() => assertMigrationPrefix(expected, [
      { hash: expected[0]!.hash, createdAt: 10 },
      { hash: expected[1]!.hash, createdAt: 20 },
      { hash: "unknown", createdAt: 30 },
    ])).toThrow("apenas");
  });

  it("uses a stable advisory lock identifier", () => {
    expect(MIGRATION_LOCK_KEY).toBe(7_083_408_465n);
  });

  it("rejects CRLF before the migrator can execute DDL", () => {
    const folder = mkdtempSync(join(tmpdir(), "fhdod-migration-preflight-"));
    try {
      mkdirSync(join(folder, "meta"));
      writeFileSync(join(folder, "meta", "_journal.json"), JSON.stringify({ entries: [{ idx: 0, tag: "0000_first", when: 10 }] }));
      writeFileSync(join(folder, "0000_first.sql"), "select 1;\r\n");
      expect(() => loadMigrationInventory(folder)).toThrow("não está em LF");
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });
});
