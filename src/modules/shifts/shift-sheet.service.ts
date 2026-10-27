import { DomainError } from "../../shared/core.js";
import { parseShiftSheet, type ParsedShiftSheet, type ShiftSheetIssue } from "./shift-sheet.parser.js";

export const MAX_SHIFT_SHEET_BYTES = 5 * 1024 * 1024;

export interface ShiftSectorReference { code: string; name: string; active: boolean; }
export interface ShiftEmployeeReference { code: string; name: string; active: boolean; }
export interface ShiftSheetDownloadRow { codigo_setor: string; nome_setor: string; nome_turno: string; hora_inicio: string; hora_fim: string; codigo_funcionario: string; nome_funcionario: string; dia_semana_iso: number; }
export interface ShiftSheetRepository {
  sectors(): Promise<ShiftSectorReference[]>;
  employees(): Promise<ShiftEmployeeReference[]>;
  transaction<T>(work: (repository: ShiftSheetRepository) => Promise<T>): Promise<T>;
  replaceCurrentSheet(rows: ParsedShiftSheet["rows"], importedAt: Date): Promise<{ versionId: number }>;
  recordUploadAttempt?(userId: number, result: "accepted" | "rejected", versionId: number | null, issues: ShiftSheetIssue[]): Promise<void>;
  currentSheetRows?(): Promise<ShiftSheetDownloadRow[]>;
}

export type ShiftSheetValidation = ParsedShiftSheet & { warnings: ShiftSheetIssue[] };

export class ShiftSheetService {
  constructor(private readonly repository: ShiftSheetRepository, private readonly now = () => new Date()) {}

  async validate(input: Uint8Array): Promise<ShiftSheetValidation> {
    if (input.byteLength > MAX_SHIFT_SHEET_BYTES) {
      return { rows: [], issues: [{ reason: `arquivo excede ${MAX_SHIFT_SHEET_BYTES} bytes` }], warnings: [] };
    }
    const parsed = parseShiftSheet(input);
    if (parsed.issues.length > 0) return { ...parsed, warnings: [] };
    const [sectors, employees] = await Promise.all([this.repository.sectors(), this.repository.employees()]);
    const sectorsByCode = new Map(sectors.map((sector) => [sector.code, sector]));
    const employeesByCode = new Map(employees.map((employee) => [employee.code, employee]));
    const issues = [...parsed.issues];
    const warnings: ShiftSheetIssue[] = [];
    for (const row of parsed.rows) {
      const sector = sectorsByCode.get(row.codigo_setor);
      if (!sector || !sector.active) issues.push({ line: row.line, sectorCode: row.codigo_setor, reason: "código de setor desconhecido ou inativo" });
      else if (sector.name !== row.nome_setor) warnings.push({ line: row.line, sectorCode: row.codigo_setor, reason: "nome do setor diverge do cadastro" });
      const employee = employeesByCode.get(row.codigo_funcionario);
      if (!employee || !employee.active) issues.push({ line: row.line, sectorCode: row.codigo_setor, reason: "código de funcionário desconhecido ou inativo" });
      else if (employee.name !== row.nome_funcionario) warnings.push({ line: row.line, sectorCode: row.codigo_setor, reason: "nome do funcionário diverge do cadastro" });
    }
    const activeCodes = new Set(sectors.filter((sector) => sector.active).map((sector) => sector.code));
    for (const code of activeCodes) if (!parsed.rows.some((row) => row.codigo_setor === code)) issues.push({ sectorCode: code, reason: "setor ativo sem faixas" });
    return { rows: parsed.rows, issues, warnings };
  }

  async import(input: Uint8Array, userId?: number): Promise<{ versionId: number; warnings: ShiftSheetIssue[] }> {
    const validation = await this.validate(input);
    if (validation.issues.length > 0) {
      if (userId !== undefined && this.repository.recordUploadAttempt) await this.repository.recordUploadAttempt(userId, "rejected", null, validation.issues);
      throw new DomainError("INVALID_SHIFT_SHEET", "A planilha contém erros impeditivos.", 400);
    }
    return this.repository.transaction(async (repository) => {
      const result = await repository.replaceCurrentSheet(validation.rows, this.now());
      if (userId !== undefined && repository.recordUploadAttempt) await repository.recordUploadAttempt(userId, "accepted", result.versionId, []);
      return { ...result, warnings: validation.warnings };
    });
  }

  async download(): Promise<Uint8Array> {
    if (!this.repository.currentSheetRows) throw new Error("Download de planilha não configurado.");
    const headers = ["codigo_setor", "nome_setor", "nome_turno", "hora_inicio", "hora_fim", "codigo_funcionario", "nome_funcionario", "dia_semana_iso"];
    const escape = (value: string | number): string => {
      const text = String(value);
      return /[;"\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
    };
    const rows = await this.repository.currentSheetRows();
    const content = [headers, ...rows.map((row) => headers.map((header) => escape(row[header as keyof ShiftSheetDownloadRow])))]
      .map((row) => row.join(";"))
      .join("\r\n");
    return new TextEncoder().encode(`\ufeff${content}\r\n`);
  }
}
