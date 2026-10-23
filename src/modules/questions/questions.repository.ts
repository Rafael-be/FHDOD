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

  async listSector(sectorId: number, includeDeleted: boolean): Promise<QuestionRow[]> {
    const deleted = includeDeleted ? this.sql`` : this.sql`and q.deleted_at is null`;
    return this.sql<QuestionRow[]>`
      select q.id,q.question_kind as "questionKind",q.scope,q.sector_id as "sectorId",q.is_nps as "isNps",
        q.display_order as "displayOrder",q.deleted_at as "deletedAt",v.version_number as "versionNumber",v.text
      from questions q join question_versions v on v.question_id=q.id and v.is_current=true
      where q.question_kind='sector' and q.sector_id=${sectorId} ${deleted}
      order by q.display_order,q.id`;
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

  async updateText(id: number, text: string, actorId: number): Promise<QuestionRow | null> {
    const locked = await this.sql<{ questionId: number }[]>`select question_id as "questionId" from question_versions where question_id=${id} for update`;
    if (locked.length === 0) return null;
    const current = await this.sql<{ next: number }[]>`select coalesce(max(version_number),0) + 1 as next from question_versions where question_id=${id}`;
    await this.sql`update question_versions set is_current=false where question_id=${id} and is_current=true`;
    await this.sql`insert into question_versions(question_id,version_number,text,is_current,created_by_user_id)
      values(${id},${current[0]!.next},${text},true,${actorId})`;
    return this.findSectorQuestion(id);
  }

  async setDeleted(id: number, deleted: boolean): Promise<boolean> {
    const rows = await this.sql<{ id: number }[]>`update questions set deleted_at=${deleted ? this.sql`now()` : null},updated_at=now() where id=${id} and deleted_at is ${deleted ? this.sql`null` : this.sql`not null`} returning id`;
    return rows.length === 1;
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
