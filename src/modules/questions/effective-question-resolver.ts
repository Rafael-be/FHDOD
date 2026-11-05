import type postgres from "postgres";
import type { QuestionRow } from "./questions.repository.js";

export type EffectiveQuestion = QuestionRow & { versionId: number };

export async function listEffectiveQuestions(
  sql: postgres.Sql,
  sectorId: number,
  includeDeleted: boolean,
): Promise<EffectiveQuestion[]> {
  const deleted = includeDeleted ? sql`` : sql`and q.deleted_at is null`;
  return sql<EffectiveQuestion[]>`
    with active_specific_nps as (
      select n.question_id
      from sector_nps_assignments n
      where n.sector_id=${sectorId} and n.ended_at is null
    ), active_sector_override as (
      select exists(
        select 1 from sector_nps_assignments n
        where n.sector_id=${sectorId} and n.ended_at is null
      ) as present
    )
    select q.id,q.question_kind as "questionKind",q.scope,q.sector_id as "sectorId",q.is_nps as "isNps",
      case when q.is_nps then 2147483647 else coalesce(a.display_order,q.display_order) end as "displayOrder",
      q.deleted_at as "deletedAt",v.id as "versionId",v.version_number as "versionNumber",v.text,
      case when q.is_nps and specific.question_id is not null then 'specific'
           when q.is_nps and q.scope='all_sectors' then 'global' end as "npsSource"
    from questions q
    join question_versions v on v.question_id=q.id and v.is_current=true
    left join question_sector_assignments a
      on a.question_id=q.id and a.sector_id=${sectorId} and a.ended_at is null
    left join active_specific_nps specific on specific.question_id=q.id
    cross join active_sector_override sector_override
    where (
      (q.question_kind='sector' and q.sector_id=${sectorId})
      or (q.question_kind='standard' and q.is_nps=false and a.id is not null)
      or (
        q.is_nps=true
        and (
          specific.question_id is not null
          or (q.scope='all_sectors' and q.deleted_at is null and not sector_override.present)
        )
      )
    ) ${deleted}
    order by q.is_nps, case when q.question_kind='sector' then 0 else 1 end, "displayOrder", q.id`;
}
