import { DomainError } from "../../shared/core.js";
import { parseShiftSheet, SHIFT_SHEET_HEADERS, type ParsedShiftSheet, type ShiftSheetIssue } from "./shift-sheet.parser.js";

export const MAX_SHIFT_SHEET_BYTES = 5 * 1024 * 1024;

export interface ShiftSectorReference { code: string; name: string; active: boolean; }
export interface ShiftSheetDownloadRow { codigo_setor: string; nome_setor: string; nome_turno: string; hora_inicio: string; hora_fim: string; dia_semana_iso: number; }
export interface ShiftSheetRepository {
  sectors(): Promise<ShiftSectorReference[]>;
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
    const sectors = await this.repository.sectors();
    const sectorsByCode = new Map(sectors.map((sector) => [sector.code, sector]));
    const issues = [...parsed.issues];
    const warnings: ShiftSheetIssue[] = [];
    for (const row of parsed.rows) {
      const sector = sectorsByCode.get(row.codigo_setor);
      if (!sector || !sector.active) issues.push({ line: row.line, sectorCode: row.codigo_setor, reason: "código de setor desconhecido ou inativo" });
      else if (sector.name !== row.nome_setor) warnings.push({ line: row.line, sectorCode: row.codigo_setor, reason: "nome do setor diverge do cadastro" });
    }
    const activeCodes = new Set(sectors.filter((sector) => sector.active).map((sector) => sector.code));
    for (const code of activeCodes) for (let day = 1; day <= 7; day++) {
      if (!parsed.rows.some((row) => row.codigo_setor === code && row.dayOfWeek === day)) issues.push({ sectorCode: code, field: "dia_semana_iso", reason: `dia ${day} sem funcionamento ou FECHADO explícito` });
    }
    return { rows: parsed.rows, issues, warnings };
  }

  async import(input: Uint8Array, userId?: number): Promise<{ versionId: number; warnings: ShiftSheetIssue[] }> {
    const validation = await this.validate(input);
    if (validation.issues.length > 0) {
      if (userId !== undefined && this.repository.recordUploadAttempt) await this.repository.recordUploadAttempt(userId, "rejected", null, validation.issues);
      throw new DomainError("INVALID_SHIFT_SHEET", "A planilha contém erros impeditivos.", 400, validation.issues.map(({ line, field, sectorCode, reason }) => ({ line, field, sectorCode, message: reason })));
    }
    return this.repository.transaction(async (repository) => {
      const lockedValidation = await new ShiftSheetService(repository, this.now).validate(input);
      if (lockedValidation.issues.length > 0) throw new DomainError("INVALID_SHIFT_SHEET", "A planilha contém erros impeditivos.", 400, lockedValidation.issues.map(({ line, field, sectorCode, reason }) => ({ line, field, sectorCode, message: reason })));
      const result = await repository.replaceCurrentSheet(lockedValidation.rows, this.now());
      if (userId !== undefined && repository.recordUploadAttempt) await repository.recordUploadAttempt(userId, "accepted", result.versionId, []);
      return { ...result, warnings: lockedValidation.warnings };
    });
  }

  async download(): Promise<Uint8Array> {
    if (!this.repository.currentSheetRows) throw new Error("Download de planilha não configurado.");
    const headers: readonly string[] = SHIFT_SHEET_HEADERS;
    const escape = (value: string | number): string => {
      const text = String(value);
      return /[;"\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
    };
    const rows = await this.repository.currentSheetRows();
    if (rows.length === 0) throw new DomainError("SHIFT_SHEET_NOT_FOUND", "Não há planilha vigente para exportação.", 404);
    const content = [headers, ...rows.map((row) => headers.map((header) => escape(row[header as keyof ShiftSheetDownloadRow])))]
      .map((row) => row.join(";"))
      .join("\r\n");
    return new TextEncoder().encode(`\ufeff${content}\r\n`);
  }

  async template(): Promise<Uint8Array> {
    const sectors = (await this.repository.sectors()).filter((sector) => sector.active);
    const lines = [SHIFT_SHEET_HEADERS.join(";")];
    const escape = (value: string) => /[;"\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
    for (const sector of sectors) for (let day = 1; day <= 7; day++) lines.push(`${escape(sector.code)};${escape(sector.name)};FECHADO;00:00;00:00;${day}`);
    return new TextEncoder().encode(`\ufeff${lines.join("\r\n")}\r\n`);
  }
}
