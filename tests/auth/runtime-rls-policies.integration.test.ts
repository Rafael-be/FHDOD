import "dotenv/config";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import postgres from "postgres";
import { testDatabaseUrl, usesIsolatedDatabase } from "../helpers/database.js";

const testUrl = testDatabaseUrl();
const runtimeUrl = process.env.DATABASE_URL;
const integration = usesIsolatedDatabase(testUrl, runtimeUrl) ? describe : describe.skip;

const rollbackMarker = "ROLLBACK_RLS_POLICY_TEST";

integration("runtime RLS policies", () => {
  it("preserves the complete Phase 1 and Phase 2 policy set when the Phase 1 migration is replayed", async () => {
    const sql = postgres(testUrl!, { max: 1 });
    const migration = await readFile(resolve(process.cwd(), "src/db/migrations/0000_enforce_runtime_rls_policies.sql"), "utf8");

    try {
      await expect(sql.begin(async (tx) => {
        await tx.unsafe(migration);
        await tx.unsafe(migration);

        const policies = await tx<{ tablename: string; cmd: string; roles: string[] }[]>`
          select tablename, cmd, roles
          from pg_policies
          where schemaname = 'public' and policyname like 'fhdod_api_%'
          order by tablename, cmd
        `;
        expect(policies).toHaveLength(37);
        expect(policies.every((policy) => policy.roles.includes("fhdod_api"))).toBe(true);
        expect(policies.some((policy) => policy.cmd === "ALL" || policy.cmd === "DELETE")).toBe(false);
        expect(policies).toEqual(expect.arrayContaining([
          expect.objectContaining({ tablename: "users", cmd: "SELECT" }),
          expect.objectContaining({ tablename: "users", cmd: "INSERT" }),
          expect.objectContaining({ tablename: "users", cmd: "UPDATE" }),
          expect.objectContaining({ tablename: "auth_sessions", cmd: "SELECT" }),
          expect.objectContaining({ tablename: "auth_sessions", cmd: "INSERT" }),
          expect.objectContaining({ tablename: "auth_sessions", cmd: "UPDATE" }),
          expect.objectContaining({ tablename: "audit_logs", cmd: "INSERT" }),
          expect.objectContaining({ tablename: "content_page_versions", cmd: "INSERT" }),
          expect.objectContaining({ tablename: "sector_shift_ranges", cmd: "SELECT" }),
          expect.objectContaining({ tablename: "questions", cmd: "SELECT" }),
          expect.objectContaining({ tablename: "questions", cmd: "INSERT" }),
          expect.objectContaining({ tablename: "questions", cmd: "UPDATE" }),
          expect.objectContaining({ tablename: "question_versions", cmd: "UPDATE" }),
          expect.objectContaining({ tablename: "question_sector_assignments", cmd: "UPDATE" }),
          expect.objectContaining({ tablename: "sector_nps_assignments", cmd: "UPDATE" }),
        ]));

        throw new Error(rollbackMarker);
      })).rejects.toThrow(rollbackMarker);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });
});
