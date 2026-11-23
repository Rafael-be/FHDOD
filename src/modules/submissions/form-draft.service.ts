import type { QuestionsCache } from "../../cache/cache.service.js";
import type postgres from "postgres";
import { createHash } from "node:crypto";
import { DomainError } from "../../shared/core.js";
import type { AuthIdentity } from "../auth/auth.service.js";
import { listEffectiveQuestions } from "../questions/effective-question-resolver.js";
import { AdminRepository } from "../admin/admin.repository.js";
import { sectorStatus } from "../admin/admin.service.js";
import { publishedFormCache, type PublishedQuestion } from "./form-cache.js";

export interface DraftItem {
  questionId: number | null;
  sourceQuestionVersionId: number | null;
  questionKind: "sector" | "standard";
  isNps: boolean;
  text: string;
  position: number;
  canEditContent?: boolean;
  editRestrictionReason?: "shared_question" | "global_question" | "other_sector" | "nps_admin_only";
}
type DraftRow = { id: number; revision: number; baseFormVersionId: number | null };
type QuestionContext = { questionKind: "sector" | "standard"; sectorId: number | null; scope: string; isNps: boolean; sourceText: string; sourceCurrent: boolean; activeHere: boolean; affectedSectorIds: number[] };

function normalized(items: DraftItem[]): DraftItem[] {
  return items.map((item, index) => ({ questionId: item.questionId, sourceQuestionVersionId: item.sourceQuestionVersionId,
    questionKind: item.questionKind, isNps: item.isNps, text: item.text.trim(), position: index + 1 }));
}
function same(a: DraftItem[], b: DraftItem[]): boolean { return JSON.stringify(normalized(a)) === JSON.stringify(normalized(b)); }

/** Candidate edits stay separate; publication appends snapshots without rewriting history. */
export class FormDraftService {
  constructor(private readonly sql: postgres.Sql, private readonly cache?: Pick<QuestionsCache, "invalidateQuestions">) {}

  private transaction<T>(work: (sql: postgres.Sql) => Promise<T>): Promise<T> {
    if (typeof this.sql.begin !== "function") return work(this.sql);
    return this.sql.begin((tx) => work(tx as unknown as postgres.Sql)) as Promise<T>;
  }

  private async authorize(sql: postgres.Sql, actor: AuthIdentity, sectorId: number): Promise<void> {
    const sector = await sql<{ id: number }[]>`select id from sectors where id=${sectorId} and deleted_at is null`;
    if (!sector.length) throw new DomainError("SECTOR_NOT_FOUND", "Setor inexistente ou inativo.", 404);
    if (actor.role === "superuser") return;
    const access = await sql<{ allowed: boolean }[]>`select exists(select 1 from user_sector_assignments a
      where a.user_id=${actor.userId} and a.sector_id=${sectorId} and a.unassigned_at is null) as allowed`;
    if (actor.role !== "sector_manager" || !access[0]?.allowed) throw new DomainError("FORBIDDEN", "Setor fora do seu escopo.", 403);
  }

  private async currentPublished(sql: postgres.Sql, sectorId: number): Promise<number | null> {
    const rows = await sql<{ id: number }[]>`select form_version_id as id from sector_current_forms where sector_id=${sectorId}`;
    return rows[0]?.id ?? null;
  }

  private async baseItems(sql: postgres.Sql, sectorId: number, versionId: number | null): Promise<DraftItem[]> {
    if (versionId !== null) return sql<DraftItem[]>`select question_id as "questionId",question_version_id as "sourceQuestionVersionId",
      question_kind as "questionKind",is_nps as "isNps",text,position
      from submission_form_questions where form_version_id=${versionId} order by position`;
    const effective = await listEffectiveQuestions(sql, sectorId, false);
    return effective.map((q, index) => ({ questionId: q.id, sourceQuestionVersionId: q.versionId,
      questionKind: q.questionKind, isNps: q.isNps, text: q.text, position: index + 1 }));
  }

  private async draft(sql: postgres.Sql, sectorId: number): Promise<DraftRow | null> {
    const rows = await sql<DraftRow[]>`select id,revision,base_form_version_id as "baseFormVersionId" from submission_form_drafts where sector_id=${sectorId}`;
    return rows[0] ?? null;
  }

  private async draftItems(sql: postgres.Sql, draftId: number): Promise<DraftItem[]> {
    return sql<DraftItem[]>`select question_id as "questionId",source_question_version_id as "sourceQuestionVersionId",
      question_kind as "questionKind",is_nps as "isNps",text,position
      from submission_form_draft_questions where draft_id=${draftId} order by position`;
  }

  private async context(sql: postgres.Sql, item: DraftItem, sectorId: number): Promise<QuestionContext> {
    const rows = await sql<QuestionContext[]>`
      select q.question_kind as "questionKind",q.sector_id as "sectorId",q.scope,q.is_nps as "isNps",v.text as "sourceText",v.is_current as "sourceCurrent",
        (q.question_kind='sector' and q.sector_id=${sectorId})
        or (q.question_kind='standard' and q.is_nps=false and exists(select 1 from question_sector_assignments a where a.question_id=q.id and a.sector_id=${sectorId} and a.ended_at is null))
        or (q.is_nps and (exists(select 1 from sector_nps_assignments n where n.question_id=q.id and n.sector_id=${sectorId} and n.ended_at is null)
          or (q.scope='all_sectors' and not exists(select 1 from sector_nps_assignments n where n.sector_id=${sectorId} and n.ended_at is null)))) as "activeHere",
        case when q.question_kind='sector' then array[q.sector_id]
             when q.scope='all_sectors' then array(select id from sectors where deleted_at is null)
             when q.is_nps then array(select sector_id from sector_nps_assignments where question_id=q.id and ended_at is null)
             else array(select sector_id from question_sector_assignments where question_id=q.id and ended_at is null) end as "affectedSectorIds"
      from questions q join question_versions v on v.question_id=q.id
      where q.id=${item.questionId} and v.id=${item.sourceQuestionVersionId} and q.deleted_at is null`;
    if (!rows[0] || !rows[0].activeHere) throw new DomainError("DRAFT_QUESTION_SCOPE", "Pergunta não pertence à configuração ativa deste setor.", 403);
    if (rows[0].questionKind !== item.questionKind || rows[0].isNps !== item.isNps)
      throw new DomainError("INVALID_FORM_DRAFT", "Tipo ou NPS da pergunta não pode ser alterado no rascunho.", 400);
    return rows[0];
  }

  private async contentPermission(sql: postgres.Sql, actor: AuthIdentity, context: QuestionContext): Promise<{ canEditContent: boolean; editRestrictionReason?: DraftItem["editRestrictionReason"] }> {
    if (actor.role === "superuser") return { canEditContent: true };
    if (context.isNps) return { canEditContent: false, editRestrictionReason: "nps_admin_only" };
    if (context.scope === "all_sectors") return { canEditContent: false, editRestrictionReason: "global_question" };
    const rows = await sql<{ sectorId: number }[]>`select sector_id as "sectorId" from user_sector_assignments
      where user_id=${actor.userId} and unassigned_at is null`;
    const allowed = new Set(rows.map((row) => row.sectorId));
    if (context.affectedSectorIds.every((id) => allowed.has(id))) return { canEditContent: true };
    return { canEditContent: false, editRestrictionReason: context.affectedSectorIds.length > 1 ? "shared_question" : "other_sector" };
  }

  async get(actor: AuthIdentity, sectorId: number) {
    await this.authorize(this.sql, actor, sectorId);
    const draft = await this.draft(this.sql, sectorId);
    const publishedVersionId = await this.currentPublished(this.sql, sectorId);
    const operational = sectorStatus(await new AdminRepository(this.sql).readiness(sectorId));
    const items = draft ? await this.draftItems(this.sql, draft.id) : await this.baseItems(this.sql, sectorId, publishedVersionId);
    const decorated = await Promise.all(items.map(async (item) => {
      if (item.questionId === null) return { ...item, canEditContent: true };
      try {
        const context = await this.context(this.sql, item, sectorId);
        return { ...item, ...await this.contentPermission(this.sql, actor, context) };
      } catch (error) {
        if (error instanceof DomainError && error.code === "DRAFT_QUESTION_SCOPE")
          return { ...item, canEditContent: false, editRestrictionReason: "other_sector" as const };
        throw error;
      }
    }));
    return { sectorId, publishedVersionId, operationalStatus: operational.status, missingRequirements: operational.missingRequirements,
      draftStatus: draft ? "drafting" as const : publishedVersionId === null ? "unpublished" as const : "published" as const,
      revision: draft?.revision ?? 0, items: decorated };
  }

  async save(actor: AuthIdentity, sectorId: number, expectedRevision: number, supplied: DraftItem[]) {
    return this.transaction(async (sql) => {
      await this.authorize(sql, actor, sectorId);
      await sql`select pg_advisory_xact_lock(912011, ${sectorId})`;
      const draft = await this.draft(sql, sectorId);
      if ((draft?.revision ?? 0) !== expectedRevision) throw new DomainError("DRAFT_CONFLICT", "O rascunho mudou. Atualize o editor.", 409);
      const items = normalized(supplied);
      const existingIds = items.filter((item) => item.questionId !== null).map((item) => item.questionId);
      if (new Set(existingIds).size !== existingIds.length) throw new DomainError("INVALID_FORM_DRAFT", "Perguntas duplicadas.", 400);
      const baseVersionId = draft ? draft.baseFormVersionId : await this.currentPublished(sql, sectorId);
      const current = draft ? await this.draftItems(sql, draft.id) : await this.baseItems(sql, sectorId, baseVersionId);
      const protectedOriginal = new Map(current.filter((item) => item.questionId !== null).map((item) => [item.questionId, item]));
      for (const item of items) {
        if (item.questionId === null) {
          if (item.sourceQuestionVersionId !== null || item.questionKind !== "sector" || item.isNps)
            throw new DomainError("INVALID_FORM_DRAFT", "Nova pergunta de rascunho deve ser exclusiva do setor e não NPS.", 400);
          continue;
        }
        if (item.sourceQuestionVersionId === null) throw new DomainError("INVALID_FORM_DRAFT", "Informe a versão de origem.", 400);
        const context = await this.context(sql, item, sectorId);
        const permission = await this.contentPermission(sql, actor, context);
        const original = protectedOriginal.get(item.questionId);
        if (!permission.canEditContent && (item.text !== context.sourceText ||
          (original ? (item.text !== original.text || item.sourceQuestionVersionId !== original.sourceQuestionVersionId) : !context.sourceCurrent)))
          throw new DomainError("DRAFT_CONTENT_FORBIDDEN", "Sem permissão para alterar o conteúdo desta pergunta.", 403);
      }
      if (same(current, items)) return { revision: draft?.revision ?? 0, draftStatus: draft ? "drafting" : baseVersionId === null ? "unpublished" : "published" };
      const base = await this.baseItems(sql, sectorId, baseVersionId);
      if (same(base, items)) {
        if (draft) await sql`delete from submission_form_drafts where id=${draft.id}`;
        return { revision: 0, draftStatus: baseVersionId === null ? "unpublished" : "published" };
      }
      const revision = (draft?.revision ?? 0) + 1;
      const [saved] = draft ? await sql<{ id: number }[]>`update submission_form_drafts set revision=${revision},updated_by_user_id=${actor.userId},updated_at=now()
        where id=${draft.id} returning id` : await sql<{ id: number }[]>`insert into submission_form_drafts(sector_id,base_form_version_id,revision,updated_by_user_id)
        values (${sectorId},${baseVersionId},${revision},${actor.userId}) returning id`;
      await sql`delete from submission_form_draft_questions where draft_id=${saved!.id}`;
      for (const item of items) await sql`insert into submission_form_draft_questions(draft_id,question_id,source_question_version_id,position,question_kind,is_nps,text)
        values (${saved!.id},${item.questionId},${item.sourceQuestionVersionId},${item.position},${item.questionKind},${item.isNps},${item.text})`;
      return { revision, draftStatus: "drafting" };
    });
  }

  async discard(actor: AuthIdentity, sectorId: number, expectedRevision: number) {
    return this.transaction(async (sql) => {
      await this.authorize(sql, actor, sectorId);
      await sql`select pg_advisory_xact_lock(912011, ${sectorId})`;
      const draft = await this.draft(sql, sectorId);
      if ((draft?.revision ?? 0) !== expectedRevision) throw new DomainError("DRAFT_CONFLICT", "O rascunho mudou. Atualize o editor.", 409);
      if (draft) await sql`delete from submission_form_drafts where id=${draft.id}`;
      return { discarded: Boolean(draft) };
    });
  }

  async readiness(actor: AuthIdentity, sectorId: number) {
    const state = await this.get(actor, sectorId);
    const base = await new AdminRepository(this.sql).readiness(sectorId);
    const candidate = sectorStatus({ ...base, hasNps: state.items.filter((item) => item.isNps).length === 1 });
    const missingRequirements = [...candidate.missingRequirements];
    if (!state.items.some((item) => item.questionKind === "standard" && !item.isNps)) missingRequirements.push("standard_questions");
    return { operationalStatus: state.operationalStatus, draftStatus: state.draftStatus,
      status: missingRequirements.length ? "preparing" as const : "active" as const, missingRequirements,
      publishedVersionId: state.publishedVersionId };
  }

  async publish(actor: AuthIdentity, sectorId: number, expectedRevision: number) {
    const result = await this.transaction(async (sql) => {
      await this.authorize(sql, actor, sectorId);
      await sql`select pg_advisory_xact_lock(912010, ${sectorId})`;
      await sql`select pg_advisory_xact_lock(912011, ${sectorId})`;
      const draft = await this.draft(sql, sectorId);
      if (!draft || draft.revision !== expectedRevision) throw new DomainError("DRAFT_CONFLICT", "O rascunho mudou. Atualize o editor.", 409);
      const current = (await sql<{ formVersionId: number }[]>`select form_version_id as "formVersionId" from sector_current_forms where sector_id=${sectorId}`)[0];
      if ((current?.formVersionId ?? null) !== draft.baseFormVersionId)
        throw new DomainError("DRAFT_CONFLICT", "A publicação vigente mudou. Atualize o rascunho.", 409);
      const items = await this.draftItems(sql, draft.id);
      const operational = await new AdminRepository(sql).readiness(sectorId);
      const candidate = sectorStatus({ ...operational, hasNps: items.filter((item) => item.isNps).length === 1 });
      const missing = [...candidate.missingRequirements];
      if (!items.some((item) => item.questionKind === "standard" && !item.isNps)) missing.push("standard_questions");
      if (missing.length) throw new DomainError("FORM_NOT_READY", "O setor ainda não atende aos requisitos de publicação.", 409,
        { missingRequirements: missing });
      const ids = items.filter((item) => item.questionId !== null).map((item) => item.questionId!).sort((a, b) => a - b);
      for (const questionId of ids) await sql`select id from questions where id=${questionId} for update`;
      const resolved: PublishedQuestion[] = [];
      for (const item of items) {
        let questionId = item.questionId;
        let questionVersionId = item.sourceQuestionVersionId;
        if (questionId === null) {
          if (item.questionKind !== "sector" || item.isNps) throw new DomainError("INVALID_FORM_DRAFT", "Nova pergunta deve ser local e não NPS.", 400);
          const [question] = await sql<{ id: number }[]>`insert into questions(question_kind,scope,sector_id,is_nps,display_order,created_by_user_id)
            values ('sector','sector_only',${sectorId},false,
              (select coalesce(max(display_order),0)+1 from questions where sector_id=${sectorId} and question_kind='sector'),
              ${actor.userId}) returning id`;
          questionId = question!.id;
          const [version] = await sql<{ id: number }[]>`insert into question_versions(question_id,version_number,text,is_current,created_by_user_id)
            values (${questionId},1,${item.text},true,${actor.userId}) returning id`;
          questionVersionId = version!.id;
        } else {
          const context = await this.context(sql, item, sectorId);
          const permission = await this.contentPermission(sql, actor, context);
          if (item.text !== context.sourceText && !permission.canEditContent)
            throw new DomainError("DRAFT_CONTENT_FORBIDDEN", "Permissão de edição revogada.", 403);
          if (item.text !== context.sourceText) {
            const [next] = await sql<{ number: number }[]>`select coalesce(max(version_number),0)+1 as number from question_versions where question_id=${questionId}`;
            await sql`update question_versions set is_current=false where question_id=${questionId} and is_current=true`;
            const [version] = await sql<{ id: number }[]>`insert into question_versions(question_id,version_number,text,is_current,created_by_user_id)
              values (${questionId},${next!.number},${item.text},true,${actor.userId}) returning id`;
            questionVersionId = version!.id;
          }
        }
        resolved.push({ questionId: questionId!, questionVersionId: questionVersionId!, text: item.text,
          questionKind: item.questionKind, isNps: item.isNps, position: item.position });
      }
      const fingerprint = createHash("sha256").update(JSON.stringify(resolved)).digest("hex");
      const previous = current ? await publishedFormCache.get(sql, current.formVersionId) : [];
      if (JSON.stringify(previous) === JSON.stringify(resolved)) {
        await sql`delete from submission_form_drafts where id=${draft.id}`;
        return { published: false, formVersionId: current?.formVersionId ?? null, items: previous };
      }
      const [latest] = await sql<{ versionNumber: number }[]>`select version_number as "versionNumber" from submission_form_versions where sector_id=${sectorId} order by version_number desc limit 1`;
      const [created] = await sql<{ id: number; versionNumber: number }[]>`insert into submission_form_versions(sector_id,version_number,fingerprint,published_at)
        values (${sectorId},${(latest?.versionNumber ?? 0)+1},${fingerprint},now()) returning id,version_number as "versionNumber"`;
      for (const item of resolved) await sql`insert into submission_form_questions(form_version_id,question_id,question_version_id,position,question_kind,is_nps,text)
        values (${created!.id},${item.questionId},${item.questionVersionId},${item.position},${item.questionKind},${item.isNps},${item.text})`;
      await sql`insert into sector_current_forms(sector_id,form_version_id,revision) values (${sectorId},${created!.id},1)
        on conflict (sector_id) do update set form_version_id=excluded.form_version_id,revision=sector_current_forms.revision+1`;
      await sql`delete from submission_form_drafts where id=${draft.id}`;
      return { published: true, formVersionId: created!.id, versionNumber: created!.versionNumber, items: resolved };
    });
    try { if (result.formVersionId !== null) publishedFormCache.put(result.formVersionId, result.items); } catch { /* commit remains valid */ }
    if(result.published) { try { await this.cache?.invalidateQuestions(); } catch { /* committed database remains authoritative */ } }
    const response = { ...result };
    delete (response as { items?: PublishedQuestion[] }).items;
    return response;
  }

  async history(actor: AuthIdentity, sectorId: number) {
    await this.authorize(this.sql, actor, sectorId);
    const current = (await this.sql<{ id: number }[]>`select form_version_id as id from sector_current_forms where sector_id=${sectorId}`)[0]?.id;
    const versions = await this.sql<{ id: number; versionNumber: number; publishedAt: string; questionCount: number }[]>`
      select v.id,v.version_number as "versionNumber",v.published_at as "publishedAt",count(q.*)::int as "questionCount"
      from submission_form_versions v left join submission_form_questions q on q.form_version_id=v.id
      where v.sector_id=${sectorId} group by v.id order by v.version_number desc`;
    return versions.map((version) => ({ ...version, current: version.id === current }));
  }

  async version(actor: AuthIdentity, sectorId: number, versionId: number) {
    await this.authorize(this.sql, actor, sectorId);
    const rows = await this.sql`select id from submission_form_versions where id=${versionId} and sector_id=${sectorId}`;
    if (!rows.length) throw new DomainError("FORM_VERSION_NOT_FOUND", "Versão não encontrada.", 404);
    return { versionId, items: await publishedFormCache.get(this.sql, versionId) };
  }

  async restore(actor: AuthIdentity, sectorId: number, versionId: number, expectedRevision: number) {
    const source = await this.version(actor, sectorId, versionId);
    return this.save(actor, sectorId, expectedRevision, source.items.map((item) => ({ ...item, sourceQuestionVersionId: item.questionVersionId })));
  }
}
