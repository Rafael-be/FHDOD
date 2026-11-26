import { createHash } from "node:crypto";
import type postgres from "postgres";
import { DomainError } from "../../shared/core.js";
import { publishedFormCache } from "./form-cache.js";
import { measurePerformance } from "../../shared/performance.js";
import { logPerformanceMeasurement } from "../../shared/logger.js";
import { surveyEvent } from "../../shared/performance.js";
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
  currentForm?(sectorId: number): Promise<{ formVersionId: number; questions: SubmissionQuestion[] }>;
  lockAttempt?(attemptId: string): Promise<void>;
  firstAttempt?(attemptId: string): Promise<{ sectorId: number; formVersionId: number; capabilityHash: Buffer; answer: { questionId: number; questionVersionId: number; status: string; score: number | null }; expiresAt: string; status: string } | null>;
  createSessionSnapshot(input: SubmissionStart, expectedFormVersionId?: number): Promise<{ session: { id: string; sectorId: number; formVersionId: number; expiresAt: string; shiftSheetVersionId: number | null; shiftRangeId: number | null }; questions: SubmissionQuestion[] }>;
  capabilityHash?(sessionId: string): Promise<Buffer | null>;
  saveAnswer(sessionId: string, input: SubmissionAnswerInput, now: Date, first?: boolean, confirmedAt?: () => Date): Promise<{ sessionId: string; status: "incomplete" | "complete"; answered: boolean; expiresAt: string; replayed?: boolean }>;
  endSession(sessionId: string, now: Date, confirmedAt?: () => Date): Promise<{ sectorId: number }>;
  refreshSession?(sessionId: string, now: Date, confirmedAt?: () => Date): Promise<{ expiresAt: string; refreshesUsed: number; refreshesRemaining: number }>;
  closeSession?(sessionId: string, now: Date, confirmedAt?: () => Date): Promise<{ sessionId: string; status: "closed" }>;
  reconcileExpired?(now: Date): Promise<number>;
  expireSession?(sessionId: string, now: Date): Promise<boolean>;
}
interface LockedSession {
  sectorId: number; formVersionId: number | null; shiftRangeId: number | null;
  startedAt: DatabaseTimestamp; expiresAt: DatabaseTimestamp | null;
  endedAt: DatabaseTimestamp | null; refreshCount: number; status: string;
}

export class PostgresSubmissionRepository implements SubmissionRepository {
  constructor(private readonly sql: postgres.Sql, private readonly trace = false) {}
  private measured<T>(stage: string, work: () => Promise<T>): Promise<T> {
    return measurePerformance(this.trace, "submission.create", stage, work);
  }
  async capabilityHash(sessionId: string): Promise<Buffer | null> {
    const rows = await this.sql<{ hash: Buffer }[]>`select capability_hash as hash from submission_sessions where id=${sessionId}`;
    return rows[0]?.hash ?? null;
  }
  async lockAttempt(attemptId: string): Promise<void> {
    await this.sql`select pg_advisory_xact_lock(912011, hashtext(${attemptId}))`;
  }
  async firstAttempt(attemptId: string) {
    const rows = await this.sql<{ sectorId: number; formVersionId: number; capabilityHash: Buffer; expiresAt: DatabaseTimestamp; status: string }[]>`
      select sector_id as "sectorId", form_version_id as "formVersionId", capability_hash as "capabilityHash", expires_at as "expiresAt", status
      from submission_sessions where id=${attemptId}`;
    if (!rows[0]) return null;
    const answers = await this.sql<{ questionId: number; questionVersionId: number; status: string; score: number | null }[]>`
      select a.question_id as "questionId", a.question_version_id as "questionVersionId", a.status, a.score
      from submission_form_answers a join submission_form_questions q
        on q.form_version_id=a.form_version_id and q.question_id=a.question_id
      where a.session_id=${attemptId} order by q.position limit 1`;
    if (!answers[0]) throw new DomainError("SUBMISSION_CONFLICT", "Tentativa sem resposta inicial.", 409);
    return { ...rows[0], expiresAt: timestampToIso(rows[0].expiresAt), answer: answers[0] };
  }
  async currentForm(sectorId: number) {
    const rows = await this.sql<{ formVersionId: number | null }[]>`
      select c.form_version_id as "formVersionId"
      from sectors s left join sector_current_forms c on c.sector_id=s.id
      where s.id=${sectorId} and s.deleted_at is null limit 1`;
    if (!rows[0]) throw new DomainError("SECTOR_NOT_FOUND", "Setor inexistente ou inativo.", 404);
    if (!rows[0].formVersionId) throw new DomainError("FORM_NOT_PUBLISHED", "Setor sem formulário publicado vigente.", 409);
    const formVersionId = rows[0].formVersionId;
    const questions = await publishedFormCache.get(this.sql, formVersionId);
    if (questions.filter((q) => q.isNps).length !== 1 || !questions.some((q) => q.questionKind === "standard" && !q.isNps))
      throw new DomainError("FORM_INCOMPLETE", "Formulário publicado incompleto.", 409);
    return { formVersionId, questions };
  }
  async transaction<T>(work: (repository: SubmissionRepository) => Promise<T>): Promise<T> {
    if (typeof (this.sql as unknown as { begin?: unknown }).begin !== "function") return work(this);
    const started = performance.now();
    let entered = started;
    let completed = started;
    let committed = false;
    try {
      const result = await this.sql.begin(async (tx) => {
        entered = performance.now();
        try { return await work(new PostgresSubmissionRepository(tx as unknown as postgres.Sql, this.trace)); }
        finally { completed = performance.now(); }
      }) as T;
      committed = true;
      return result;
    } finally {
      if (this.trace) {
        // Includes pool wait and BEGIN; the final segment includes COMMIT or ROLLBACK.
        logPerformanceMeasurement("submission.transaction", "acquire_begin", entered - started);
        logPerformanceMeasurement("submission.transaction", committed ? "commit" : "rollback", performance.now() - completed);
      }
    }
  }
  private async lockSession(sessionId: string): Promise<LockedSession> {
    const rows = await this.sql<LockedSession[]>`
      select sector_id as "sectorId", form_version_id as "formVersionId", shift_range_id as "shiftRangeId",
        started_at as "startedAt", expires_at as "expiresAt", ended_at as "endedAt", refresh_count as "refreshCount", status
      from submission_sessions where id = ${sessionId} for update`;
    if (!rows[0] || rows[0].formVersionId === null || rows[0].expiresAt === null)
      throw new DomainError("SUBMISSION_NOT_FOUND", "Sessão não encontrada.", 404);
    return rows[0];
  }
  private assertActive(session: LockedSession, now: Date): void {
    if (session.endedAt) throw new DomainError("SUBMISSION_CLOSED", "Sessão já encerrada.", 409);
    if (timestampToMillis(session.expiresAt!) < now.getTime()) throw new DomainError("SUBMISSION_EXPIRED", "Sessão expirada.", 410);
  }
  async createSessionSnapshot(input: SubmissionStart, expectedFormVersionId?: number) {
    const shifts = await this.measured("shift_query", () => this.sql<{ versionId: number; rangeId: number }[]>`
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
          or (coalesce(r.day_of_week, a.day_of_week) = ${input.previousDayOfWeek} and ${input.localTime}::time < r.ends_at))))`);
    if (shifts.length > 1) throw new DomainError("SHIFT_AMBIGUOUS", "Há mais de um turno vigente para o horário.", 409);
    const fallback = shifts[0] ? undefined : (await this.measured("shift_fallback", () => this.sql<{ versionId: number | null; rangeId: null }[]>`
      select v.id as "versionId", null::integer as "rangeId" from sectors s
      left join shift_sheet_versions v on v.is_current = true
      where s.id = ${input.sectorId} and s.deleted_at is null limit 1`))[0];
    if (!shifts[0] && !fallback) throw new DomainError("SECTOR_NOT_FOUND", "Setor inexistente ou inativo.", 404);
    const shift = shifts[0] ?? fallback!;
    await this.measured("sector_lock_wait", () => this.sql`select pg_advisory_xact_lock(912010, ${input.sectorId})`);
    const { formVersionId, questions } = await this.measured("published_form_lookup", () => this.currentForm(input.sectorId));
    if (expectedFormVersionId !== undefined && formVersionId !== expectedFormVersionId)
      throw new DomainError("FORM_VERSION_CHANGED", "O formulário vigente foi alterado. Recarregue a pesquisa.", 409);
    const createdAt = input.confirmedAt?.() ?? input.now;
    const expiresAt = new Date(createdAt.getTime() + SUBMISSION_INITIAL_MS).toISOString();
    const rows = await this.measured("session_insert", () => this.sql<{ id: string }[]>`
      insert into submission_sessions(id, sector_id, form_version_id, shift_sheet_version_id, shift_range_id,
        started_at, last_activity_at, expires_at, status, capability_hash)
      values (${input.sessionId}, ${input.sectorId}, ${formVersionId}, ${shift.versionId}, ${shift.rangeId},
        ${createdAt.toISOString()}, ${createdAt.toISOString()}, ${expiresAt}, 'incomplete', ${input.capabilityHash ?? createHash("sha256").update(input.sessionId).digest()}) returning id`);
    return { session: { id: rows[0]!.id, sectorId: input.sectorId, formVersionId, expiresAt,
      shiftSheetVersionId: shift.versionId, shiftRangeId: shift.rangeId }, questions };
  }
  async saveAnswer(sessionId: string, input: SubmissionAnswerInput, now: Date, first = false, confirmedAt?: () => Date) {
    const session = await this.lockSession(sessionId);
    now = confirmedAt?.() ?? now;
    if (session.status !== "complete") this.assertActive(session, now);
    const questions = await publishedFormCache.get(this.sql, session.formVersionId!);
    const question = questions
      .find((q) => q.questionId === input.questionId && q.questionVersionId === input.questionVersionId);
    if (!question) throw new DomainError("SUBMISSION_QUESTION_NOT_FOUND", "Pergunta ou versão não pertence ao formulário.", 404);
    if (input.status === "skipped" && (question.isNps || question.questionKind !== "sector"))
      throw new DomainError("QUESTION_NOT_SKIPPABLE", "Somente perguntas de setor podem ser puladas.", 400);
    if (input.status === "answered" && (input.score === null || input.score < (question.isNps ? 0 : 1) || input.score > (question.isNps ? 10 : 5)))
      throw new DomainError("INVALID_ANSWER_SCORE", "Nota fora da escala da pergunta.", 400);
    const existing = await this.sql<{ questionId: number; status: string; score: number | null }[]>`
      select question_id as "questionId", status, score from submission_form_answers where session_id=${sessionId}`;
    const previous = existing.find((row) => row.questionId === input.questionId);
    if (previous && (previous.status !== input.status || previous.score !== input.score))
      throw new DomainError("ANSWER_ALREADY_CONFIRMED", "Resposta já confirmada não pode ser alterada.", 409);
    if (previous) return { sessionId, status: session.status === "complete" ? "complete" as const : "incomplete" as const, answered: input.status === "answered", expiresAt: timestampToIso(session.expiresAt!), replayed: true };
    if (session.status === "complete") throw new DomainError("SUBMISSION_CLOSED", "Sessão já encerrada.", 409);
    const expected = questions.find((item) => !existing.some((row) => row.questionId === item.questionId));
    if (!previous && expected?.questionId !== input.questionId)
      throw new DomainError("QUESTION_OUT_OF_SEQUENCE", "Responda a próxima pergunta do formulário.", 409);
    surveyEvent("ANSWER_VALIDATED", "submission.answer");
    const expiresAt = !previous && !first ? new Date(now.getTime() + SUBMISSION_EXTENSION_MS).toISOString() : timestampToIso(session.expiresAt!);
    if (!previous) {
      await this.sql`
        insert into submission_form_answers(session_id, form_version_id, question_id, question_version_id, status, score, created_at, updated_at)
        values (${sessionId}, ${session.formVersionId!}, ${input.questionId}, ${input.questionVersionId}, ${input.status}, ${input.score}, ${now.toISOString()}, ${now.toISOString()})
        on conflict (session_id, question_id) do nothing`;
      if (!first) await this.sql`update submission_sessions set last_activity_at=${now.toISOString()}, expires_at=${expiresAt} where id=${sessionId}`;
      if (session.shiftRangeId !== null) await this.sql`
        insert into dashboard_dirty_groups(summary_type, hour_bucket, sector_id, shift_range_id, question_id, question_version_id, queued_at)
        values ('answers', date_trunc('hour', ${timestampToIso(session.startedAt)}::timestamptz), ${session.sectorId}, ${session.shiftRangeId}, ${input.questionId}, ${input.questionVersionId}, ${now.toISOString()})
        on conflict do nothing`;
    }
    // Sequential validation guarantees every preceding standard/NPS question was answered.
    const complete = existing.length + 1 === questions.length;
    if (complete) await this.sql`update submission_sessions set status='complete', ended_at=${now.toISOString()} where id=${sessionId}`;
    return { sessionId, status: complete ? "complete" as const : "incomplete" as const, answered: input.status === "answered", expiresAt, replayed: false };
  }
  async refreshSession(sessionId: string, now: Date, confirmedAt?: () => Date) {
    const session = await this.lockSession(sessionId);
    now = confirmedAt?.() ?? now;
    this.assertActive(session, now);
    if (session.refreshCount >= 3) throw new DomainError("SUBMISSION_REFRESH_LIMIT", "Limite de três renovações atingido.", 409);
    const expiresAt = new Date(now.getTime() + SUBMISSION_EXTENSION_MS).toISOString();
    const refreshesUsed = session.refreshCount + 1;
    await this.sql`update submission_sessions set refresh_count=${refreshesUsed}, expires_at=${expiresAt}, last_activity_at=${now.toISOString()} where id=${sessionId}`;
    return { expiresAt, refreshesUsed, refreshesRemaining: 3 - refreshesUsed };
  }
  async closeSession(sessionId: string, now: Date, confirmedAt?: () => Date) {
    const session = await this.lockSession(sessionId);
    if (session.status === "complete")
      throw new DomainError("SUBMISSION_COMPLETED", "Sessão já concluída.", 409);
    now = confirmedAt?.() ?? now;
    // A previously closed session can be retried even after its original deadline.
    const effectiveEnd = session.endedAt ?? now;
    if (timestampToMillis(effectiveEnd) > timestampToMillis(session.expiresAt!))
      throw new DomainError("SUBMISSION_EXPIRED", "Sessão expirada.", 410);
    if (!session.endedAt) await this.sql`update submission_sessions set ended_at=${now.toISOString()} where id=${sessionId}`;
    return { sessionId, status: "closed" as const };
  }
  async endSession(sessionId: string, now: Date, confirmedAt?: () => Date): Promise<{ sectorId: number }> {
    const session = await this.lockSession(sessionId);
    now = confirmedAt?.() ?? now;
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
