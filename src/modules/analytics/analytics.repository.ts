import type postgres from "postgres";

export interface AnalyticsFilter { from: string; to: string; sectorId?: number; sectorIds?: number[]; shiftRangeId?: number; }
export class AnalyticsRepository {
  constructor(private readonly sql: postgres.Sql) {}
  async sectorIds(userId: number): Promise<number[]> {
    const rows = await this.sql<{ id: number }[]>`select sector_id as id from user_sector_assignments where user_id=${userId} and unassigned_at is null`;
    return rows.map(row => row.id);
  }
  private sectorScope(filter: AnalyticsFilter, allowed: number[] | null) {
    if (!filter.sectorIds) return allowed;
    return allowed === null ? filter.sectorIds : filter.sectorIds.filter(id => allowed.includes(id));
  }
  private cohort(filter: AnalyticsFilter, scope: number[] | null) {
    return this.sql`
      with candidates as materialized (
        select id, sector_id, form_version_id, status, started_at, ended_at, expires_at, shift_range_id
        from submission_sessions s where started_at>=${filter.from}::timestamptz and started_at<${filter.to}::timestamptz
          and (${filter.sectorId ?? null}::int is null or s.sector_id=${filter.sectorId ?? null})
          and (${filter.shiftRangeId ?? null}::int is null or s.shift_range_id=${filter.shiftRangeId ?? null})
          and (${scope === null} or s.sector_id=any(${scope ?? []}::int[]))
      ), raw_answers as (
        select s.id as session_id, s.sector_id, s.started_at, a.question_id, a.question_version_id, q.is_nps, a.status, a.score
        from candidates s join submission_form_answers a on a.session_id=s.id
          join submission_form_questions q on q.form_version_id=a.form_version_id and q.question_id=a.question_id
        union all
        select s.id as session_id, s.sector_id, s.started_at, q.question_id, q.question_version_id, q.is_nps, a.status, a.score
        from candidates s join submission_session_questions q on q.session_id=s.id
          join submission_answers a on a.session_question_id=q.id where s.form_version_id is null
      ), answers as materialized (
        select * from raw_answers where status='skipped' or
          (status='answered' and score between (case when is_nps then 0 else 1 end) and (case when is_nps then 10 else 5 end))
      ), sessions as (
        select * from candidates s where exists (
          select 1 from answers a where a.session_id=s.id and a.status='answered')
      )`;
  }
  async dashboard(filter: AnalyticsFilter, allowed: number[] | null): Promise<Record<string, unknown>> {
    const scope = this.sectorScope(filter, allowed);
    const [row] = await this.sql<{ data: Record<string, unknown> }[]>`
      ${this.cohort(filter, scope)}, tickets as (
        select sector_id,ticket_type,status from ombudsman_tickets t
        where ${allowed === null} and occurred_at>=${filter.from}::timestamptz and occurred_at<${filter.to}::timestamptz
          and (${filter.sectorId ?? null}::int is null or t.sector_id=${filter.sectorId ?? null})
          and (${filter.shiftRangeId ?? null}::int is null or t.shift_range_id=${filter.shiftRangeId ?? null})
          and (${scope === null} or t.sector_id=any(${scope ?? []}::int[]))
      ) select jsonb_build_object(
        'sessions',(select jsonb_build_object('started',count(*),'complete',count(*) filter(where status='complete'),
          'incomplete',count(*) filter(where status='incomplete'),'closedIncomplete',count(*) filter(where status='incomplete' and ended_at is not null),
          'inProgress',count(*) filter(where status='incomplete' and ended_at is null and expires_at>=statement_timestamp()),
          'endedOrExpired',count(*) filter(where status='incomplete' and (ended_at is not null or expires_at<statement_timestamp())),
          'unknownDeadline',count(*) filter(where status='incomplete' and ended_at is null and expires_at is null),
          'completionRate',100.0*count(*) filter(where status='complete')/nullif(count(*),0),
          'nonCompletionRate',100.0*count(*) filter(where status='incomplete')/nullif(count(*),0)) from sessions),
        'nps',(select jsonb_build_object('responses',count(*),'detractors',count(*) filter(where score<=6),
          'passives',count(*) filter(where score between 7 and 8),'promoters',count(*) filter(where score>=9),
          'value',100.0*(count(*) filter(where score>=9)-count(*) filter(where score<=6))/nullif(count(*),0)) from answers where is_nps and status='answered'),
        'questions',coalesce((select jsonb_agg(x order by question_id,question_version_id) from (
          select question_id,question_version_id,is_nps,count(*) filter(where status='answered') as responses,
            count(*) filter(where status='skipped') as skipped,avg(score) filter(where status='answered' and not is_nps) as mean
          from answers group by question_id,question_version_id,is_nps) x),'[]'::jsonb),
        'distribution',coalesce((select jsonb_agg(x order by is_nps,score) from (
          select is_nps,score,count(*) as responses from answers where status='answered' group by is_nps,score) x),'[]'::jsonb),
        'daily',coalesce((select jsonb_agg(x order by day) from (
          select (started_at at time zone 'America/Sao_Paulo')::date as day,count(*) as started,
            count(*) filter(where status='complete') as complete from sessions group by day) x),'[]'::jsonb),
        'sectors',coalesce((select jsonb_agg(x order by sector_id) from (
          select sector_id,count(*) as started,count(*) filter(where status='complete') as complete from sessions group by sector_id) x),'[]'::jsonb),
        'ombudsman',coalesce((select jsonb_agg(x order by sector_id,ticket_type,status) from (
          select sector_id,ticket_type,status,count(*) as tickets from tickets group by sector_id,ticket_type,status) x),'[]'::jsonb),
        'dailyAnswers',coalesce((select jsonb_agg(x order by day) from (
          select (started_at at time zone 'America/Sao_Paulo')::date as day,
            avg(score) filter(where not is_nps and status='answered') as mean,
            count(*) filter(where is_nps and status='answered') as nps_responses,
            100.0*(count(*) filter(where is_nps and status='answered' and score>=9)-count(*) filter(where is_nps and status='answered' and score<=6))
              /nullif(count(*) filter(where is_nps and status='answered'),0) as nps
          from answers group by day) x),'[]'::jsonb),
        'responseRate',null,'teamAttributionAvailable',false,'timeZone','America/Sao_Paulo',
        'privacyNotice','Agregados podem conter amostras pequenas; não representam desempenho individual.'
      ) as data`;
    return row!.data;
  }
}
