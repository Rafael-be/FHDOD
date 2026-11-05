import "dotenv/config";
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { PostgresShiftSheetRepository } from "../../src/modules/shifts/shift-sheet.repository.js";
import { testDatabaseUrl, usesIsolatedDatabase } from "../helpers/database.js";

const testUrl = testDatabaseUrl();
const runtimeUrl = process.env.DATABASE_URL;
const describeIntegration = usesIsolatedDatabase(testUrl, runtimeUrl) ? describe : describe.skip;

describeIntegration("PostgresShiftSheetRepository integration", () => {
  it("stores uncatalogued employee snapshots and preserves prior sheet versions", async () => {
    const sql = postgres(testUrl!, { max: 1 });
    const suffix = randomUUID().slice(0, 8);
    try {
      await sql.begin(async (tx) => {
        const repository = new PostgresShiftSheetRepository(tx as unknown as postgres.Sql);
        const sector = await tx<{ id: number }[]>`insert into sectors (code, name, created_at, updated_at) values (${`test-${suffix}`}, 'Setor de teste', now(), now()) returning id`;
        const first = await repository.replaceCurrentSheet([
          { codigo_setor: `test-${suffix}`, nome_setor: "Setor de teste", nome_turno: "Madrugada", hora_inicio: "00:00", hora_fim: "08:00", codigo_funcionario: `LOCAL-${suffix}-1`, nome_funcionario: "Funcionária Áurea", dia_semana_iso: "1", line: 2, startsAt: 0, endsAt: 480, dayOfWeek: 1 },
          { codigo_setor: `test-${suffix}`, nome_setor: "Setor de teste", nome_turno: "Madrugada", hora_inicio: "00:00", hora_fim: "08:00", codigo_funcionario: `LOCAL-${suffix}-2`, nome_funcionario: "Funcionária Áurea", dia_semana_iso: "1", line: 3, startsAt: 0, endsAt: 480, dayOfWeek: 1 },
        ], new Date("2026-01-01T00:00:00Z"));
        const second = await repository.replaceCurrentSheet([
          { codigo_setor: `test-${suffix}`, nome_setor: "Setor de teste", nome_turno: "Madrugada", hora_inicio: "00:00", hora_fim: "08:00", codigo_funcionario: `LOCAL-${suffix}-3`, nome_funcionario: "Funcionária Beatriz", dia_semana_iso: "1", line: 2, startsAt: 0, endsAt: 480, dayOfWeek: 1 },
        ], new Date("2026-01-02T00:00:00Z"));
        expect(first.versionId).toBeGreaterThan(0);
        expect(second.versionId).toBeGreaterThan(first.versionId);
        expect((await tx`select id from sector_shift_ranges where shift_sheet_version_id=${first.versionId}`)).toHaveLength(1);
        expect(await tx<{ employeeId: number | null; code: string; name: string }[]>`
          select employee_id as "employeeId", employee_code as code, employee_name as name
          from employee_shift_assignments
          where shift_sheet_version_id = ${first.versionId}
          order by code
        `).toEqual([
          { employeeId: null, code: `LOCAL-${suffix}-1`, name: "Funcionária Áurea" },
          { employeeId: null, code: `LOCAL-${suffix}-2`, name: "Funcionária Áurea" },
        ]);
        expect(await tx<{ code: string; name: string }[]>`
          select employee_code as code, employee_name as name
          from employee_shift_assignments
          where shift_sheet_version_id = ${second.versionId}
        `).toEqual([{ code: `LOCAL-${suffix}-3`, name: "Funcionária Beatriz" }]);
        expect(sector[0]!.id).toBeGreaterThan(0);
      });
    } finally {
      await sql`delete from employee_shift_assignments where sector_id in (select id from sectors where code=${`test-${suffix}`})`;
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
