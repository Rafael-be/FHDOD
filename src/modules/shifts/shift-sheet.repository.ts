import type postgres from "postgres";
import type { ParsedShiftSheet } from "./shift-sheet.parser.js";
import type { ShiftSectorReference, ShiftSheetDownloadRow, ShiftSheetRepository } from "./shift-sheet.service.js";

export class PostgresShiftSheetRepository implements ShiftSheetRepository {
  constructor(private readonly sql: postgres.Sql) {}
  async sectors(): Promise<ShiftSectorReference[]> {
    return this.sql<ShiftSectorReference[]>`select code, name, (deleted_at is null) as active from sectors order by code`;
  }
  async transaction<T>(work: (repository: ShiftSheetRepository) => Promise<T>): Promise<T> {
    return this.sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(72481561)`;
      return work(new PostgresShiftSheetRepository(tx as unknown as postgres.Sql));
    }) as Promise<T>;
  }
  async replaceCurrentSheet(rows: ParsedShiftSheet["rows"], importedAt: Date): Promise<{ versionId: number }> {
    const versionRows = await this.sql<{ id: number }[]>`
      insert into shift_sheet_versions (version_number, uploaded_at, valid_from, is_current, csv_format)
      select coalesce(max(version_number), 0) + 1, ${importedAt.toISOString()}, ${importedAt.toISOString()}, false, 2
      from shift_sheet_versions returning id`;
    const versionId = versionRows[0]!.id;
    const sectors = await this.sql<{ id: number; code: string }[]>`select id, code from sectors where deleted_at is null`;
    const sectorIds = new Map(sectors.map((sector) => [sector.code, sector.id]));
    const days = new Set<string>();
    for (const row of rows) {
      const sectorId = sectorIds.get(row.codigo_setor);
      if (!sectorId) throw new Error(`Setor não encontrado durante persistência: ${row.codigo_setor}`);
      const key = `${sectorId}:${row.dayOfWeek}`;
      if (!days.has(key)) {
        await this.sql`insert into sector_shift_days (shift_sheet_version_id, sector_id, day_of_week, is_closed) values (${versionId}, ${sectorId}, ${row.dayOfWeek}, ${row.closed})`;
        days.add(key);
      }
      if (!row.closed) await this.sql`
        insert into sector_shift_ranges (shift_sheet_version_id, sector_id, shift_name, starts_at, ends_at, day_of_week)
        values (${versionId}, ${sectorId}, ${row.nome_turno}, ${row.hora_inicio}, ${row.hora_fim}, ${row.dayOfWeek})`;
    }
    await this.sql`update shift_sheet_versions set is_current = false where is_current = true`;
    await this.sql`update shift_sheet_versions set is_current = true where id = ${versionId}`;
    return { versionId };
  }
  async recordUploadAttempt(userId: number, result: "accepted" | "rejected", versionId: number | null, issues: { line?: number; field?: string; sectorCode?: string; reason: string }[]): Promise<void> {
    await this.sql`insert into shift_upload_attempts (uploaded_by_user_id, attempted_at, result, resulting_version_id, validation_errors)
      values (${userId}, now(), ${result}, ${versionId}, ${JSON.stringify(issues)})`;
  }
  async currentSheetRows(): Promise<ShiftSheetDownloadRow[]> {
    return this.sql<ShiftSheetDownloadRow[]>`
      select s.code as codigo_setor, s.name as nome_setor,
        case when d.is_closed then 'FECHADO' else r.shift_name end as nome_turno,
        case when d.is_closed then '00:00' else to_char(r.starts_at, 'HH24:MI') end as hora_inicio,
        case when d.is_closed then '00:00' else to_char(r.ends_at, 'HH24:MI') end as hora_fim,
        d.day_of_week as dia_semana_iso
      from shift_sheet_versions v
      join sector_shift_days d on d.shift_sheet_version_id = v.id
      join sectors s on s.id = d.sector_id
      left join sector_shift_ranges r on r.shift_sheet_version_id = v.id and r.sector_id = d.sector_id and r.day_of_week = d.day_of_week
      where v.is_current = true and v.csv_format = 2
      order by s.code, d.day_of_week, r.starts_at, r.id`;
  }
}
