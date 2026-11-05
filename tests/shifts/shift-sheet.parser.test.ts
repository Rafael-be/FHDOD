import { parseShiftSheet } from "../../src/modules/shifts/shift-sheet.parser.js";

const header = "codigo_setor;nome_setor;nome_turno;hora_inicio;hora_fim;codigo_funcionario;nome_funcionario;dia_semana_iso";
const row = (start: string, end: string, day = 1, name = "Turno") => `enfermagem;Enfermagem;${name};${start};${end};FIC-1;Ana;${day}`;
const bytes = (content: string) => new TextEncoder().encode(`\ufeff${content}`);

describe("parseShiftSheet", () => {
  it("accepts BOM, quoted fields and circular midnight coverage", () => {
    const input = [header, row("00:00", "08:00", 1, 'Madrugada'), row("08:00", "16:00", 1, 'Dia'), row("16:00", "00:00", 1, 'Noite')].join("\n");
    expect(parseShiftSheet(bytes(input)).issues).toEqual([]);
  });

  it("rejects missing BOM, equal hours, invalid days and duplicate ranges", () => {
    const input = [header, row("00:00", "00:00"), row("00:00", "08:00", 8), row("00:00", "08:00"), row("00:00", "08:00")].join("\n");
    expect(parseShiftSheet(new TextEncoder().encode(input)).issues[0]?.reason).toContain("BOM");
    const result = parseShiftSheet(bytes(input));
    expect(result.issues.map((issue) => issue.reason)).toEqual(expect.arrayContaining([
      "hora inicial e final não podem ser iguais", "dia da semana inválido", "atribuição de funcionário duplicada",
    ]));
  });

  it("keeps distinct CSV employee snapshots in the same shift and trims names", () => {
    const input = [
      header,
      "enfermagem;Enfermagem;Madrugada;00:00;08:00;LOCAL-1;  Ana Cláudia  ;1",
      "enfermagem;Enfermagem;Madrugada;00:00;08:00;LOCAL-2;Ana Cláudia;1",
      "enfermagem;Enfermagem;Dia;08:00;16:00;LOCAL-1;Ana Cláudia;1",
      "enfermagem;Enfermagem;Dia;08:00;16:00;LOCAL-2;Ana Cláudia;1",
      "enfermagem;Enfermagem;Noite;16:00;00:00;LOCAL-1;Ana Cláudia;1",
      "enfermagem;Enfermagem;Noite;16:00;00:00;LOCAL-2;Ana Cláudia;1",
    ].join("\n");
    const result = parseShiftSheet(bytes(input));
    expect(result.issues).toEqual([]);
    expect(result.rows.slice(0, 2)).toEqual(expect.arrayContaining([
      expect.objectContaining({ codigo_funcionario: "LOCAL-1", nome_funcionario: "Ana Cláudia" }),
      expect.objectContaining({ codigo_funcionario: "LOCAL-2", nome_funcionario: "Ana Cláudia" }),
    ]));
  });

  it("rejects blank employee codes or names", () => {
    const input = [header, "enfermagem;Enfermagem;Madrugada;00:00;08:00;LOCAL-1; ;1"].join("\n");
    expect(parseShiftSheet(bytes(input)).issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ line: 2, reason: "campos ausentes ou vazios" }),
    ]));
  });

  it("rejects a physical duplicate after the same normalization used by the database index", () => {
    const input = [
      header,
      "enfermagem;Enfermagem;Madrugada;00:00;08:00;LOCAL-1;Ana;1",
      "enfermagem;Enfermagem;Madrugada;00:00;08:00;local-1;ana;1",
      "enfermagem;Enfermagem;Dia;08:00;16:00;LOCAL-1;Ana;1",
      "enfermagem;Enfermagem;Noite;16:00;00:00;LOCAL-1;Ana;1",
    ].join("\n");
    expect(parseShiftSheet(bytes(input)).issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ line: 3, reason: "atribuição de funcionário duplicada" }),
    ]));
  });

  it("reports gaps and overlaps by line", () => {
    const input = [header, row("00:00", "08:00"), row("07:59", "16:00"), row("16:00", "00:00")].join("\n");
    const result = parseShiftSheet(bytes(input));
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ line: 3, reason: "sobreposição de faixas" }),
    ]));
  });
});
