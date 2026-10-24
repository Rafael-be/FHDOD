import { ShiftSheetService } from "../../src/modules/shifts/shift-sheet.service.js";
import type { ShiftSheetRepository } from "../../src/modules/shifts/shift-sheet.service.js";

const header = "codigo_setor;nome_setor;nome_turno;hora_inicio;hora_fim;codigo_funcionario;nome_funcionario;dia_semana_iso";
const row = (name = "Enfermagem") => `enfermagem;${name};Madrugada;00:00;08:00;FIC-1;Ana;1\nenfermagem;${name};Dia;08:00;16:00;FIC-1;Ana;1\nenfermagem;${name};Noite;16:00;00:00;FIC-1;Ana;1`;
const input = (name?: string) => new TextEncoder().encode(`\ufeff${header}\n${row(name)}`);

function repository(): ShiftSheetRepository {
  return {
    sectors: async () => [{ code: "enfermagem", name: "Enfermagem", active: true }],
    employees: async () => [{ code: "FIC-1", name: "Ana", active: true }],
    transaction: async (work) => work(repository()),
    replaceCurrentSheet: async () => ({ versionId: 4 }),
  };
}

describe("ShiftSheetService", () => {
  it("returns catalog mismatches as warnings and imports valid rows", async () => {
    const service = new ShiftSheetService(repository(), () => new Date("2026-01-01T00:00:00Z"));
    await expect(service.validate(input("Nome antigo"))).resolves.toEqual(expect.objectContaining({ warnings: expect.arrayContaining([expect.objectContaining({ reason: "nome do setor diverge do cadastro" })]) }));
    await expect(service.import(input())).resolves.toMatchObject({ versionId: 4, warnings: [] });
  });

  it("rejects unknown sectors without changing the repository", async () => {
    let replaced = false;
    const repo = { ...repository(), sectors: async () => [], replaceCurrentSheet: async () => { replaced = true; return { versionId: 1 }; } };
    await expect(new ShiftSheetService(repo).import(input())).rejects.toMatchObject({ code: "INVALID_SHIFT_SHEET" });
    expect(replaced).toBe(false);
  });

  it("rejects oversized files before catalog access", async () => {
    let catalogRead = false;
    const repo = { ...repository(), sectors: async () => { catalogRead = true; return []; } };
    const result = await new ShiftSheetService(repo).validate(new Uint8Array(5 * 1024 * 1024 + 1));
    expect(result.issues[0]?.reason).toContain("excede");
    expect(catalogRead).toBe(false);
  });
});
