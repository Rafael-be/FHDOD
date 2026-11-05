import { ShiftSheetService } from "../../src/modules/shifts/shift-sheet.service.js";
import type { ShiftSheetRepository } from "../../src/modules/shifts/shift-sheet.service.js";

const header = "codigo_setor;nome_setor;nome_turno;hora_inicio;hora_fim;codigo_funcionario;nome_funcionario;dia_semana_iso";
const row = (name = "Enfermagem") => `enfermagem;${name};Madrugada;00:00;08:00;FIC-1;Ana;1\nenfermagem;${name};Dia;08:00;16:00;FIC-1;Ana;1\nenfermagem;${name};Noite;16:00;00:00;FIC-1;Ana;1`;
const input = (name?: string) => new TextEncoder().encode(`\ufeff${header}\n${row(name)}`);

function repository(): ShiftSheetRepository {
  return {
    sectors: async () => [{ code: "enfermagem", name: "Enfermagem", active: true }],
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
    let attempt: string | undefined;
    const repo = { ...repository(), sectors: async () => [], replaceCurrentSheet: async () => { replaced = true; return { versionId: 1 }; }, recordUploadAttempt: async (_userId: number, result: "accepted" | "rejected") => { attempt = result; } };
    await expect(new ShiftSheetService(repo).import(input(), 10)).rejects.toMatchObject({ code: "INVALID_SHIFT_SHEET" });
    expect(replaced).toBe(false);
    expect(attempt).toBe("rejected");
  });

  it("imports CSV employee snapshots without consulting the employee catalog", async () => {
    let persisted: Parameters<ShiftSheetRepository["replaceCurrentSheet"]>[0] | undefined;
    const repo: ShiftSheetRepository = {
      ...repository(),
      transaction: async (work) => work(repo),
      replaceCurrentSheet: async (rows) => { persisted = rows; return { versionId: 8 }; },
    };
    const csv = `\ufeff${header}\nenfermagem;Enfermagem;Madrugada;00:00;08:00;LOCAL-1;  Ana Cláudia  ;1\nenfermagem;Enfermagem;Madrugada;00:00;08:00;LOCAL-2;Ana Cláudia;1\nenfermagem;Enfermagem;Dia;08:00;16:00;LOCAL-1;  Ana Cláudia  ;1\nenfermagem;Enfermagem;Dia;08:00;16:00;LOCAL-2;Ana Cláudia;1\nenfermagem;Enfermagem;Noite;16:00;00:00;LOCAL-1;  Ana Cláudia  ;1\nenfermagem;Enfermagem;Noite;16:00;00:00;LOCAL-2;Ana Cláudia;1`;
    await expect(new ShiftSheetService(repo).import(new TextEncoder().encode(csv))).resolves.toMatchObject({ versionId: 8 });
    expect(persisted).toEqual(expect.arrayContaining([
      expect.objectContaining({ codigo_funcionario: "LOCAL-1", nome_funcionario: "Ana Cláudia" }),
      expect.objectContaining({ codigo_funcionario: "LOCAL-2", nome_funcionario: "Ana Cláudia" }),
    ]));
  });

  it("keeps the same displayed name independent across sectors", async () => {
    const repo: ShiftSheetRepository = {
      ...repository(),
      sectors: async () => [
        { code: "enfermagem", name: "Enfermagem", active: true },
        { code: "uti", name: "UTI", active: true },
      ],
    };
    const lines = [["enfermagem", "Enfermagem"], ["uti", "UTI"]].flatMap(([prefix, name]) => [
      `${prefix};${name};Madrugada;00:00;08:00;LOCAL-${prefix};Ana;1`,
      `${prefix};${name};Dia;08:00;16:00;LOCAL-${prefix};Ana;1`,
      `${prefix};${name};Noite;16:00;00:00;LOCAL-${prefix};Ana;1`,
    ]);
    await expect(new ShiftSheetService(repo).validate(new TextEncoder().encode(`\ufeff${header}\n${lines.join("\n")}`))).resolves.toMatchObject({ issues: [], warnings: [] });
  });

  it("rejects oversized files before catalog access", async () => {
    let catalogRead = false;
    const repo = { ...repository(), sectors: async () => { catalogRead = true; return []; } };
    const result = await new ShiftSheetService(repo).validate(new Uint8Array(5 * 1024 * 1024 + 1));
    expect(result.issues[0]?.reason).toContain("excede");
    expect(catalogRead).toBe(false);
  });

  it("generates an Excel-compatible CSV with BOM and escaped values", async () => {
    const repo = { ...repository(), currentSheetRows: async () => [{ codigo_setor: "uti", nome_setor: "UTI; Adulto", nome_turno: "Dia", hora_inicio: "08:00", hora_fim: "16:00", codigo_funcionario: "F-1", nome_funcionario: 'Ana "A"', dia_semana_iso: 1 }] };
    const csv = await new ShiftSheetService(repo).download();
    const text = new TextDecoder().decode(csv);
    expect([...csv.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(text).toContain('"UTI; Adulto"');
    expect(text).toContain('"Ana ""A"""');
  });
});
