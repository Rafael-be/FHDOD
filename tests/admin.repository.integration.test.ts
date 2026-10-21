import "dotenv/config";
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { AdminRepository } from "../src/modules/admin/admin.repository.js";

const testUrl = process.env.DATABASE_URL_TEST;
const runtimeUrl = process.env.DATABASE_URL;
const describeIntegration = testUrl && runtimeUrl && new URL(testUrl).href !== new URL(runtimeUrl).href ? describe : describe.skip;

describeIntegration("AdminRepository PostgreSQL integration", () => {
  it("persists manager, sector and assignment then rolls all changes back", async () => {
    const sql = postgres(testUrl!, { max: 1 }); const suffix = randomUUID().slice(0, 8);
    try {
      await expect(sql.begin(async (tx) => {
        const repository = new AdminRepository(tx as unknown as postgres.Sql);
        const sector = await repository.createSector(`test-${suffix}`, "Setor sintético", null);
        const manager = await repository.createManager("Gestor sintético", `manager-${suffix}@test.invalid`, "hash", new Date(Date.now() + 86_400_000));
        await repository.assign(manager.id, sector.id, manager.id);
        expect(await repository.managerSectors(manager.id)).toEqual(expect.arrayContaining([expect.objectContaining({ id: sector.id })]));
        throw new Error("ROLLBACK_TEST");
      })).rejects.toThrow("ROLLBACK_TEST");
      const remains = await sql<{ count: number }[]>`select count(*)::int as count from sectors where code=${`test-${suffix}`}`;
      expect(remains[0]!.count).toBe(0);
    } finally { await sql.end({ timeout: 5 }); }
  });
});
