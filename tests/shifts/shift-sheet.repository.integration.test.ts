import "dotenv/config";
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { PostgresShiftSheetRepository } from "../../src/modules/shifts/shift-sheet.repository.js";
import { testDatabaseUrl, usesIsolatedDatabase, assertDisposableTestDatabase } from "../helpers/database.js";
import type { ShiftSheetRow } from "../../src/modules/shifts/shift-sheet.parser.js";

const testUrl = testDatabaseUrl();
const runtimeUrl = process.env.DATABASE_URL;
const describeIntegration = usesIsolatedDatabase(testUrl, runtimeUrl) ? describe : describe.skip;
const row = (code: string, name: string, day: number, closed: boolean): ShiftSheetRow => ({
  codigo_setor: code, nome_setor: name, nome_turno: closed ? "FECHADO" : "SEM_TURNO",
  hora_inicio: closed ? "00:00" : "08:00", hora_fim: closed ? "00:00" : "17:00", dia_semana_iso: String(day),
  line: day + 1, startsAt: closed ? 0 : 480, endsAt: closed ? 0 : 1020, dayOfWeek: day, closed,
});

describeIntegration("PostgresShiftSheetRepository integration", () => {
  it("persists weekday ranges and closed days without employees, exports, and retains history", async () => {
    await assertDisposableTestDatabase(testUrl!, runtimeUrl!);
    const sql = postgres(testUrl!, { max: 1 });
    const code = `shift-${randomUUID().slice(0, 8)}`;
    try {
      await expect(sql.begin(async (tx) => {
        const sector = await tx<{ id: number }[]>`insert into sectors (code, name, created_at, updated_at) values (${code}, 'Setor de teste', now(), now()) returning id`;
        const active = await tx<{ code: string; name: string }[]>`select code, name from sectors where deleted_at is null`;
        const rows = active.flatMap((item) => Array.from({ length: 7 }, (_, i) => row(item.code, item.name, i + 1, item.code !== code || i !== 0)));
        const repository = new PostgresShiftSheetRepository(tx as unknown as postgres.Sql);
        const first = await repository.replaceCurrentSheet(rows, new Date("2026-01-01T00:00:00Z"));
        const second = await repository.replaceCurrentSheet(rows, new Date("2026-01-02T00:00:00Z"));
        expect(second.versionId).toBeGreaterThan(first.versionId);
        const ranges = await tx<{ shiftName: string; dayOfWeek: number; startsAt: string; endsAt: string }[]>`
          select shift_name as "shiftName", day_of_week as "dayOfWeek", to_char(starts_at, 'HH24:MI') as "startsAt", to_char(ends_at, 'HH24:MI') as "endsAt"
          from sector_shift_ranges where shift_sheet_version_id = ${first.versionId} and sector_id = ${sector[0]!.id}`;
        expect(ranges).toEqual([{ shiftName: "SEM_TURNO", dayOfWeek: 1, startsAt: "08:00", endsAt: "17:00" }]);
        const closed = await tx<{ day: number }[]>`select day_of_week as day from sector_shift_days where shift_sheet_version_id = ${second.versionId} and sector_id = ${sector[0]!.id} and is_closed order by day_of_week`;
        expect(closed.map((item) => item.day)).toEqual([2, 3, 4, 5, 6, 7]);
        expect(await tx`select id from employee_shift_assignments where shift_sheet_version_id = ${second.versionId}`).toHaveLength(0);
        expect((await repository.currentSheetRows()).filter((item) => item.codigo_setor === code)).toEqual([
          { codigo_setor: code, nome_setor: "Setor de teste", nome_turno: "SEM_TURNO", hora_inicio: "08:00", hora_fim: "17:00", dia_semana_iso: 1 },
          ...Array.from({ length: 6 }, (_, i) => ({ codigo_setor: code, nome_setor: "Setor de teste", nome_turno: "FECHADO", hora_inicio: "00:00", hora_fim: "00:00", dia_semana_iso: i + 2 })),
        ]);
        throw new Error("ROLLBACK_SHIFT_TEST");
      })).rejects.toThrow("ROLLBACK_SHIFT_TEST");
      expect(await sql`select id from sectors where code = ${code}`).toHaveLength(0);
    } finally { await sql.end({ timeout: 5 }); }
  });
});
