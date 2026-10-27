import type postgres from "postgres";
import type { SubmissionAnswerInput, SubmissionQuestion, SubmissionStart } from "./submission.service.js";

export interface SubmissionRepository {
  transaction<T>(work: (repository: SubmissionRepository) => Promise<T>): Promise<T>;
  createSessionSnapshot(input: SubmissionStart): Promise<{ session: { id: string; sectorId: number; shiftSheetVersionId: number; shiftRangeId: number }; questions: SubmissionQuestion[] }>;
  saveAnswer(sessionId: string, input: SubmissionAnswerInput, now: Date): Promise<{ sessionId: string; status: "incomplete" | "complete"; answered: boolean }>;
}

export class PostgresSubmissionRepository implements SubmissionRepository {
  constructor(private readonly sql: postgres.Sql) {}

  async transaction<T>(work: (repository: SubmissionRepository) => Promise<T>): Promise<T> {
    if (typeof (this.sql as unknown as { begin?: unknown }).begin !== "function") return work(this);
    return this.sql.begin(async (transaction) => work(new PostgresSubmissionRepository(transaction as unknown as postgres.Sql))) as Promise<T>;
  }

  async createSessionSnapshot(input: SubmissionStart) {
    const shift = await this.sql<{ versionId: number; rangeId: number }[]>`
      select v.id as "versionId", r.id as "rangeId"
      from shift_sheet_versions v
      join sector_shift_ranges r on r.shift_sheet_version_id = v.id and r.sector_id = ${input.sectorId}
      join employee_shift_assignments a on a.shift_range_id = r.id and a.shift_sheet_version_id = v.id and a.day_of_week = ${input.dayOfWeek}
      where v.is_current = true
        and ((r.ends_at > r.starts_at and ${input.localTime}::time >= r.starts_at and ${input.localTime}::time < r.ends_at)
          or (r.ends_at < r.starts_at and (${input.localTime}::time >= r.starts_at or ${input.localTime}::time < r.ends_at)))
      order by r.starts_at
      limit 1
    `;
    if (!shift[0]) throw new Error("Nenhum turno vigente para o setor e horário informados.");
    const questions = await this.sql<SubmissionQuestion[]>`
      with effective_questions as (
        select q.id, q.question_kind as "questionKind", q.is_nps as "isNps", q.display_order as "displayOrder"
        from questions q where q.sector_id = ${input.sectorId} and q.deleted_at is null and q.is_nps = false
        union all
        select q.id, q.question_kind as "questionKind", q.is_nps as "isNps", a.display_order as "displayOrder"
        from questions q join question_sector_assignments a on a.question_id = q.id and a.sector_id = ${input.sectorId} and a.ended_at is null
        where q.deleted_at is null and q.is_nps = false
        union all
        select q.id, q.question_kind as "questionKind", q.is_nps as "isNps", 1 as "displayOrder"
        from questions q join sector_nps_assignments n on n.question_id = q.id and n.sector_id = ${input.sectorId} and n.ended_at is null
        where q.deleted_at is null and q.is_nps = true
      ), ordered as (
        select distinct on (id) id, "questionKind", "isNps", "displayOrder"
        from effective_questions order by id, "displayOrder"
      )
      select o.id as "questionId", v.id as "questionVersionId", v.text,
             o."questionKind", o."isNps", row_number() over (order by o."isNps", o."displayOrder", o.id)::int as position
      from ordered o join question_versions v on v.question_id = o.id and v.is_current = true
      order by position
    `;
    const npsCount = questions.filter((question) => question.isNps).length;
    if (npsCount !== 1) throw new Error("Setor sem exatamente um NPS efetivo.");
    const sessionRows = await this.sql<{ id: string }[]>`
      insert into submission_sessions (id, sector_id, shift_sheet_version_id, shift_range_id, started_at, last_activity_at, status)
      values (${input.sessionId}, ${input.sectorId}, ${shift[0].versionId}, ${shift[0].rangeId}, ${input.now.toISOString()}, ${input.now.toISOString()}, 'incomplete')
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
    return { session: { id: sessionRows[0]!.id, sectorId: input.sectorId, shiftSheetVersionId: shift[0].versionId, shiftRangeId: shift[0].rangeId }, questions };
  }

  async saveAnswer(sessionId: string, input: SubmissionAnswerInput, now: Date) {
    const target = await this.sql<{ sectorId: number; shiftRangeId: number; startedAt: Date; lastActivityAt: Date; questionId: number; questionKind: "sector" | "standard"; isNps: boolean; questionVersionId: number }[]>`
      select s.sector_id as "sectorId", s.shift_range_id as "shiftRangeId", s.started_at as "startedAt", s.last_activity_at as "lastActivityAt",
             q.question_id as "questionId", q.question_kind as "questionKind", q.is_nps as "isNps", q.question_version_id as "questionVersionId"
      from submission_sessions s join submission_session_questions q on q.session_id = s.id
      where s.id = ${sessionId} and q.id = ${input.sessionQuestionId}
      for update
    `;
    const item = target[0];
    if (!item) throw new Error("Pergunta não pertence à sessão.");
    if (now.getTime() - item.lastActivityAt.getTime() > 2 * 60_000) throw new Error("Sessão expirada por inatividade.");
    if (input.status === "skipped" && item.questionKind !== "sector") throw new Error("Somente perguntas de setor podem ser puladas.");
    const max = item.isNps ? 10 : 5;
    const min = item.isNps ? 0 : 1;
    if (input.status === "answered" && (input.score === null || input.score < min || input.score > max)) throw new Error("Nota fora da escala da pergunta.");
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
}
