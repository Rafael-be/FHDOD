import { ShiftSheetService, type ShiftSheetRepository } from "../../src/modules/shifts/shift-sheet.service.js";
import { parseShiftSheet } from "../../src/modules/shifts/shift-sheet.parser.js";
import { jest } from "@jest/globals";

const header = "codigo_setor;nome_setor;nome_turno;hora_inicio;hora_fim;dia_semana_iso";
const bytes = (text: string) => new TextEncoder().encode(`\ufeff${text}`);
const week = (name = "Enfermagem") => [header, `enfermagem;${name};SEM_TURNO;08:00;17:00;1`, ...Array.from({ length: 6 }, (_, i) => `enfermagem;${name};FECHADO;00:00;00:00;${i + 2}`)].join("\n");
function repository(): ShiftSheetRepository {
  return { sectors: async () => [{ code: "enfermagem", name: "Enfermagem", active: true }], transaction: async (work) => work(repository()), replaceCurrentSheet: async () => ({ versionId: 4 }) };
}

describe("ShiftSheetService", () => {
  it("imports exact rows and reports name mismatch only as warning", async () => {
    let saved: Parameters<ShiftSheetRepository["replaceCurrentSheet"]>[0] | undefined;
    const repo = repository();
    repo.transaction = async (work) => work({ ...repo, replaceCurrentSheet: async (rows) => { saved = rows; return { versionId: 8 }; } });
    const service = new ShiftSheetService(repo, () => new Date("2026-01-01T00:00:00Z"));
    const result = await service.import(bytes(week("Nome antigo")));
    expect(result.versionId).toBe(8);
    expect(result.warnings).toHaveLength(7);
    expect(result.warnings[0]).toMatchObject({ sectorCode: "enfermagem", reason: "nome do setor diverge do cadastro" });
    expect(saved).toHaveLength(7);
    expect(saved?.[0]).toMatchObject({ codigo_setor: "enfermagem", nome_turno: "SEM_TURNO", startsAt: 480, endsAt: 1020, dayOfWeek: 1 });
    expect(saved?.[6]).toMatchObject({ nome_turno: "FECHADO", dayOfWeek: 7, closed: true });
  });
  it("rejects missing days and unknown sectors without creating a version", async () => {
    const replaceCurrentSheet = jest.fn(async () => ({ versionId: 5 }));
    const recordUploadAttempt = jest.fn(async () => {});
    const repo = { ...repository(), replaceCurrentSheet, recordUploadAttempt };
    const service = new ShiftSheetService(repo);
    const incomplete = bytes(`${header}\nenfermagem;Enfermagem;SEM_TURNO;08:00;17:00;1`);
    await expect(service.import(incomplete, 10)).rejects.toMatchObject({ code: "INVALID_SHIFT_SHEET", details: expect.arrayContaining([expect.objectContaining({ sectorCode: "enfermagem", field: "dia_semana_iso", message: expect.stringContaining("dia 2") })]) });
    expect(replaceCurrentSheet).not.toHaveBeenCalled();
    expect(recordUploadAttempt).toHaveBeenCalledWith(10, "rejected", null, expect.any(Array));
    const badRepo = { ...repo, sectors: async () => [] };
    await expect(new ShiftSheetService(badRepo).import(bytes(week()))).rejects.toMatchObject({ code: "INVALID_SHIFT_SHEET", details: expect.arrayContaining([expect.objectContaining({ message: "código de setor desconhecido ou inativo" })]) });
    expect(replaceCurrentSheet).not.toHaveBeenCalled();
  });
  it("exports escaped rows with BOM that parse back to the same values", async () => {
    const repo = { ...repository(), sectors: async () => [{ code: "uti", name: "UTI; Adulto", active: true }], currentSheetRows: async () => [
      { codigo_setor: "uti", nome_setor: "UTI; Adulto", nome_turno: 'Dia "A"', hora_inicio: "08:00", hora_fim: "17:00", dia_semana_iso: 1 },
      ...Array.from({ length: 6 }, (_, i) => ({ codigo_setor: "uti", nome_setor: "UTI; Adulto", nome_turno: "FECHADO", hora_inicio: "00:00", hora_fim: "00:00", dia_semana_iso: i + 2 })),
    ] };
    const csv = await new ShiftSheetService(repo).download();
    expect([...csv.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const parsed = parseShiftSheet(csv);
    expect(parsed.issues).toEqual([]);
    expect(parsed.rows).toHaveLength(7);
    expect(parsed.rows[0]).toMatchObject({ codigo_setor: "uti", nome_setor: "UTI; Adulto", nome_turno: 'Dia "A"', startsAt: 480, endsAt: 1020 });
  });
  it("provides a complete model and reports absent current version", async () => {
    const service = new ShiftSheetService({ ...repository(), currentSheetRows: async () => [] });
    await expect(service.download()).rejects.toMatchObject({ code: "SHIFT_SHEET_NOT_FOUND", status: 404 });
    const model = parseShiftSheet(await service.template());
    expect(model.issues).toEqual([]);
    expect(model.rows.map((row) => row.dayOfWeek)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(model.rows.every((row) => row.closed)).toBe(true);
  });
});
