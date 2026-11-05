import { createHash } from "node:crypto";
import { assertMigrationLedger } from "../../src/db/migrate.js";

const migration = (sql: string, folderMillis: number) => ({
  hash: createHash("sha256").update(sql).digest("hex"),
  folderMillis,
});

describe("Drizzle migration ledger verification", () => {
  const expected = [migration("select 1", 1), migration("select 2", 2)];

  it("accepts the exact ordered hashes and timestamps", () => {
    expect(() => assertMigrationLedger(expected, [
      { hash: expected[0]!.hash, createdAt: 1 },
      { hash: expected[1]!.hash, createdAt: 2 },
    ])).not.toThrow();
  });

  it("rejects a missing, reordered or mismatched ledger entry", () => {
    expect(() => assertMigrationLedger(expected, [{ hash: expected[0]!.hash, createdAt: 1 }])).toThrow("incompleto");
    expect(() => assertMigrationLedger(expected, [
      { hash: expected[1]!.hash, createdAt: 2 },
      { hash: expected[0]!.hash, createdAt: 1 },
    ])).toThrow("divergente");
  });
});
