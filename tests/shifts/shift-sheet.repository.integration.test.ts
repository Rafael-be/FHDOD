import "dotenv/config";
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { PostgresShiftSheetRepository } from "../../src/modules/shifts/shift-sheet.repository.js";
import { usesIsolatedDatabase } from "../helpers/database.js";

const testUrl = process.env.DATABASE_URL_TEST;
const runtimeUrl = process.env.DATABASE_URL;
const describeIntegration = usesIsolatedDatabase(testUrl, runtimeUrl) ? describe : describe.skip;

describeIntegration("PostgresShiftSheetRepository integration", () => {
  it("creates a current version and preserves it until the transaction commits", async () => {
    const sql = postgres(testUrl!, { max: 1 });
    const suffix = randomUUID().slice(0, 8);
    try {
      await sql.begin(async (tx) => {
        const repository = new PostgresShiftSheetRepository(tx as unknown as postgres.Sql);
        const sector = await tx<{ id: number }[]>`insert into sectors (code, name, created_at, updated_at) values (${`test-${suffix}`}, 'Setor de teste', now(), now()) returning id`;
        const employee = await tx<{ id: number }[]>`insert into employees (employee_code, full_name) values (${`EMP-${suffix}`}, 'Funcionário de teste') returning id`;
        const result = await repository.replaceCurrentSheet([
          { codigo_setor: `test-${suffix}`, nome_setor: "Setor de teste", nome_turno: "Madrugada", hora_inicio: "00:00", hora_fim: "08:00", codigo_funcionario: `EMP-${suffix}`, nome_funcionario: "Funcionário de teste", dia_semana_iso: "1", line: 2, startsAt: 0, endsAt: 480, dayOfWeek: 1 },
        ], new Date("2026-01-01T00:00:00Z"));
        expect(result.versionId).toBeGreaterThan(0);
        expect((await tx`select id from sector_shift_ranges where shift_sheet_version_id=${result.versionId}`)).toHaveLength(1);
        expect(sector[0]!.id).toBeGreaterThan(0);
        expect(employee[0]!.id).toBeGreaterThan(0);
      });
    } finally {
      await sql`delete from employee_shift_assignments where employee_id in (select id from employees where employee_code=${`EMP-${suffix}`})`;
      await sql`delete from employees where employee_code=${`EMP-${suffix}`}`;
      await sql`delete from sector_shift_ranges where sector_id in (select id from sectors where code=${`test-${suffix}`})`;
      await sql`delete from shift_sheet_versions where version_number > 1 and id not in (select shift_sheet_version_id from sector_shift_ranges)`;
      await sql`delete from sectors where code=${`test-${suffix}`}`;
      await sql.end({ timeout: 5 });
    }
  });

  it("rolls back the version when persistence fails", async () => {
    const sql = postgres(testUrl!, { max: 1 });
    const before = await sql<{ count: number }[]>`select count(*)::int as count from shift_sheet_versions`;
    try {
      await expect(sql.begin(async (tx) => {
        const repository = new PostgresShiftSheetRepository(tx as unknown as postgres.Sql);
        await repository.replaceCurrentSheet([], new Date());
        throw new Error("ROLLBACK_SHIFT_TEST");
      })).rejects.toThrow("ROLLBACK_SHIFT_TEST");
      const after = await sql<{ count: number }[]>`select count(*)::int as count from shift_sheet_versions`;
      expect(after[0]!.count).toBe(before[0]!.count);
    } finally { await sql.end({ timeout: 5 }); }
  });
});
