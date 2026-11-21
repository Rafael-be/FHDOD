import "dotenv/config";
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { ShiftSheetService } from "../../src/modules/shifts/shift-sheet.service.js";
import { PostgresShiftSheetRepository } from "../../src/modules/shifts/shift-sheet.repository.js";
import { parseShiftSheet } from "../../src/modules/shifts/shift-sheet.parser.js";
import { testDatabaseUrl, usesIsolatedDatabase, assertDisposableTestDatabase } from "../helpers/database.js";

const testUrl = testDatabaseUrl();
const runtimeUrl = process.env.DATABASE_URL;
const describeIntegration = usesIsolatedDatabase(testUrl, runtimeUrl) ? describe : describe.skip;

describeIntegration("shift sheet download integration", () => {
  it("exports the current PostgreSQL version as a reimportable BOM CSV", async () => {
    await assertDisposableTestDatabase(testUrl!, runtimeUrl!);
    const sql = postgres(testUrl!, { max: 1 });
    const code = `export-${randomUUID().slice(0, 8)}`;
    try {
      await expect(sql.begin(async (tx) => {
        const sector = await tx<{ id: number }[]>`insert into sectors (code, name, created_at, updated_at) values (${code}, 'Exportação', now(), now()) returning id`;
        const active = await tx<{ id: number }[]>`select id from sectors where deleted_at is null`;
        const version = await tx<{ id: number }[]>`insert into shift_sheet_versions (version_number, csv_format, is_current) select coalesce(max(version_number), 0) + 1, 2, false from shift_sheet_versions returning id`;
        for (const item of active) for (let day = 1; day <= 7; day++) await tx`insert into sector_shift_days (shift_sheet_version_id, sector_id, day_of_week, is_closed) values (${version[0]!.id}, ${item.id}, ${day}, ${item.id !== sector[0]!.id || day !== 1})`;
        await tx`insert into sector_shift_ranges (shift_sheet_version_id, sector_id, shift_name, starts_at, ends_at, day_of_week) values (${version[0]!.id}, ${sector[0]!.id}, 'SEM_TURNO', '08:00', '17:00', 1)`;
        await tx`update shift_sheet_versions set is_current = false where is_current`;
        await tx`update shift_sheet_versions set is_current = true where id = ${version[0]!.id}`;
        const csv = await new ShiftSheetService(new PostgresShiftSheetRepository(tx as unknown as postgres.Sql)).download();
        expect([...csv.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
        const parsed = parseShiftSheet(csv);
        expect(parsed.issues).toEqual([]);
        expect(parsed.rows.filter((row) => row.codigo_setor === code)).toEqual(expect.arrayContaining([expect.objectContaining({ nome_turno: "SEM_TURNO", dayOfWeek: 1, startsAt: 480, endsAt: 1020 })]));
        expect(parsed.rows.filter((row) => row.codigo_setor === code)).toHaveLength(7);
        throw new Error("ROLLBACK_SHIFT_EXPORT");
      })).rejects.toThrow("ROLLBACK_SHIFT_EXPORT");
      expect(await sql`select id from sectors where code = ${code}`).toHaveLength(0);
    } finally { await sql.end({ timeout: 5 }); }
  });
});
