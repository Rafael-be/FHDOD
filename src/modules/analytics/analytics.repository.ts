import type postgres from "postgres";

import type { AnalyticsFilter, Dashboard, GlobalQuestionMetric, SectorHeatmapMetric, QuestionDistributionMetric, CriticalQuestionMetric } from "./analytics.types.js";

export type { AnalyticsFilter } from "./analytics.types.js";

export class AnalyticsRepository {
  constructor(private readonly sql: postgres.Sql) {}
  async sectorIds(userId: number): Promise<number[]> {
    const rows = await this.sql<{ id: number }[]>`select sector_id as id from user_sector_assignments where user_id=${userId} and unassigned_at is null`;
    return rows.map(row => row.id);
  }
  async heatmap(filter: AnalyticsFilter, allowed: number[] | null): Promise<SectorHeatmapMetric[]> {
    const scope = this.sectorScope(filter, allowed);
    return this.sql<SectorHeatmapMetric[]>`
      ${this.cohort(filter, scope)}, session_totals as (
        select sector_id, count(*)::int as started, count(*) filter(where status='complete')::int as completed
        from candidates group by sector_id
      ), answer_totals as (
        select sector_id,
          avg(score) filter(where status='answered' and not is_nps)::float8 as "satisfactionMean",
          avg(score) filter(where status='answered' and is_nps)::float8 as "npsMean",
          (100.0*count(*) filter(where status='answered' and not is_nps and score>=4)/
            nullif(count(*) filter(where status='answered' and not is_nps),0))::float8 as "positivePercentage",
          count(*) filter(where status='answered' and not is_nps)::int as responses,
          count(*) filter(where status='answered' and is_nps)::int as "npsResponses"
        from answers group by sector_id
      )
      select s.id as "sectorId", a."satisfactionMean", a."npsMean", a."positivePercentage",
        (100.0*t.completed/nullif(t.started,0))::float8 as "completionRate",
        coalesce(a.responses,0)::int as responses,coalesce(a."npsResponses",0)::int as "npsResponses",
        coalesce(t.started,0)::int as started,coalesce(t.completed,0)::int as completed
      from sectors s left join session_totals t on t.sector_id=s.id
      left join answer_totals a on a.sector_id=s.id
      where s.deleted_at is null and (${scope === null} or s.id=any(${scope ?? []}::int[]))
        and (${filter.sectorId ?? null}::int is null or s.id=${filter.sectorId ?? null})
      order by s.id`;
  }
  async questionDistribution(filter: AnalyticsFilter, allowed: number[] | null): Promise<{ sectorId:number; formVersionId:number; questions:QuestionDistributionMetric[] } | null> {
    const scope = this.sectorScope(filter, allowed);
    const rows = await this.sql<{sectorId:number;formVersionId:number;questions:QuestionDistributionMetric[]}[]>`
      ${this.cohort(filter, scope)}, current_form as (
        select c.sector_id,c.form_version_id from sector_current_forms c
        join sectors s on s.id=c.sector_id and s.deleted_at is null
        where c.sector_id=${filter.sectorId!} and c.form_version_id is not null
          and (${scope === null} or c.sector_id=any(${scope ?? []}::int[]))
      ), current_questions as (
        select q.question_id,q.question_version_id,q.text,q.position
        from current_form c join submission_form_questions q on q.form_version_id=c.form_version_id
        where not q.is_nps
      ), counts as (
        select a.question_id,a.question_version_id,a.score,a.status,count(*)::int as n
        from answers a join current_questions q on q.question_id=a.question_id and q.question_version_id=a.question_version_id
        where a.sector_id=${filter.sectorId!} and not a.is_nps
        group by a.question_id,a.question_version_id,a.score,a.status
      )
      select c.sector_id as "sectorId",c.form_version_id as "formVersionId",
        coalesce((select jsonb_agg(jsonb_build_object(
          'questionId',q.question_id,'questionVersionId',q.question_version_id,'text',q.text,'position',q.position,
          'mean',(select sum(score*n)::float8/nullif(sum(n),0) from counts x where x.question_id=q.question_id and x.question_version_id=q.question_version_id and x.status='answered'),
          'responses',(select coalesce(sum(n),0)::int from counts x where x.question_id=q.question_id and x.question_version_id=q.question_version_id and x.status='answered'),
          'skipped',(select coalesce(sum(n),0)::int from counts x where x.question_id=q.question_id and x.question_version_id=q.question_version_id and x.status='skipped'),
          'distribution',(select jsonb_agg(jsonb_build_object('score',grade.score,'responses',coalesce(x.n,0)) order by grade.score)
            from generate_series(1,5) as grade(score)
            left join counts x on x.question_id=q.question_id and x.question_version_id=q.question_version_id
              and x.status='answered' and x.score=grade.score)
        ) order by q.position) from current_questions q),'[]'::jsonb) as questions
      from current_form c`;
    return rows[0] ?? null;
  }
  async criticalQuestions(filter: AnalyticsFilter, allowed: number[] | null, limit: 3 | 5, minimumResponses: number): Promise<CriticalQuestionMetric[]> {
    const scope = this.sectorScope(filter, allowed);
    return this.sql<CriticalQuestionMetric[]>`
      ${this.cohort(filter, scope)}, current_questions as (
        select c.sector_id,q.question_id,q.question_version_id,q.text
        from sector_current_forms c join sectors s on s.id=c.sector_id and s.deleted_at is null
        join submission_form_questions q on q.form_version_id=c.form_version_id and not q.is_nps
        where c.form_version_id is not null and (${scope === null} or c.sector_id=any(${scope ?? []}::int[]))
          and (${filter.sectorId ?? null}::int is null or c.sector_id=${filter.sectorId ?? null})
      )
      select q.sector_id as "sectorId",q.question_id as "questionId",q.question_version_id as "questionVersionId",
        q.text,avg(a.score)::float8 as mean,count(*)::int as responses
      from current_questions q join answers a on a.sector_id=q.sector_id and a.question_id=q.question_id
        and a.question_version_id=q.question_version_id and not a.is_nps and a.status='answered'
      group by q.sector_id,q.question_id,q.question_version_id,q.text
      having count(*)>=${minimumResponses}
      order by mean asc,responses desc,q.sector_id,q.question_id,q.question_version_id limit ${limit}`;
  }
  private sectorScope(filter: AnalyticsFilter, allowed: number[] | null) {
    if (!filter.sectorIds) return allowed;
    return allowed === null ? filter.sectorIds : filter.sectorIds.filter(id => allowed.includes(id));
  }
  private cohort(filter: AnalyticsFilter, scope: number[] | null) {
    return this.sql`
      with candidates as materialized (
        select id, sector_id, form_version_id, status, started_at, ended_at, expires_at, shift_range_id
        from submission_sessions s where started_at>=${filter.from}::text::timestamptz and started_at<${filter.to}::text::timestamptz
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
  async wallMetrics(filter: AnalyticsFilter, sectors: number[]) {
    const [row] = await this.sql<{
      completionRate: number | null; nps: number | null;
      npsGroups: { promoters: number; passives: number; detractors: number } | null;
    }[]>`
      ${this.cohort(filter, sectors)}, completion as (
        select count(*) as n, count(*) filter(where status='complete') as done from sessions
      ), groups as (
        select case when score>=9 then 'promoters' when score>=7 then 'passives' else 'detractors' end as category,
          count(*) as n, count(distinct session_id) as participants
        from answers where is_nps and status='answered' group by 1
      ), ratings as (
        select min(participants)>=10 as visible, sum(n) as total,
          coalesce(sum(n) filter(where category='promoters'),0) as promoters,
          coalesce(sum(n) filter(where category='passives'),0) as passives,
          coalesce(sum(n) filter(where category='detractors'),0) as detractors from groups
      ) select case when n>=10 and (done=0 or done>=10) and (n=done or n-done>=10)
          then round(100.0*done/n)::float8 end as "completionRate",
        case when visible then round(100.0*(promoters-detractors)/total)::float8 end as nps,
        case when visible then jsonb_build_object('promoters',round(100.0*promoters/total),
          'passives',round(100.0*passives/total),'detractors',round(100.0*detractors/total)) end as "npsGroups"
        from completion cross join ratings`;
    return row!;
  }
  async globalQuestions(filter: AnalyticsFilter, allowed: number[] | null, questionId?: number) {
    const scope = this.sectorScope(filter, allowed);
    const rows = await this.sql<GlobalQuestionMetric[]>`
      ${this.cohort(filter, scope)}, published as (
        select c.sector_id, q.question_id, q.question_version_id, q.is_nps, q.text
        from sector_current_forms c join sectors s on s.id=c.sector_id and s.deleted_at is null
        join submission_form_questions q on q.form_version_id=c.form_version_id
        join questions catalog on catalog.id=q.question_id and catalog.scope='all_sectors'
        where (${scope === null} or c.sector_id=any(${scope ?? []}::int[]))
          and (${filter.sectorId ?? null}::int is null or c.sector_id=${filter.sectorId ?? null})
          and (${questionId ?? null}::int is null or q.question_id=${questionId ?? null})
      ), bins as (
        select a.question_id, a.question_version_id, a.is_nps, a.sector_id, a.score, count(*) as n
        from answers a join questions catalog on catalog.id=a.question_id and catalog.scope='all_sectors'
        where a.status='answered' and (${questionId ?? null}::int is null or a.question_id=${questionId ?? null})
        group by grouping sets (
          (a.question_id,a.question_version_id,a.is_nps,a.sector_id,a.score),
          (a.question_id,a.question_version_id,a.is_nps,a.score))
      ), fractions as (
        select *, 100.0*n/sum(n) over (partition by question_id,question_version_id,is_nps,sector_id) as percentage from bins
      ), results as (
        select question_id,question_version_id,is_nps,sector_id,sum(n) as responses,sum(score*n)/sum(n) as mean,
          jsonb_agg(jsonb_build_object('score',score,'responses',n,'percentage',percentage) order by score) as distribution
        from fractions group by question_id,question_version_id,is_nps,sector_id
      ), availability as (
        select question_id,question_version_id,is_nps,max(text) as text,array_agg(sector_id order by sector_id) as sectors
        from published group by question_id,question_version_id,is_nps
      ), comparisons as (
        select question_id,question_version_id,is_nps,jsonb_agg(jsonb_build_object(
          'sectorId',sector_id,'responses',responses,'mean',mean,'distribution',distribution) order by sector_id) as sectors
        from results where sector_id is not null group by question_id,question_version_id,is_nps
      ), totals as (select * from results where sector_id is null)
      select v.question_id as "questionId",v.id as "questionVersionId",is_nps as "isNps",
        coalesce(p.text,v.text) as text,coalesce(p.sectors,'{}'::int[]) as "publishedSectorIds",
        coalesce(t.responses,0)::int as responses,t.mean::float8 as mean,coalesce(t.distribution,'[]'::jsonb) as distribution,
        coalesce(c.sectors,'[]'::jsonb) as sectors
      from availability p full join totals t using(question_id,question_version_id,is_nps)
      left join comparisons c using(question_id,question_version_id,is_nps)
      join question_versions v on v.id=coalesce(p.question_version_id,t.question_version_id)
      order by 1,2,3`;
    return rows;
  }
  async dashboard(filter: AnalyticsFilter, allowed: number[] | null): Promise<Dashboard> {
    const scope = this.sectorScope(filter, allowed);
    const [row] = await this.sql<{ data: Dashboard }[]>`
      ${this.cohort(filter, scope)}, tickets as (
        select sector_id,ticket_type,status from ombudsman_tickets t
        where ${allowed === null} and occurred_at>=${filter.from}::timestamptz and occurred_at<${filter.to}::timestamptz
          and (${filter.sectorId ?? null}::int is null or t.sector_id=${filter.sectorId ?? null})
          and (${filter.shiftRangeId ?? null}::int is null or t.shift_range_id=${filter.shiftRangeId ?? null})
          and (${scope === null} or t.sector_id=any(${scope ?? []}::int[]))
      ), shift_counts as (
        select shift_range_id, count(*) as completed from sessions where status='complete' group by shift_range_id
      ), shift_rows as (
        select r.id, r.shift_name as name, r.sector_id, coalesce(c.completed,0) as completed
        from sector_shift_ranges r join shift_sheet_versions v on v.id=r.shift_sheet_version_id
        left join shift_counts c on c.shift_range_id=r.id
        where (v.is_current or c.completed is not null)
          and (${scope === null} or r.sector_id=any(${scope ?? []}::int[]))
          and (${filter.sectorId ?? null}::int is null or r.sector_id=${filter.sectorId ?? null})
          and (${filter.shiftRangeId ?? null}::int is null or r.id=${filter.shiftRangeId ?? null})
      ) select jsonb_build_object(
        'shifts',coalesce((select jsonb_agg(x order by id) from (
          select *,100.0*completed/nullif(sum(completed) over (),0) as percentage from shift_rows) x),'[]'::jsonb),
        'unclassifiedCompleted',coalesce((select completed from shift_counts where shift_range_id is null),0),
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
