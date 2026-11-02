import type postgres from "postgres";
import type { SubmissionAnswerInput, SubmissionQuestion, SubmissionStart } from "./submission.service.js";
import { DomainError } from "../../shared/core.js";
import { listEffectiveQuestions } from "../questions/effective-question-resolver.js";

export interface SubmissionRepository {
  transaction<T>(work: (repository: SubmissionRepository) => Promise<T>): Promise<T>;
  createSessionSnapshot(input: SubmissionStart): Promise<{ session: { id: string; sectorId: number; shiftSheetVersionId: number; shiftRangeId: number }; questions: SubmissionQuestion[] }>;
  saveAnswer(sessionId: string, input: SubmissionAnswerInput, now: Date): Promise<{ sessionId: string; status: "incomplete" | "complete"; answered: boolean }>;
  endSession(sessionId: string, now: Date): Promise<{ sectorId: number }>;
  reconcileExpired?(now: Date): Promise<number>;
}

export class PostgresSubmissionRepository implements SubmissionRepository {
  constructor(private readonly sql: postgres.Sql) {}

  async transaction<T>(work: (repository: SubmissionRepository) => Promise<T>): Promise<T> {
    if (typeof (this.sql as unknown as { begin?: unknown }).begin !== "function") return work(this);
    return this.sql.begin(async (transaction) => work(new PostgresSubmissionRepository(transaction as unknown as postgres.Sql))) as Promise<T>;
  }

  async createSessionSnapshot(input: SubmissionStart) {
    const shifts = await this.sql<{ versionId: number; rangeId: number }[]>`
      select distinct v.id as "versionId", r.id as "rangeId"
      from shift_sheet_versions v
      join sector_shift_ranges r on r.shift_sheet_version_id = v.id and r.sector_id = ${input.sectorId}
      join employee_shift_assignments a on a.shift_sheet_version_id = v.id and a.sector_id = r.sector_id and a.shift_range_id = r.id
      join sectors s on s.id = r.sector_id and s.deleted_at is null
      where v.is_current = true
        and (
          (r.ends_at > r.starts_at
            and a.day_of_week = ${input.dayOfWeek}
            and ${input.localTime}::time >= r.starts_at
            and ${input.localTime}::time < r.ends_at)
          or (r.ends_at < r.starts_at
            and ((a.day_of_week = ${input.dayOfWeek} and ${input.localTime}::time >= r.starts_at)
              or (a.day_of_week = ${input.previousDayOfWeek} and ${input.localTime}::time < r.ends_at)))
        )
    `;
    if (!shifts[0]) throw new DomainError("SHIFT_NOT_FOUND", "Nenhum turno vigente para o setor e horário informados.", 404);
    if (shifts.length > 1) throw new DomainError("SHIFT_AMBIGUOUS", "Há mais de um turno vigente para o setor e horário informados.", 409);
    const shift = shifts[0];
    const effectiveQuestions = await listEffectiveQuestions(this.sql, input.sectorId, false);
    const questions: SubmissionQuestion[] = effectiveQuestions.map((question, index) => ({
      questionId: question.id,
      questionVersionId: question.versionId,
      text: question.text,
      questionKind: question.questionKind,
      isNps: question.isNps,
      position: index + 1,
      sessionQuestionId: 0,
    }));
    const npsCount = questions.filter((question) => question.isNps).length;
    if (npsCount !== 1) throw new DomainError("NPS_CONFIGURATION_CONFLICT", "O setor precisa ter exatamente um NPS efetivo antes de iniciar uma sessão.", 409);
    const sessionRows = await this.sql<{ id: string }[]>`
      insert into submission_sessions (id, sector_id, shift_sheet_version_id, shift_range_id, started_at, last_activity_at, status)
      values (${input.sessionId}, ${input.sectorId}, ${shift.versionId}, ${shift.rangeId}, ${input.now.toISOString()}, ${input.now.toISOString()}, 'incomplete')
      returning id
    `;
    for (const question of questions) {
      const inserted = await this.sql<{ id: number }[]>`
      insert into submission_session_questions (session_id, question_id, question_version_id, position, question_kind, is_nps, created_at)
      values (${input.sessionId}, ${question.questionId}, ${question.questionVersionId}, ${question.position}, ${question.questionKind}, ${question.isNps}, ${input.now.toISOString()})
      returning id
    `;
      question.sessionQuestionId = inserted[0]!.id;
    }
    return { session: { id: sessionRows[0]!.id, sectorId: input.sectorId, shiftSheetVersionId: shift.versionId, shiftRangeId: shift.rangeId }, questions };
  }

  async saveAnswer(sessionId: string, input: SubmissionAnswerInput, now: Date) {
    const target = await this.sql<{ sectorId: number; shiftRangeId: number; startedAt: Date; lastActivityAt: Date; endedAt: Date | null; questionId: number; questionKind: "sector" | "standard"; isNps: boolean; questionVersionId: number }[]>`
      select s.sector_id as "sectorId", s.shift_range_id as "shiftRangeId", s.started_at as "startedAt", s.last_activity_at as "lastActivityAt", s.ended_at as "endedAt",
             q.question_id as "questionId", q.question_kind as "questionKind", q.is_nps as "isNps", q.question_version_id as "questionVersionId"
      from submission_sessions s join submission_session_questions q on q.session_id = s.id
      where s.id = ${sessionId} and q.id = ${input.sessionQuestionId}
      for update of s
    `;
    const item = target[0];
    if (!item) throw new DomainError("SUBMISSION_QUESTION_NOT_FOUND", "Pergunta não pertence à sessão.", 404);
    if (item.endedAt) throw new DomainError("SUBMISSION_CLOSED", "Sessão já encerrada.", 409);
    if (now.getTime() - item.lastActivityAt.getTime() > 2 * 60_000) {
      await this.sql`update submission_sessions set ended_at = ${now.toISOString()} where id = ${sessionId} and ended_at is null`;
      throw new DomainError("SUBMISSION_EXPIRED", "Sessão expirada por inatividade.", 410);
    }
    if (input.status === "skipped" && item.questionKind !== "sector") throw new DomainError("QUESTION_NOT_SKIPPABLE", "Somente perguntas de setor podem ser puladas.", 400);
    const max = item.isNps ? 10 : 5;
    const min = item.isNps ? 0 : 1;
    if (input.status === "answered" && (input.score === null || input.score < min || input.score > max)) throw new DomainError("INVALID_ANSWER_SCORE", "Nota fora da escala da pergunta.", 400);
    await this.sql`
      insert into submission_answers (session_question_id, status, score, created_at, updated_at)
      values (${input.sessionQuestionId}, ${input.status}, ${input.score}, ${now.toISOString()}, ${now.toISOString()})
      on conflict (session_question_id) do update set status = excluded.status, score = excluded.score, updated_at = excluded.updated_at
    `;
    await this.sql`update submission_sessions set last_activity_at = ${now.toISOString()} where id = ${sessionId}`;
    await this.sql`
      insert into dashboard_dirty_groups (summary_type, hour_bucket, sector_id, shift_range_id, question_id, question_version_id, queued_at)
      values ('answers', date_trunc('hour', ${item.startedAt.toISOString()}::timestamptz), ${item.sectorId}, ${item.shiftRangeId}, ${item.questionId}, ${item.questionVersionId}, ${now.toISOString()})
      on conflict do nothing
    `;
    const counts = await this.sql<{ total: number; answered: number; skippedSector: number; npsAnswered: number }[]>`
      select count(*)::int as total,
             count(*) filter (where a.status = 'answered')::int as answered,
             count(*) filter (where a.status = 'skipped' and q.question_kind = 'sector')::int as "skippedSector",
             count(*) filter (where q.is_nps and a.status = 'answered')::int as "npsAnswered"
      from submission_session_questions q left join submission_answers a on a.session_question_id = q.id
      where q.session_id = ${sessionId}
    `;
    const count = counts[0]!;
    const complete = count.answered === count.total && count.skippedSector === 0 && count.npsAnswered === 1;
    if (complete) await this.sql`update submission_sessions set status = 'complete', ended_at = ${now.toISOString()} where id = ${sessionId}`;
    return { sessionId, status: complete ? "complete" as const : "incomplete" as const, answered: input.status === "answered" };
  }

  async endSession(sessionId: string, now: Date): Promise<{ sectorId: number }> {
    const rows = await this.sql<{ sectorId: number }[]>`
      update submission_sessions set ended_at = ${now.toISOString()}
      where id = ${sessionId} and ended_at is null
      returning sector_id as "sectorId"
    `;
    if (!rows[0]) throw new DomainError("SUBMISSION_NOT_FOUND", "Sessão não encontrada ou já encerrada.", 404);
    return rows[0];
  }

  async reconcileExpired(now: Date): Promise<number> {
    const rows = await this.sql<{ id: string }[]>`
      update submission_sessions
      set ended_at = ${now.toISOString()}
      where status = 'incomplete' and ended_at is null
        and last_activity_at < ${new Date(now.getTime() - 2 * 60_000).toISOString()}
      returning id
    `;
    return rows.length;
  }
}
