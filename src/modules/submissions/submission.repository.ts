import { createHash } from "node:crypto";
import type postgres from "postgres";
import { DomainError } from "../../shared/core.js";
import { listEffectiveQuestions } from "../questions/effective-question-resolver.js";
import { publishedFormCache } from "./form-cache.js";
import { SUBMISSION_EXTENSION_MS, SUBMISSION_INITIAL_MS } from "./submission-time.js";
import type { SubmissionAnswerInput, SubmissionQuestion, SubmissionStart } from "./submission.service.js";

type DatabaseTimestamp = Date | string | number;
export function timestampToMillis(value: DatabaseTimestamp): number {
  const millis = value instanceof Date ? value.getTime() : new Date(value).getTime();
  if (!Number.isFinite(millis)) throw new Error("Timestamp inválido retornado pelo PostgreSQL.");
  return millis;
}
export function timestampToIso(value: DatabaseTimestamp): string { return new Date(timestampToMillis(value)).toISOString(); }

export interface SubmissionRepository {
  transaction<T>(work: (repository: SubmissionRepository) => Promise<T>): Promise<T>;
  createSessionSnapshot(input: SubmissionStart): Promise<{ session: { id: string; sectorId: number; formVersionId: number; expiresAt: string; shiftSheetVersionId: number | null; shiftRangeId: number | null }; questions: SubmissionQuestion[] }>;
  capabilityHash?(sessionId: string): Promise<Buffer | null>;
  saveAnswer(sessionId: string, input: SubmissionAnswerInput, now: Date): Promise<{ sessionId: string; status: "incomplete" | "complete"; answered: boolean; expiresAt: string }>;
  endSession(sessionId: string, now: Date): Promise<{ sectorId: number }>;
  refreshSession?(sessionId: string, now: Date): Promise<{ expiresAt: string; refreshesUsed: number; refreshesRemaining: number }>;
  closeSession?(sessionId: string, now: Date): Promise<{ sessionId: string; status: "closed" }>;
  reconcileExpired?(now: Date): Promise<number>;
  expireSession?(sessionId: string, now: Date): Promise<boolean>;
}
interface LockedSession {
  sectorId: number; formVersionId: number | null; shiftRangeId: number | null;
  startedAt: DatabaseTimestamp; expiresAt: DatabaseTimestamp | null;
  endedAt: DatabaseTimestamp | null; refreshCount: number;
}

export class PostgresSubmissionRepository implements SubmissionRepository {
  constructor(private readonly sql: postgres.Sql) {}
  async capabilityHash(sessionId: string): Promise<Buffer | null> {
    const rows = await this.sql<{ hash: Buffer }[]>`select capability_hash as hash from submission_sessions where id=${sessionId}`;
    return rows[0]?.hash ?? null;
  }
  async transaction<T>(work: (repository: SubmissionRepository) => Promise<T>): Promise<T> {
    if (typeof (this.sql as unknown as { begin?: unknown }).begin !== "function") return work(this);
    return this.sql.begin(async (tx) => work(new PostgresSubmissionRepository(tx as unknown as postgres.Sql))) as Promise<T>;
  }
  private async lockSession(sessionId: string): Promise<LockedSession> {
    const rows = await this.sql<LockedSession[]>`
      select sector_id as "sectorId", form_version_id as "formVersionId", shift_range_id as "shiftRangeId",
        started_at as "startedAt", expires_at as "expiresAt", ended_at as "endedAt", refresh_count as "refreshCount"
      from submission_sessions where id = ${sessionId} for update`;
    if (!rows[0] || rows[0].formVersionId === null || rows[0].expiresAt === null)
      throw new DomainError("SUBMISSION_NOT_FOUND", "Sessão não encontrada.", 404);
    return rows[0];
  }
  private assertActive(session: LockedSession, now: Date): void {
    if (session.endedAt) throw new DomainError("SUBMISSION_CLOSED", "Sessão já encerrada.", 409);
    if (timestampToMillis(session.expiresAt!) < now.getTime()) throw new DomainError("SUBMISSION_EXPIRED", "Sessão expirada.", 410);
  }
  async createSessionSnapshot(input: SubmissionStart) {
    const shifts = await this.sql<{ versionId: number; rangeId: number }[]>`
      select distinct v.id as "versionId", r.id as "rangeId"
      from shift_sheet_versions v
      join sector_shift_ranges r on r.shift_sheet_version_id = v.id and r.sector_id = ${input.sectorId}
      left join employee_shift_assignments a on a.shift_sheet_version_id = v.id and a.sector_id = r.sector_id and a.shift_range_id = r.id
      join sectors s on s.id = r.sector_id and s.deleted_at is null
      where v.is_current = true and (
        (r.ends_at > r.starts_at and coalesce(r.day_of_week, a.day_of_week) = ${input.dayOfWeek}
          and ${input.localTime}::time >= r.starts_at and ${input.localTime}::time < r.ends_at)
        or (r.ends_at < r.starts_at and (
          (coalesce(r.day_of_week, a.day_of_week) = ${input.dayOfWeek} and ${input.localTime}::time >= r.starts_at)
          or (coalesce(r.day_of_week, a.day_of_week) = ${input.previousDayOfWeek} and ${input.localTime}::time < r.ends_at))))`;
    if (shifts.length > 1) throw new DomainError("SHIFT_AMBIGUOUS", "Há mais de um turno vigente para o horário.", 409);
    const fallback = shifts[0] ? undefined : (await this.sql<{ versionId: number | null; rangeId: null }[]>`
      select v.id as "versionId", null::integer as "rangeId" from sectors s
      left join shift_sheet_versions v on v.is_current = true
      where s.id = ${input.sectorId} and s.deleted_at is null limit 1`)[0];
    if (!shifts[0] && !fallback) throw new DomainError("SECTOR_NOT_FOUND", "Setor inexistente ou inativo.", 404);
    const shift = shifts[0] ?? fallback!;
    await this.sql`select pg_advisory_xact_lock(912010, ${input.sectorId})`;
    const effective = await listEffectiveQuestions(this.sql, input.sectorId, false);
    const questions: SubmissionQuestion[] = effective.map((q, index) => ({
      questionId: q.id, questionVersionId: q.versionId, text: q.text,
      questionKind: q.questionKind, isNps: q.isNps, position: index + 1,
    }));
    if (questions.filter((q) => q.isNps).length !== 1 || questions.length < 2)
      throw new DomainError("FORM_INCOMPLETE", "O setor precisa de perguntas comuns e exatamente um NPS.", 409);
    const fingerprint = createHash("sha256").update(JSON.stringify(questions)).digest("hex");
    const current = (await this.sql<{ id: number; versionNumber: number; fingerprint: string }[]>`
      select id, version_number as "versionNumber", fingerprint from submission_form_versions
      where sector_id = ${input.sectorId} order by version_number desc limit 1`)[0];
    let formVersionId = current?.id;
    if (!current || current.fingerprint !== fingerprint) {
      const created = await this.sql<{ id: number }[]>`
        insert into submission_form_versions(sector_id, version_number, fingerprint, published_at)
        values (${input.sectorId}, ${(current?.versionNumber ?? 0) + 1}, ${fingerprint}, ${input.now.toISOString()})
        returning id`;
      formVersionId = created[0]!.id;
      for (const q of questions) await this.sql`
        insert into submission_form_questions(form_version_id, question_id, question_version_id, position, question_kind, is_nps, text)
        values (${formVersionId}, ${q.questionId}, ${q.questionVersionId}, ${q.position}, ${q.questionKind}, ${q.isNps}, ${q.text})`;
    }
    const expiresAt = new Date(input.now.getTime() + SUBMISSION_INITIAL_MS).toISOString();
    const rows = await this.sql<{ id: string }[]>`
      insert into submission_sessions(id, sector_id, form_version_id, shift_sheet_version_id, shift_range_id,
        started_at, last_activity_at, expires_at, status, capability_hash)
      values (${input.sessionId}, ${input.sectorId}, ${formVersionId!}, ${shift.versionId}, ${shift.rangeId},
        ${input.now.toISOString()}, ${input.now.toISOString()}, ${expiresAt}, 'incomplete', ${input.capabilityHash ?? createHash("sha256").update(input.sessionId).digest()}) returning id`;
    publishedFormCache.put(formVersionId!, questions);
    return { session: { id: rows[0]!.id, sectorId: input.sectorId, formVersionId: formVersionId!, expiresAt,
      shiftSheetVersionId: shift.versionId, shiftRangeId: shift.rangeId }, questions };
  }
  async saveAnswer(sessionId: string, input: SubmissionAnswerInput, now: Date) {
    const session = await this.lockSession(sessionId);
    this.assertActive(session, now);
    const question = (await publishedFormCache.get(this.sql, session.formVersionId!))
      .find((q) => q.questionId === input.questionId && q.questionVersionId === input.questionVersionId);
    if (!question) throw new DomainError("SUBMISSION_QUESTION_NOT_FOUND", "Pergunta ou versão não pertence ao formulário.", 404);
    if (input.status === "skipped" && question.questionKind !== "sector")
      throw new DomainError("QUESTION_NOT_SKIPPABLE", "Somente perguntas de setor podem ser puladas.", 400);
    if (input.status === "answered" && (input.score === null || input.score < (question.isNps ? 0 : 1) || input.score > (question.isNps ? 10 : 5)))
      throw new DomainError("INVALID_ANSWER_SCORE", "Nota fora da escala da pergunta.", 400);
    const previous = (await this.sql<{ status: string; score: number | null }[]>`
      select status, score from submission_form_answers where session_id = ${sessionId} and question_id = ${input.questionId}`)[0];
    const changed = !previous || previous.status !== input.status || previous.score !== input.score;
    const expiresAt = changed ? new Date(timestampToMillis(session.expiresAt!) + SUBMISSION_EXTENSION_MS).toISOString() : timestampToIso(session.expiresAt!);
    if (changed) {
      await this.sql`
        insert into submission_form_answers(session_id, form_version_id, question_id, question_version_id, status, score, created_at, updated_at)
        values (${sessionId}, ${session.formVersionId!}, ${input.questionId}, ${input.questionVersionId}, ${input.status}, ${input.score}, ${now.toISOString()}, ${now.toISOString()})
        on conflict (session_id, question_id) do update set status=excluded.status, score=excluded.score, updated_at=excluded.updated_at`;
      await this.sql`update submission_sessions set last_activity_at=${now.toISOString()}, expires_at=${expiresAt} where id=${sessionId}`;
      if (session.shiftRangeId !== null) await this.sql`
        insert into dashboard_dirty_groups(summary_type, hour_bucket, sector_id, shift_range_id, question_id, question_version_id, queued_at)
        values ('answers', date_trunc('hour', ${timestampToIso(session.startedAt)}::timestamptz), ${session.sectorId}, ${session.shiftRangeId}, ${input.questionId}, ${input.questionVersionId}, ${now.toISOString()})
        on conflict do nothing`;
    }
    const count = (await this.sql<{ required: number; requiredAnswered: number; npsTotal: number; npsAnswered: number }[]>`
      select count(*) filter (where q.question_kind='standard')::int as required,
        count(*) filter (where q.question_kind='standard' and a.status='answered')::int as "requiredAnswered",
        count(*) filter (where q.is_nps)::int as "npsTotal",
        count(*) filter (where q.is_nps and a.status='answered')::int as "npsAnswered"
      from submission_form_questions q
      left join submission_form_answers a on a.form_version_id=q.form_version_id and a.question_id=q.question_id and a.session_id=${sessionId}
      where q.form_version_id=${session.formVersionId!}`)[0]!;
    const complete = count.requiredAnswered === count.required && count.npsTotal === 1 && count.npsAnswered === 1;
    if (complete) await this.sql`update submission_sessions set status='complete', ended_at=${now.toISOString()} where id=${sessionId}`;
    return { sessionId, status: complete ? "complete" as const : "incomplete" as const, answered: input.status === "answered", expiresAt };
  }
  async refreshSession(sessionId: string, now: Date) {
    const session = await this.lockSession(sessionId);
    this.assertActive(session, now);
    if (session.refreshCount >= 3) throw new DomainError("SUBMISSION_REFRESH_LIMIT", "Limite de três renovações atingido.", 409);
    const expiresAt = new Date(timestampToMillis(session.expiresAt!) + SUBMISSION_EXTENSION_MS).toISOString();
    const refreshesUsed = session.refreshCount + 1;
    await this.sql`update submission_sessions set refresh_count=${refreshesUsed}, expires_at=${expiresAt}, last_activity_at=${now.toISOString()} where id=${sessionId}`;
    return { expiresAt, refreshesUsed, refreshesRemaining: 3 - refreshesUsed };
  }
  async closeSession(sessionId: string, now: Date) {
    const session = await this.lockSession(sessionId);
    if (!session.endedAt) await this.sql`update submission_sessions set ended_at=${now.toISOString()} where id=${sessionId}`;
    return { sessionId, status: "closed" as const };
  }
  async endSession(sessionId: string, now: Date): Promise<{ sectorId: number }> {
    const session = await this.lockSession(sessionId);
    this.assertActive(session, now);
    await this.sql`update submission_sessions set ended_at=${now.toISOString()} where id=${sessionId}`;
    return { sectorId: session.sectorId };
  }
  async reconcileExpired(now: Date): Promise<number> {
    const rows = await this.sql<{ id: string }[]>`update submission_sessions set ended_at=${now.toISOString()}
      where status='incomplete' and ended_at is null and expires_at < ${now.toISOString()} returning id`;
    return rows.length;
  }
  async expireSession(sessionId: string, now: Date): Promise<boolean> {
    const rows = await this.sql<{ id: string }[]>`update submission_sessions set ended_at=${now.toISOString()}
      where id=${sessionId} and status='incomplete' and ended_at is null and expires_at < ${now.toISOString()} returning id`;
    return rows.length > 0;
  }
}
