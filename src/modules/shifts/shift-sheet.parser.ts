import { z } from "zod";

export const SHIFT_SHEET_HEADERS = ["codigo_setor", "nome_setor", "nome_turno", "hora_inicio", "hora_fim", "dia_semana_iso"] as const;
const rowSchema = z.object({ codigo_setor: z.string().trim().min(1), nome_setor: z.string().trim().min(1), nome_turno: z.string().trim().min(1), hora_inicio: z.string().trim().min(1), hora_fim: z.string().trim().min(1), dia_semana_iso: z.string().trim().min(1) });
export type ShiftSheetRow = z.infer<typeof rowSchema> & { line: number; startsAt: number; endsAt: number; dayOfWeek: number; closed: boolean };
export type ShiftSheetIssue = { line?: number; field?: string; sectorCode?: string; reason: string };
export type ParsedShiftSheet = { rows: ShiftSheetRow[]; issues: ShiftSheetIssue[] };

function minutes(value: string): number | undefined {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) return undefined;
  const [hour, minute] = value.split(":").map(Number);
  return hour! * 60 + minute!;
}
function parseLine(line: string): { values: string[]; error?: string } {
  const values: string[] = []; let current = "", quoted = false, closed = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (quoted) {
      if (char === '"') { if (line[index + 1] === '"') { current += '"'; index++; } else { quoted = false; closed = true; } }
      else current += char;
    } else if (char === ";") { values.push(current); current = ""; closed = false; }
    else if (char === '"') { if (current || closed) return { values, error: "aspas em posição inválida" }; quoted = true; }
    else { if (closed) return { values, error: "aspas em posição inválida" }; current += char; }
  }
  if (quoted) return { values, error: "aspas não terminadas" };
  values.push(current); return { values };
}
export function parseShiftSheet(input: Uint8Array): ParsedShiftSheet {
  if (!input.length) return { rows: [], issues: [{ reason: "arquivo vazio" }] };
  if (input[0] !== 0xef || input[1] !== 0xbb || input[2] !== 0xbf) return { rows: [], issues: [{ reason: "arquivo deve usar UTF-8 com BOM" }] };
  let content: string;
  try { content = new TextDecoder("utf-8", { fatal: true }).decode(input); }
  catch { return { rows: [], issues: [{ reason: "codificação UTF-8 inválida" }] }; }
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();
  if (lines.length < 2) return { rows: [], issues: [{ reason: "arquivo sem dados" }] };
  const header = parseLine(lines[0]!);
  if (header.error || header.values.map((v) => v.trim()).join(";") !== SHIFT_SHEET_HEADERS.join(";")) return { rows: [], issues: [{ line: 1, reason: "estrutura de colunas inválida" }] };
  const rows: ShiftSheetRow[] = [], issues: ShiftSheetIssue[] = [], seen = new Set<string>();
  for (let index = 1; index < lines.length; index++) {
    if (!lines[index]!.trim()) continue;
    const line = index + 1, csv = parseLine(lines[index]!);
    if (csv.error || csv.values.length !== SHIFT_SHEET_HEADERS.length) { issues.push({ line, reason: csv.error ?? "quantidade de colunas inválida" }); continue; }
    const parsed = rowSchema.safeParse(Object.fromEntries(SHIFT_SHEET_HEADERS.map((key, i) => [key, csv.values[i] ?? ""])));
    if (!parsed.success) { for (const error of parsed.error.issues) issues.push({ line, field: String(error.path[0]), reason: "campo obrigatório vazio" }); continue; }
    const value = parsed.data, day = Number(value.dia_semana_iso), start = minutes(value.hora_inicio), end = minutes(value.hora_fim);
    if (!/^[1-7]$/.test(value.dia_semana_iso)) issues.push({ line, field: "dia_semana_iso", sectorCode: value.codigo_setor, reason: "dia da semana inválido" });
    if (start === undefined) issues.push({ line, field: "hora_inicio", sectorCode: value.codigo_setor, reason: "utilize o formato HH:mm" });
    if (end === undefined) issues.push({ line, field: "hora_fim", sectorCode: value.codigo_setor, reason: "utilize o formato HH:mm" });
    if (start === undefined || end === undefined || !/^[1-7]$/.test(value.dia_semana_iso)) continue;
    const closed = value.nome_turno === "FECHADO";
    if (closed ? start !== 0 || end !== 0 : start === end) { issues.push({ line, field: "hora_fim", sectorCode: value.codigo_setor, reason: closed ? "FECHADO exige 00:00;00:00" : "hora inicial e final não podem ser iguais" }); continue; }
    const key = `${value.codigo_setor}:${day}:${value.nome_turno}:${start}:${end}`;
    if (seen.has(key)) { issues.push({ line, sectorCode: value.codigo_setor, reason: "faixa duplicada" }); continue; }
    seen.add(key); rows.push({ ...value, line, startsAt: start, endsAt: end, dayOfWeek: day, closed });
  }
  const groups = new Map<string, ShiftSheetRow[]>();
  for (const row of rows) { const key = `${row.codigo_setor}:${row.dayOfWeek}`; groups.set(key, [...(groups.get(key) ?? []), row]); }
  for (const group of groups.values()) if (group.some((r) => r.closed) && (group.length !== 1 || !group[0]!.closed)) issues.push({ line: group[0]!.line, sectorCode: group[0]!.codigo_setor, reason: "FECHADO deve ser a única linha do dia" });
  const segments = new Map<string, { start: number; end: number; row: ShiftSheetRow }[]>();
  for (const row of rows.filter((r) => !r.closed)) {
    const add = (day: number, start: number, end: number) => { if (start === end) return; const key = `${row.codigo_setor}:${day}`; segments.set(key, [...(segments.get(key) ?? []), { start, end, row }]); };
    add(row.dayOfWeek, row.startsAt, row.endsAt > row.startsAt ? row.endsAt : 1440);
    if (row.endsAt < row.startsAt) add(row.dayOfWeek % 7 + 1, 0, row.endsAt);
  }
  for (const [key, entries] of segments) {
    entries.sort((a, b) => a.start - b.start || a.end - b.end);
    let end = 0;
    for (const entry of entries) { if (entry.start < end) issues.push({ line: entry.row.line, sectorCode: entry.row.codigo_setor, reason: "sobreposição de faixas" }); end = Math.max(end, entry.end); }
    if (groups.get(key)?.some((r) => r.closed)) issues.push({ line: entries[0]!.row.line, sectorCode: entries[0]!.row.codigo_setor, reason: "faixa invade dia FECHADO" });
  }
  return { rows, issues };
}
