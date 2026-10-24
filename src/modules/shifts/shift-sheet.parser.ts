import { z } from "zod";

const rowSchema = z.object({
  codigo_setor: z.string().trim().min(1),
  nome_setor: z.string().trim().min(1),
  nome_turno: z.string().trim().min(1),
  hora_inicio: z.string().trim(),
  hora_fim: z.string().trim(),
  codigo_funcionario: z.string().trim().min(1),
  nome_funcionario: z.string().trim().min(1),
  dia_semana_iso: z.string().trim(),
});

export type ShiftSheetRow = z.infer<typeof rowSchema> & {
  line: number;
  startsAt: number;
  endsAt: number;
  dayOfWeek: number;
};

export type ShiftSheetIssue = {
  line?: number;
  sectorCode?: string;
  reason: string;
};

export type ParsedShiftSheet = {
  rows: ShiftSheetRow[];
  issues: ShiftSheetIssue[];
};

const headers = [
  "codigo_setor", "nome_setor", "nome_turno", "hora_inicio", "hora_fim",
  "codigo_funcionario", "nome_funcionario", "dia_semana_iso",
] as const;

function timeInMinutes(value: string): number | undefined {
  const match = /^(?:[01]\d|2[0-3]):[0-5]\d$/.exec(value);
  if (!match) return undefined;
  const parts = value.split(":").map(Number);
  return parts[0]! * 60 + parts[1]!;
}

function parseLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') { current += '"'; index += 1; }
      else quoted = !quoted;
    } else if (char === ";" && !quoted) {
      values.push(current); current = "";
    } else current += char;
  }
  values.push(current);
  return values;
}

function coverageIssues(rows: ShiftSheetRow[]): ShiftSheetIssue[] {
  const issues: ShiftSheetIssue[] = [];
  const groups = new Map<string, ShiftSheetRow[]>();
  for (const row of rows) {
    const key = `${row.codigo_setor}:${row.dayOfWeek}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  for (const [key, group] of groups) {
    const segments = group.flatMap((row) => row.endsAt > row.startsAt
      ? [{ start: row.startsAt, end: row.endsAt, row }]
      : [{ start: row.startsAt, end: 1440, row }, { start: 0, end: row.endsAt, row }]);
    segments.sort((a, b) => a.start - b.start || a.end - b.end);
    if (segments[0]?.start !== 0) {
      issues.push({ sectorCode: key.split(":")[0], reason: `cobertura incompleta no dia ${key.split(":")[1]}` });
    }
    let end = 0;
    for (const segment of segments) {
      if (segment.start < end) issues.push({ line: segment.row.line, sectorCode: segment.row.codigo_setor, reason: "sobreposição de faixas" });
      if (segment.start > end) issues.push({ line: segment.row.line, sectorCode: segment.row.codigo_setor, reason: "buraco na cobertura de 24 horas" });
      end = Math.max(end, segment.end);
    }
    if (end !== 1440) issues.push({ sectorCode: key.split(":")[0], reason: `cobertura incompleta no dia ${key.split(":")[1]}` });
  }
  return issues;
}

export function parseShiftSheet(input: Uint8Array): ParsedShiftSheet {
  const issues: ShiftSheetIssue[] = [];
  if (input.length === 0) return { rows: [], issues: [{ reason: "arquivo vazio" }] };
  if (input[0] !== 0xef || input[1] !== 0xbb || input[2] !== 0xbf) return { rows: [], issues: [{ reason: "arquivo deve usar UTF-8 com BOM" }] };

  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(input); }
  catch { return { rows: [], issues: [{ reason: "codificação UTF-8 inválida" }] }; }
  const lines = text.replace(/\r\n?/g, "\n").split("\n").filter((line, index, all) => !(index === all.length - 1 && line === ""));
  if (lines.length < 2) return { rows: [], issues: [{ reason: "arquivo sem dados" }] };
  const actualHeaders = parseLine(lines[0]!).map((value) => value.trim());
  if (actualHeaders.join(";") !== headers.join(";")) return { rows: [], issues: [{ reason: "estrutura de colunas inválida" }] };

  const rows: ShiftSheetRow[] = [];
  const seen = new Set<string>();
  for (let index = 1; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const values = parseLine(lines[index]!);
    const raw = Object.fromEntries(headers.map((header, column) => [header, values[column] ?? ""]));
    const parsed = rowSchema.safeParse(raw);
    if (!parsed.success) { issues.push({ line: lineNumber, reason: "campos ausentes ou vazios" }); continue; }
    const startsAt = timeInMinutes(parsed.data.hora_inicio);
    const endsAt = timeInMinutes(parsed.data.hora_fim);
    const dayOfWeek = Number(parsed.data.dia_semana_iso);
    if (startsAt === undefined || endsAt === undefined) { issues.push({ line: lineNumber, sectorCode: parsed.data.codigo_setor, reason: "horário inválido" }); continue; }
    if (startsAt === endsAt) { issues.push({ line: lineNumber, sectorCode: parsed.data.codigo_setor, reason: "hora inicial e final não podem ser iguais" }); continue; }
    if (!Number.isInteger(dayOfWeek) || dayOfWeek < 1 || dayOfWeek > 7) { issues.push({ line: lineNumber, sectorCode: parsed.data.codigo_setor, reason: "dia da semana inválido" }); continue; }
    const key = `${parsed.data.codigo_setor}:${parsed.data.nome_turno}:${dayOfWeek}`;
    if (seen.has(key)) issues.push({ line: lineNumber, sectorCode: parsed.data.codigo_setor, reason: "faixa duplicada" });
    seen.add(key);
    rows.push({ ...parsed.data, line: lineNumber, startsAt, endsAt, dayOfWeek });
  }
  issues.push(...coverageIssues(rows));
  return { rows, issues };
}
