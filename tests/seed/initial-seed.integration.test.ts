import "dotenv/config";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import postgres from "postgres";
import { seedInitialData } from "../../src/db/seed/initial-seed.js";
import { usesIsolatedDatabase } from "../helpers/database.js";

const testUrl = process.env.DATABASE_URL_TEST;
const runtimeUrl = process.env.DATABASE_URL;
const integration = usesIsolatedDatabase(testUrl, runtimeUrl) ? describe : describe.skip;

integration("initial seed PostgreSQL integration", () => {
  it("creates a temporary superuser once and preserves it on a repeat run", async () => {
    const sql = postgres(testUrl!, { max: 1 });
    const email = `seed-${randomUUID().slice(0, 12)}@test.invalid`;
    try {
      await expect(sql.begin(async (tx) => {
        const executor = tx as unknown as postgres.Sql;
        const beforeLgpd = await tx<{ versions: number }[]>`select count(v.id)::int as versions from content_pages p join content_page_versions v on v.page_id=p.id where p.slug='lgpd'`;
        const firstResult = await seedInitialData(executor, { name: "Seed test", email, password: "first-temporary-password" });
        expect(firstResult.createdUser).toBe(true);
        const first = await tx<{ passwordHash: string; mustChangePassword: boolean; temporaryPasswordExpiresAt: Date }[]>`select password_hash as "passwordHash", must_change_password as "mustChangePassword", temporary_password_expires_at as "temporaryPasswordExpiresAt" from users where email=${email}`;
        expect(first).toHaveLength(1);
        expect(first[0]!.mustChangePassword).toBe(true);
        expect(first[0]!.temporaryPasswordExpiresAt.getTime()).toBeGreaterThan(Date.now() + 47 * 60 * 60_000);
        await expect(argon2.verify(first[0]!.passwordHash, "first-temporary-password")).resolves.toBe(true);
        await expect(seedInitialData(executor, { name: "Changed name", email, password: "second-temporary-password" })).resolves.toMatchObject({ createdUser: false });
        const repeated = await tx<{ passwordHash: string; fullName: string }[]>`select password_hash as "passwordHash", full_name as "fullName" from users where email=${email}`;
        expect(repeated[0]).toMatchObject({ passwordHash: first[0]!.passwordHash, fullName: "Seed test" });
        const lgpd = await tx<{ versions: number; content: string }[]>`select count(v.id)::int as versions, max(v.content) as content from content_pages p join content_page_versions v on v.page_id=p.id where p.slug='lgpd'`;
        expect(lgpd[0]!.versions).toBe(beforeLgpd[0]!.versions || 1);
        if (firstResult.createdLgpdPage) expect(lgpd[0]!.content).toBe("");
        throw new Error("ROLLBACK_SEED_TEST");
      })).rejects.toThrow("ROLLBACK_SEED_TEST");
      const remaining = await sql<{ count: number }[]>`select count(*)::int as count from users where email=${email}`;
      expect(remaining[0]!.count).toBe(0);
    } finally { await sql.end({ timeout: 5 }); }
  }, 20_000);
});
