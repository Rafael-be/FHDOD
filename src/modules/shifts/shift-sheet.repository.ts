import type postgres from "postgres";
import type { ParsedShiftSheet } from "./shift-sheet.parser.js";
import type { ShiftEmployeeReference, ShiftSectorReference, ShiftSheetRepository } from "./shift-sheet.service.js";

export class PostgresShiftSheetRepository implements ShiftSheetRepository {
  constructor(private readonly sql: postgres.Sql) {}

  async sectors(): Promise<ShiftSectorReference[]> {
    return this.sql<ShiftSectorReference[]>`
      select code, name, (deleted_at is null) as active
      from sectors
      order by code
    `;
  }

  async employees(): Promise<ShiftEmployeeReference[]> {
    return this.sql<ShiftEmployeeReference[]>`
      select employee_code as code, full_name as name, (deleted_at is null) as active
      from employees
      order by employee_code
    `;
  }

  async transaction<T>(work: (repository: ShiftSheetRepository) => Promise<T>): Promise<T> {
    return this.sql.begin(async (transaction) => work(new PostgresShiftSheetRepository(transaction as unknown as postgres.Sql))) as Promise<T>;
  }

  async replaceCurrentSheet(rows: ParsedShiftSheet["rows"], importedAt: Date): Promise<{ versionId: number }> {
    const versionRows = await this.sql<{ id: number }[]>`
      insert into shift_sheet_versions (version_number, uploaded_at, valid_from, is_current)
      select coalesce(max(version_number), 0) + 1, ${importedAt.toISOString()}, ${importedAt.toISOString()}, false
      from shift_sheet_versions
      returning id
    `;
    const versionId = versionRows[0]!.id;
    const sectors = await this.sql<{ id: number; code: string }[]>`select id, code from sectors where deleted_at is null`;
    const sectorIds = new Map(sectors.map((sector) => [sector.code, sector.id]));
    const employees = await this.sql<{ id: number; code: string }[]>`select id, employee_code as code from employees where deleted_at is null`;
    const employeeIds = new Map(employees.map((employee) => [employee.code.trim().toLowerCase(), employee.id]));
    const rangeIds = new Map<string, number>();

    for (const row of rows) {
      const sectorId = sectorIds.get(row.codigo_setor);
      if (!sectorId) throw new Error(`Setor não encontrado durante persistência: ${row.codigo_setor}`);
      const key = `${row.codigo_setor}:${row.nome_turno}:${row.startsAt}:${row.endsAt}`;
      let rangeId = rangeIds.get(key);
      if (!rangeId) {
        const inserted = await this.sql<{ id: number }[]>`
          insert into sector_shift_ranges (shift_sheet_version_id, sector_id, shift_name, starts_at, ends_at)
          values (${versionId}, ${sectorId}, ${row.nome_turno}, ${`${String(Math.floor(row.startsAt / 60)).padStart(2, "0")}:${String(row.startsAt % 60).padStart(2, "0")}`}, ${`${String(Math.floor(row.endsAt / 60)).padStart(2, "0")}:${String(row.endsAt % 60).padStart(2, "0")}`})
          returning id
        `;
        rangeId = inserted[0]!.id;
        rangeIds.set(key, rangeId);
      }
      const employeeId = employeeIds.get(row.codigo_funcionario.trim().toLowerCase());
      if (!employeeId) throw new Error(`Funcionário não encontrado durante persistência: ${row.codigo_funcionario}`);
      await this.sql`
        insert into employee_shift_assignments (shift_sheet_version_id, sector_id, shift_range_id, employee_id, day_of_week)
        values (${versionId}, ${sectorId}, ${rangeId}, ${employeeId}, ${row.dayOfWeek})
      `;
    }
    await this.sql`update shift_sheet_versions set is_current = false where is_current = true`;
    await this.sql`update shift_sheet_versions set is_current = true where id = ${versionId}`;
    return { versionId };
  }
}
