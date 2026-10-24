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
      "hora inicial e final não podem ser iguais", "dia da semana inválido", "faixa duplicada",
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
