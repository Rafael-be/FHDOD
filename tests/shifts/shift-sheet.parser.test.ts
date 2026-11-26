import { parseShiftSheet } from "../../src/modules/shifts/shift-sheet.parser.js";

const header = "codigo_setor;nome_setor;nome_turno;hora_inicio;hora_fim;dia_semana_iso";
const bytes = (text: string) => new TextEncoder().encode(`\ufeff${text}`);
const row = (shift: string, start: string, end: string, day: number) => `enfermagem;Enfermagem;${shift};${start};${end};${day}`;
const week = (monday = row("SEM_TURNO", "08:00", "17:00", 1)) => [header, monday, ...Array.from({ length: 6 }, (_, i) => row("FECHADO", "00:00", "00:00", i + 2))].join("\n");

describe("parseShiftSheet", () => {
  it("accepts partial hours, explicit closed days and exact values", () => {
    const result = parseShiftSheet(bytes(week()));
    expect(result.issues).toEqual([]);
    expect(result.rows).toHaveLength(7);
    expect(result.rows[0]).toMatchObject({ codigo_setor: "enfermagem", nome_turno: "SEM_TURNO", hora_inicio: "08:00", hora_fim: "17:00", dayOfWeek: 1, startsAt: 480, endsAt: 1020, closed: false });
    expect(result.rows[1]).toMatchObject({ nome_turno: "FECHADO", dayOfWeek: 2, closed: true });
  });
  it("accepts midnight crossing when the following day is open", () => {
    const input = [header, row("Noite", "22:00", "06:00", 1), row("Dia", "08:00", "16:00", 2), ...Array.from({ length: 5 }, (_, i) => row("FECHADO", "00:00", "00:00", i + 3))].join("\n");
    expect(parseShiftSheet(bytes(input)).issues).toEqual([]);
  });
  it("reports field errors and invalid CSV without silently accepting blank turn", () => {
    const input = [header, row("", "08:00", "17:00", 1), row("Dia", "25:00", "17:00", 2), row("Dia", "08:00", "17:00", 8)].join("\n");
    expect(parseShiftSheet(bytes(input)).issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ line: 2, field: "nome_turno" }),
      expect.objectContaining({ line: 3, field: "hora_inicio" }),
      expect.objectContaining({ line: 4, field: "dia_semana_iso" }),
    ]));
    expect(parseShiftSheet(new TextEncoder().encode(input)).issues[0]?.reason).toContain("BOM");
    expect(parseShiftSheet(bytes(`${header}\n${row("Dia", "08:00", "17:00", 1)};extra`)).issues).toEqual(expect.arrayContaining([expect.objectContaining({ line: 2, reason: "quantidade de colunas inválida" })]));
  });
  it("rejects duplicates, overlap, and a shift invading FECHADO", () => {
    const input = [header, row("A", "08:00", "16:00", 1), row("B", "15:00", "17:00", 1), row("A", "08:00", "16:00", 1), row("Noite", "22:00", "06:00", 2), row("FECHADO", "00:00", "00:00", 3)].join("\n");
    expect(parseShiftSheet(bytes(input)).issues.map((issue) => issue.reason)).toEqual(expect.arrayContaining(["sobreposição de faixas", "faixa duplicada", "faixa invade dia FECHADO"]));
  });
});
