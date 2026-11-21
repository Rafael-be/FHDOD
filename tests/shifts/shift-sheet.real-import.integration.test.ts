import "dotenv/config";
import postgres from "postgres";
import { parseShiftSheet } from "../../src/modules/shifts/shift-sheet.parser.js";
import { PostgresShiftSheetRepository } from "../../src/modules/shifts/shift-sheet.repository.js";
import { ShiftSheetService } from "../../src/modules/shifts/shift-sheet.service.js";
import { assertDisposableTestDatabase, testDatabaseUrl, usesIsolatedDatabase } from "../helpers/database.js";

const adminUrl = testDatabaseUrl();
const runtimeUrl = process.env.DATABASE_URL;
const describeIntegration = usesIsolatedDatabase(adminUrl, runtimeUrl) ? describe : describe.skip;

describeIntegration("importação CSV real da planilha de horários", () => {
  it("persiste uma nova versão com o formato sem funcionários", async () => {
    await assertDisposableTestDatabase(adminUrl!, runtimeUrl!);
    const sql = postgres(adminUrl!, { max: 1 });
    try {
      const sectors = await sql<{ code: string; name: string }[]>`
        select code, name from sectors where deleted_at is null order by code
      `;
      const target = sectors[0];
      if (!target) throw new Error("O banco local não possui setor ativo para o teste.");
      const rows = sectors.flatMap((sector) => Array.from({ length: 7 }, (_, index) => {
        const day = index + 1;
        return sector.code === target.code && day === 1
          ? `${sector.code};${sector.name};SEM_TURNO;08:00;17:00;1`
          : `${sector.code};${sector.name};FECHADO;00:00;00:00;${day}`;
      }));
      const csv = `\ufeffcodigo_setor;nome_setor;nome_turno;hora_inicio;hora_fim;dia_semana_iso\r\n${rows.join("\r\n")}\r\n`;
      const parsed = parseShiftSheet(new TextEncoder().encode(csv));
      expect(parsed.issues).toEqual([]);
      const service = new ShiftSheetService(new PostgresShiftSheetRepository(sql), () => new Date("2026-02-01T00:00:00Z"));
      const result = await service.import(new TextEncoder().encode(csv));
      expect(result.versionId).toBeGreaterThan(0);
      const persisted = await sql<{ versionId: number; format: number; current: boolean; count: number }[]>`
        select v.id as "versionId", v.csv_format as format, v.is_current as current,
          (select count(*)::int from sector_shift_days d where d.shift_sheet_version_id = v.id) as count
        from shift_sheet_versions v where v.id = ${result.versionId}
      `;
      expect(persisted).toEqual([{ versionId: result.versionId, format: 2, current: true, count: sectors.length * 7 }]);
      const targetRange = await sql<{ code: string; shiftName: string; startsAt: string; endsAt: string; day: number }[]>`
        select s.code, r.shift_name as "shiftName", to_char(r.starts_at, 'HH24:MI') as "startsAt",
          to_char(r.ends_at, 'HH24:MI') as "endsAt", r.day_of_week as day
        from sector_shift_ranges r join sectors s on s.id = r.sector_id
        where r.shift_sheet_version_id = ${result.versionId} and s.code = ${target.code}
      `;
      expect(targetRange).toEqual([{ code: target.code, shiftName: "SEM_TURNO", startsAt: "08:00", endsAt: "17:00", day: 1 }]);
      expect(await sql`select count(*)::int as count from employee_shift_assignments where shift_sheet_version_id = ${result.versionId}`).toEqual([{ count: 0 }]);
      await sql`delete from sector_shift_ranges where shift_sheet_version_id = ${result.versionId}`;
      await sql`delete from sector_shift_days where shift_sheet_version_id = ${result.versionId}`;
      await sql`delete from shift_upload_attempts where resulting_version_id = ${result.versionId}`;
      await sql`delete from shift_sheet_versions where id = ${result.versionId}`;
    } finally {
      await sql.end({ timeout: 5 });
    }
  });
});
