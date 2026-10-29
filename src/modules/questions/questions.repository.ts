import type postgres from "postgres";

export interface QuestionRow {
  id: number;
  questionKind: "sector" | "standard";
  scope: "sector_only" | "all_sectors" | "selected_sectors";
  sectorId: number | null;
  isNps: boolean;
  displayOrder: number;
  deletedAt: Date | null;
  versionNumber: number;
  text: string;
  npsSource?: "global" | "specific";
}

export interface CatalogQuestion extends QuestionRow {
  associations: Array<{ sectorId: number; source: "global" | "selected" | "specific"; active: boolean }>;
  total: number;
}

export class QuestionsRepository {
  constructor(private readonly sql: postgres.Sql) {}

  async transaction<T>(work: (repository: QuestionsRepository) => Promise<T>): Promise<T> {
    return this.sql.begin(async (tx) => work(new QuestionsRepository(tx as unknown as postgres.Sql))) as Promise<T>;
  }

  async sectorAccess(userId: number, sectorId: number): Promise<boolean> {
    const rows = await this.sql<{ allowed: boolean }[]>`
      select exists(
        select 1 from sectors s
        join user_sector_assignments a on a.sector_id = s.id
        join users u on u.id = a.user_id
        where s.id = ${sectorId} and s.deleted_at is null
          and a.user_id = ${userId} and a.unassigned_at is null and u.deleted_at is null
      ) as allowed`;
    return rows[0]?.allowed ?? false;
  }

  /** Verifies that a target sector exists and is currently usable by Phase 2. */
  async activeSector(sectorId: number): Promise<boolean> {
    const rows = await this.sql<{ active: boolean }[]>`select exists(select 1 from sectors where id=${sectorId} and deleted_at is null) as active`;
    return rows[0]?.active ?? false;
  }

  /** Avoids partial inserts when a selected scope references removed or unknown sectors. */
  async activeSectorCount(sectorIds: number[]): Promise<number> {
    if (sectorIds.length === 0) return 0;
    const rows = await this.sql<{ count: number }[]>`select count(*)::int as count from sectors where id = any(${sectorIds}) and deleted_at is null`;
    return rows[0]?.count ?? 0;
  }

  async listSector(sectorId: number, includeDeleted: boolean): Promise<QuestionRow[]> {
    const deleted = includeDeleted ? this.sql`` : this.sql`and q.deleted_at is null`;
    return this.sql<QuestionRow[]>`
      select q.id,q.question_kind as "questionKind",q.scope,q.sector_id as "sectorId",q.is_nps as "isNps",
        q.display_order as "displayOrder",q.deleted_at as "deletedAt",v.version_number as "versionNumber",v.text
      from questions q join question_versions v on v.question_id=q.id and v.is_current=true
      where q.question_kind='sector' and q.sector_id=${sectorId} ${deleted}
      order by q.display_order,q.id`;
  }

  async listEffective(sectorId: number, includeDeleted: boolean): Promise<QuestionRow[]> {
    const deleted = includeDeleted ? this.sql`` : this.sql`and q.deleted_at is null`;
    return this.sql<QuestionRow[]>`
      select q.id,q.question_kind as "questionKind",q.scope,q.sector_id as "sectorId",q.is_nps as "isNps",
        case when q.is_nps then 2147483647 else coalesce(a.display_order,q.display_order) end as "displayOrder",
        q.deleted_at as "deletedAt",v.version_number as "versionNumber",v.text,
        case when q.is_nps and override.id is not null then 'specific'
             when q.is_nps and global_nps.id is not null then 'global' end as "npsSource"
      from questions q join question_versions v on v.question_id=q.id and v.is_current=true
      left join question_sector_assignments a on a.question_id=q.id and a.sector_id=${sectorId} and a.ended_at is null
      left join sector_nps_assignments override on override.question_id=q.id and override.sector_id=${sectorId} and override.ended_at is null
      left join sector_nps_assignments sector_override on sector_override.sector_id=${sectorId} and sector_override.ended_at is null
      left join questions global_nps on global_nps.is_nps=true and global_nps.scope='all_sectors' and global_nps.deleted_at is null
      where ((q.question_kind='sector' and q.sector_id=${sectorId})
        or (q.question_kind='standard' and q.is_nps=false and a.id is not null)
        or (q.is_nps=true and (override.id is not null or (global_nps.id=q.id and sector_override.id is null)))) ${deleted}
      order by q.is_nps, case when q.question_kind='sector' then 0 else 1 end, "displayOrder", q.id`;
  }

  /** Administrative catalogue: current version and active associations in one paginated query. */
  async listCatalog(input: { type?: "standard" | "nps"; state?: "active" | "inactive"; scope?: "all_sectors" | "selected_sectors"; sectorId?: number; limit: number; offset: number }): Promise<CatalogQuestion[]> {
    const type = input.type === "nps" ? this.sql`and q.is_nps=true` : input.type === "standard" ? this.sql`and q.is_nps=false and q.question_kind='standard'` : this.sql`and q.question_kind='standard'`;
    const state = input.state === "active" ? this.sql`and q.deleted_at is null` : input.state === "inactive" ? this.sql`and q.deleted_at is not null` : this.sql``;
    const scope = input.scope ? this.sql`and q.scope=${input.scope}` : this.sql``;
    const sector = input.sectorId === undefined ? this.sql`` : this.sql`and (
      (q.is_nps=true and (q.scope='all_sectors' or exists(select 1 from sector_nps_assignments n where n.question_id=q.id and n.sector_id=${input.sectorId} and n.ended_at is null)))
      or (q.is_nps=false and exists(select 1 from question_sector_assignments a where a.question_id=q.id and a.sector_id=${input.sectorId} and a.ended_at is null))
    )`;
    return this.sql<CatalogQuestion[]>`
      select q.id,q.question_kind as "questionKind",q.scope,q.sector_id as "sectorId",q.is_nps as "isNps",q.display_order as "displayOrder",q.deleted_at as "deletedAt",v.version_number as "versionNumber",v.text,
        coalesce(assoc.items,'[]'::jsonb) as associations, count(*) over()::int as total
      from questions q join question_versions v on v.question_id=q.id and v.is_current=true
      left join lateral (
        select jsonb_agg(jsonb_build_object('sectorId',x.sector_id,'source',x.assignment_source,'active',x.ended_at is null) order by x.sector_id,x.assigned_at desc) as items
        from (
          select sector_id,assignment_source::text as assignment_source,assigned_at,ended_at from question_sector_assignments where question_id=q.id and ended_at is null
          union all
          select sector_id,assignment_source::text as assignment_source,assigned_at,ended_at from sector_nps_assignments where question_id=q.id and ended_at is null
        ) x
      ) assoc on true
      where true ${type} ${state} ${scope} ${sector}
      order by q.is_nps,q.deleted_at nulls first,q.created_at desc,q.id desc
      limit ${input.limit} offset ${input.offset}`;
  }

  async catalogQuestion(id: number): Promise<CatalogQuestion | null> {
    const direct = await this.sql<CatalogQuestion[]>`
      select q.id,q.question_kind as "questionKind",q.scope,q.sector_id as "sectorId",q.is_nps as "isNps",q.display_order as "displayOrder",q.deleted_at as "deletedAt",v.version_number as "versionNumber",v.text,
        coalesce(assoc.items,'[]'::jsonb) as associations, 1::int as total
      from questions q join question_versions v on v.question_id=q.id and v.is_current=true
      left join lateral (select jsonb_agg(jsonb_build_object('sectorId',x.sector_id,'source',x.assignment_source,'active',x.ended_at is null) order by x.sector_id,x.assigned_at desc) as items from (
        select sector_id,assignment_source::text as assignment_source,assigned_at,ended_at from question_sector_assignments where question_id=q.id and ended_at is null
        union all select sector_id,assignment_source::text as assignment_source,assigned_at,ended_at from sector_nps_assignments where question_id=q.id and ended_at is null
      ) x) assoc on true
      where q.id=${id} and q.question_kind='standard'`;
    return direct[0] ?? null;
  }

  async createStandard(text: string, scope: "all_sectors" | "selected_sectors", sectorIds: number[], order: number, actorId: number): Promise<QuestionRow> {
    const rows = await this.sql<QuestionRow[]>`
      insert into questions(question_kind,scope,sector_id,is_nps,display_order,created_by_user_id)
      values ('standard',${scope},null,false,${order},${actorId})
      returning id,question_kind as "questionKind",scope,sector_id as "sectorId",is_nps as "isNps",display_order as "displayOrder",deleted_at as "deletedAt",1 as "versionNumber",${text}::text as text`;
    const question = rows[0]!;
    await this.sql`insert into question_versions(question_id,version_number,text,is_current,created_by_user_id) values(${question.id},1,${text},true,${actorId})`;
    const targets = scope === "all_sectors"
      ? await this.sql<{ id: number }[]>`select id from sectors where deleted_at is null`
      : await this.sql<{ id: number }[]>`select id from sectors where id = any(${sectorIds}) and deleted_at is null`;
    if (targets.length !== (scope === "all_sectors" ? targets.length : new Set(sectorIds).size)) throw new Error("Invalid standard question sector scope");
    for (const target of targets) {
      await this.sql`insert into question_sector_assignments(question_id,sector_id,assignment_source,display_order,assigned_by_user_id) values(${question.id},${target.id},${scope === "all_sectors" ? "global" : "selected"},${order},${actorId})`;
    }
    return question;
  }

  async createNps(text: string, scope: "all_sectors" | "selected_sectors", sectorIds: number[], actorId: number): Promise<QuestionRow> {
    const rows = await this.sql<QuestionRow[]>`
      insert into questions(question_kind,scope,sector_id,is_nps,display_order,created_by_user_id)
      values ('standard',${scope},null,true,2147483647,${actorId})
      returning id,question_kind as "questionKind",scope,sector_id as "sectorId",is_nps as "isNps",display_order as "displayOrder",deleted_at as "deletedAt",1 as "versionNumber",${text}::text as text`;
    const question = rows[0]!;
    await this.sql`insert into question_versions(question_id,version_number,text,is_current,created_by_user_id) values(${question.id},1,${text},true,${actorId})`;
    // Global NPS is deliberately not materialized. Only selected-sector NPS creates overrides.
    const targets = scope === "selected_sectors"
      ? await this.sql<{ id: number }[]>`select id from sectors where id = any(${sectorIds}) and deleted_at is null`
      : [];
    if (scope === "selected_sectors" && targets.length !== new Set(sectorIds).size) throw new Error("Invalid NPS sector scope");
    for (const target of targets) {
      await this.sql`insert into sector_nps_assignments(sector_id,question_id,assignment_source,assigned_by_user_id) values(${target.id},${question.id},'specific',${actorId})`;
    }
    return question;
  }

  /** Serializes replacement of the singleton global NPS inside the caller's transaction. */
  async replaceActiveGlobalNps(): Promise<number | null> {
    await this.sql`select pg_advisory_xact_lock(912002)`;
    const rows = await this.sql<{ id: number }[]>`
      update questions set deleted_at=now(),updated_at=now()
      where is_nps=true and scope='all_sectors' and deleted_at is null
      returning id`;
    return rows[0]?.id ?? null;
  }

  async assignNps(sectorId: number, questionId: number, actorId: number, replace: boolean): Promise<void> {
    if (replace) await this.sql`update sector_nps_assignments set ended_at=now() where sector_id=${sectorId} and ended_at is null`;
    await this.sql`insert into sector_nps_assignments(sector_id,question_id,assignment_source,assigned_by_user_id) values(${sectorId},${questionId},'specific',${actorId})`;
  }

  async removeNpsOverride(sectorId: number): Promise<boolean> {
    const rows = await this.sql<{ id: number }[]>`
      update sector_nps_assignments set ended_at=now()
      where sector_id=${sectorId} and ended_at is null
      returning id`;
    return rows.length === 1;
  }

  async activeNps(questionId: number): Promise<boolean> {
    const rows = await this.sql<{ valid: boolean }[]>`select exists(select 1 from questions where id=${questionId} and is_nps=true and scope='selected_sectors' and deleted_at is null) as valid`;
    return rows[0]?.valid ?? false;
  }

  async sectorHasNps(sectorId: number): Promise<boolean> {
    const rows = await this.sql<{ present: boolean }[]>`select exists(select 1 from sector_nps_assignments where sector_id=${sectorId} and ended_at is null) as present`;
    return rows[0]?.present ?? false;
  }

  async reorderSectorQuestions(sectorId: number, ids: number[]): Promise<void> {
    const rows = await this.sql<{ id: number }[]>`
      select id from questions where question_kind='sector' and sector_id=${sectorId} and deleted_at is null for update`;
    const expected = rows.map((row) => row.id).sort((a, b) => a - b);
    const received = [...ids].sort((a, b) => a - b);
    if (expected.length !== received.length || expected.some((id, index) => id !== received[index])) throw new Error("Question reorder must contain every active sector question");
    for (const [index, id] of ids.entries()) await this.sql`update questions set display_order=${1000000000 + index} where id=${id}`;
    for (const [index, id] of ids.entries()) await this.sql`update questions set display_order=${index + 1},updated_at=now() where id=${id}`;
  }

  async reorderStandardQuestions(sectorId: number, ids: number[]): Promise<void> {
    const rows = await this.sql<{ id: number }[]>`
      select a.question_id as id from question_sector_assignments a join questions q on q.id=a.question_id
      where a.sector_id=${sectorId} and a.ended_at is null and q.deleted_at is null and q.is_nps=false for update`;
    const expected = rows.map((row) => row.id).sort((a, b) => a - b);
    const received = [...ids].sort((a, b) => a - b);
    if (expected.length !== received.length || expected.some((id, index) => id !== received[index])) throw new Error("Question reorder must contain every active standard question");
    for (const [index, id] of ids.entries()) await this.sql`update question_sector_assignments set display_order=${1000000000 + index} where sector_id=${sectorId} and question_id=${id} and ended_at is null`;
    for (const [index, id] of ids.entries()) await this.sql`update question_sector_assignments set display_order=${index + 1} where sector_id=${sectorId} and question_id=${id} and ended_at is null`;
  }

  async createSector(sectorId: number, text: string, order: number, actorId: number): Promise<QuestionRow> {
    const rows = await this.sql<QuestionRow[]>`
      insert into questions(question_kind,scope,sector_id,is_nps,display_order,created_by_user_id)
      values ('sector','sector_only',${sectorId},false,${order},${actorId})
      returning id,question_kind as "questionKind",scope,sector_id as "sectorId",is_nps as "isNps",display_order as "displayOrder",deleted_at as "deletedAt",
        1 as "versionNumber",${text}::text as text`;
    const question = rows[0]!;
    await this.sql`insert into question_versions(question_id,version_number,text,is_current,created_by_user_id) values(${question.id},1,${text},true,${actorId})`;
    return question;
  }

  async findSectorQuestion(id: number): Promise<QuestionRow | null> {
    const rows = await this.sql<QuestionRow[]>`
      select q.id,q.question_kind as "questionKind",q.scope,q.sector_id as "sectorId",q.is_nps as "isNps",q.display_order as "displayOrder",
        q.deleted_at as "deletedAt",v.version_number as "versionNumber",v.text
      from questions q join question_versions v on v.question_id=q.id and v.is_current=true
      where q.id=${id} and q.question_kind='sector'`;
    return rows[0] ?? null;
  }

  async findQuestion(id: number): Promise<QuestionRow | null> {
    const rows = await this.sql<QuestionRow[]>`
      select q.id,q.question_kind as "questionKind",q.scope,q.sector_id as "sectorId",q.is_nps as "isNps",q.display_order as "displayOrder",
        q.deleted_at as "deletedAt",v.version_number as "versionNumber",v.text
      from questions q join question_versions v on v.question_id=q.id and v.is_current=true where q.id=${id}`;
    return rows[0] ?? null;
  }

  async updateText(id: number, text: string, actorId: number): Promise<QuestionRow | null> {
    const locked = await this.sql<{ questionId: number }[]>`select question_id as "questionId" from question_versions where question_id=${id} for update`;
    if (locked.length === 0) return null;
    const current = await this.sql<{ next: number }[]>`select coalesce(max(version_number),0) + 1 as next from question_versions where question_id=${id}`;
    await this.sql`update question_versions set is_current=false where question_id=${id} and is_current=true`;
    await this.sql`insert into question_versions(question_id,version_number,text,is_current,created_by_user_id)
      values(${id},${current[0]!.next},${text},true,${actorId})`;
    return this.findQuestion(id);
  }

  async setDeleted(id: number, deleted: boolean): Promise<boolean> {
    const rows = await this.sql<{ id: number }[]>`update questions set deleted_at=${deleted ? this.sql`now()` : null},updated_at=now() where id=${id} and deleted_at is ${deleted ? this.sql`null` : this.sql`not null`} returning id`;
    return rows.length === 1;
  }

  async endAssignments(questionId: number, isNps: boolean): Promise<void> {
    if (isNps) await this.sql`update sector_nps_assignments set ended_at=now() where question_id=${questionId} and ended_at is null`;
    else await this.sql`update question_sector_assignments set ended_at=now() where question_id=${questionId} and ended_at is null`;
  }

  async reactivateScoped(question: QuestionRow): Promise<void> {
    if (question.isNps) {
      if (question.scope === "all_sectors") {
        await this.sql`update questions set deleted_at=null,updated_at=now() where id=${question.id} and deleted_at is not null`;
        return;
      }
      const targets = await this.sql<{ sectorId: number }[]>`select distinct sector_id as "sectorId" from sector_nps_assignments where question_id=${question.id}`;
      for (const target of targets) {
        const conflict = await this.sql<{ present: boolean }[]>`select exists(select 1 from sector_nps_assignments where sector_id=${target.sectorId} and ended_at is null and question_id<>${question.id}) as present`;
        if (conflict[0]?.present) throw new Error("NPS reactivation conflict");
      }
      await this.sql`update questions set deleted_at=null,updated_at=now() where id=${question.id} and deleted_at is not null`;
      for (const target of targets) await this.sql`insert into sector_nps_assignments(sector_id,question_id,assignment_source,assigned_by_user_id) values(${target.sectorId},${question.id},'specific',null)`;
      return;
    }
    const targets = question.scope === "all_sectors"
      ? await this.sql<{ sectorId: number; displayOrder: number }[]>`select s.id as "sectorId",coalesce((select a.display_order from question_sector_assignments a where a.question_id=${question.id} and a.sector_id=s.id order by a.assigned_at desc limit 1),(select coalesce(max(x.display_order),0)+1 from question_sector_assignments x where x.sector_id=s.id and x.ended_at is null)) as "displayOrder" from sectors s where s.deleted_at is null`
      : await this.sql<{ sectorId: number; displayOrder: number }[]>`select distinct on (sector_id) sector_id as "sectorId",display_order as "displayOrder" from question_sector_assignments where question_id=${question.id} order by sector_id,assigned_at desc`;
    for (const target of targets) {
      const conflict = await this.sql<{ present: boolean }[]>`select exists(select 1 from question_sector_assignments where sector_id=${target.sectorId} and display_order=${target.displayOrder} and ended_at is null and question_id<>${question.id}) as present`;
      if (conflict[0]?.present) throw new Error("standard question reactivation conflict");
    }
    await this.sql`update questions set deleted_at=null,updated_at=now() where id=${question.id} and deleted_at is not null`;
    for (const target of targets) await this.sql`insert into question_sector_assignments(question_id,sector_id,assignment_source,display_order,assigned_by_user_id) values(${question.id},${target.sectorId},${question.scope === "all_sectors" ? "global" : "selected"},${target.displayOrder},null)`;
  }

  async inheritForSectorOn(sql: postgres.Sql, sectorId: number, actorId: number): Promise<void> {
    const standards = await sql<{ id: number; displayOrder: number }[]>`
      select id,display_order as "displayOrder" from questions
      where question_kind='standard' and is_nps=false and scope='all_sectors' and deleted_at is null`;
    for (const question of standards) {
      await sql`insert into question_sector_assignments(question_id,sector_id,assignment_source,display_order,assigned_by_user_id)
        values(${question.id},${sectorId},'global',${question.displayOrder},${actorId})`;
    }
    // NPS global is resolved dynamically in listEffective; new sectors need no NPS row.
  }

  async hasActiveOrderConflict(question: QuestionRow): Promise<boolean> {
    if (question.sectorId === null) return false;
    const rows = await this.sql<{ exists: boolean }[]>`
      select exists(select 1 from questions where question_kind='sector' and sector_id=${question.sectorId}
        and display_order=${question.displayOrder} and deleted_at is null and id <> ${question.id}) as exists`;
    return rows[0]?.exists ?? false;
  }

  async audit(actorId: number, action: string, id: number): Promise<void> {
    await this.sql`insert into audit_logs(actor_user_id,action,entity_type,entity_id,created_at) values(${actorId},${action},'question',${id},now())`;
  }
}
