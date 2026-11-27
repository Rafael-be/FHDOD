import type postgres from "postgres";
import type { AnalyticsFilter, QuestionDistributionMetric } from "../analytics/analytics.types.js";

export interface ReportQuestion extends QuestionDistributionMetric { sectorId:number; sectorName:string; }
export interface TicketSummary { total:number; resolved:number; pending:number; resolutionPercentage:number|null;
  byType:{ticketType:string;tickets:number}[]; byStatus:{status:string;tickets:number}[];
  bySector:{sectorId:number;sectorName:string;tickets:number}[]; daily:{day:string;tickets:number}[]; }
export class ReportsRepository {
  constructor(private readonly sql:postgres.Sql) {}
  async dailySessions(filter:AnalyticsFilter,allowed:number[]|null):Promise<{day:string;started:number;complete:number}[]> {
    return this.sql<{day:string;started:number;complete:number}[]>`
      select (started_at at time zone 'America/Sao_Paulo')::date::text as day,
        count(*)::int as started,count(*) filter(where status='complete')::int as complete
      from submission_sessions where started_at>=${filter.from}::timestamptz and started_at<${filter.to}::timestamptz
        and (${filter.sectorId ?? null}::int is null or sector_id=${filter.sectorId ?? null})
        and (${allowed === null} or sector_id=any(${allowed ?? []}::int[]))
      group by 1 order by 1`;
  }
  async sectorNames(ids:number[]):Promise<{id:number;name:string}[]> {
    if (!ids.length) return [];
    return this.sql<{id:number;name:string}[]>`select id,name from sectors where id=any(${ids}::int[]) and deleted_at is null order by name,id`;
  }
  async questions(filter:AnalyticsFilter, allowed:number[]|null):Promise<ReportQuestion[]> {
    return this.sql<ReportQuestion[]>`with current_questions as (
      select c.sector_id,s.name as sector_name,q.question_id,q.question_version_id,q.text,q.position
      from sector_current_forms c join sectors s on s.id=c.sector_id and s.deleted_at is null
      join submission_form_questions q on q.form_version_id=c.form_version_id and not q.is_nps
      where (${filter.sectorId ?? null}::int is null or c.sector_id=${filter.sectorId ?? null})
        and (${allowed === null} or c.sector_id=any(${allowed ?? []}::int[]))
    ), candidates as materialized (
      select id,sector_id,form_version_id from submission_sessions
      where started_at>=${filter.from}::timestamptz and started_at<${filter.to}::timestamptz
        and (${filter.sectorId ?? null}::int is null or sector_id=${filter.sectorId ?? null})
        and (${allowed === null} or sector_id=any(${allowed ?? []}::int[]))
    ), raw as (
      select s.sector_id,a.question_id,a.question_version_id,a.status,a.score from candidates s
      join submission_form_answers a on a.session_id=s.id
      join submission_form_questions q on q.form_version_id=a.form_version_id and q.question_id=a.question_id and not q.is_nps
      union all
      select s.sector_id,q.question_id,q.question_version_id,a.status,a.score from candidates s
      join submission_session_questions q on q.session_id=s.id and not q.is_nps
      join submission_answers a on a.session_question_id=q.id where s.form_version_id is null
    ), counts as (
      select r.sector_id,r.question_id,r.question_version_id,r.score,r.status,count(*)::int as n
      from raw r where r.status='skipped' or (r.status='answered' and r.score between 1 and 5)
      group by r.sector_id,r.question_id,r.question_version_id,r.score,r.status
    )
    select q.sector_id as "sectorId",q.sector_name as "sectorName",q.question_id as "questionId",
      q.question_version_id as "questionVersionId",q.text,q.position,
      (select sum(x.score*x.n)::float8/nullif(sum(x.n),0) from counts x where x.sector_id=q.sector_id and x.question_id=q.question_id and x.question_version_id=q.question_version_id and x.status='answered') as mean,
      (select coalesce(sum(x.n),0)::int from counts x where x.sector_id=q.sector_id and x.question_id=q.question_id and x.question_version_id=q.question_version_id and x.status='answered') as responses,
      (select coalesce(sum(x.n),0)::int from counts x where x.sector_id=q.sector_id and x.question_id=q.question_id and x.question_version_id=q.question_version_id and x.status='skipped') as skipped,
      (select jsonb_agg(jsonb_build_object('score',grade.score,'responses',coalesce(x.n,0)) order by grade.score)
       from generate_series(1,5) grade(score) left join counts x on x.sector_id=q.sector_id and x.question_id=q.question_id
         and x.question_version_id=q.question_version_id and x.status='answered' and x.score=grade.score) as distribution
    from current_questions q order by q.sector_name,q.sector_id,q.position limit 5001`;
  }
  async ombudsman(filter:AnalyticsFilter):Promise<TicketSummary> {
    const [row] = await this.sql<{data:TicketSummary}[]>`with tickets as materialized (
      select t.sector_id,t.ticket_type,t.status,(t.occurred_at at time zone 'America/Sao_Paulo')::date as day
      from ombudsman_tickets t where t.occurred_at>=${filter.from}::timestamptz and t.occurred_at<${filter.to}::timestamptz
        and (${filter.sectorId ?? null}::int is null or t.sector_id=${filter.sectorId ?? null})
    ) select jsonb_build_object(
      'total',(select count(*) from tickets),'resolved',(select count(*) from tickets where status='resolved'),
      'pending',(select count(*) from tickets where status<>'resolved'),
      'resolutionPercentage',(select 100.0*count(*) filter(where status='resolved')/nullif(count(*),0) from tickets),
      'byType',coalesce((select jsonb_agg(x order by "ticketType") from (select ticket_type as "ticketType",count(*) as tickets from tickets group by 1) x),'[]'::jsonb),
      'byStatus',coalesce((select jsonb_agg(x order by status) from (select status,count(*) as tickets from tickets group by 1) x),'[]'::jsonb),
      'bySector',coalesce((select jsonb_agg(x order by "sectorName") from (select t.sector_id as "sectorId",s.name as "sectorName",count(*) as tickets from tickets t join sectors s on s.id=t.sector_id group by 1,2) x),'[]'::jsonb),
      'daily',coalesce((select jsonb_agg(x order by day) from (select day,count(*) as tickets from tickets group by 1) x),'[]'::jsonb)
    ) as data`;
    return row!.data;
  }
}
