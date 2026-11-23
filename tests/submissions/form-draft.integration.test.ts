import postgres from "postgres";
import type { AuthIdentity } from "../../src/modules/auth/auth.service.js";
import { FormDraftService } from "../../src/modules/submissions/form-draft.service.js";
import { assertDisposableTestDatabase, testDatabaseUrl, usesIsolatedDatabase } from "../helpers/database.js";

const url = testDatabaseUrl();
const runtimeUrl = process.env.DATABASE_URL;
const safe = usesIsolatedDatabase(url, runtimeUrl);
const integration = safe ? describe : describe.skip;
const identity = (userId: number, role: AuthIdentity["role"]): AuthIdentity => ({ userId, role, sessionId: "test", mustChangePassword: false });

integration("persistent form drafts on isolated PostgreSQL", () => {
  it("uses fhdod_api grants and RLS while enforcing manager scope", async () => {
    await assertDisposableTestDatabase(url!, runtimeUrl!);
    const sql = postgres(runtimeUrl!, { max: 2, prepare: false });
    try {
      const [identityRow] = await sql<{ role: string }[]>`select current_user as role`;
      expect(identityRow?.role).toBe("fhdod_api");
      const service = new FormDraftService(sql);
      const manager = identity(5, "sector_manager");
      const initial = await service.get(manager, 2);
      await expect(service.get(manager, 4)).rejects.toMatchObject({ code: "FORBIDDEN" });
      const changed = initial.items.map((item) => ({ ...item, text: item.questionId === 8 ? "Rascunho via API" : item.text }));
      expect(await service.save(manager, 2, 0, changed)).toMatchObject({ revision: 1, draftStatus: "drafting" });
      expect((await service.get(manager, 2)).draftStatus).toBe("drafting");
      expect(await service.discard(manager, 2, 1)).toEqual({ discarded: true });
    } finally { await sql.end({ timeout: 5 }); }
  });

  it("allows composition changes but rejects editing a question shared with an unauthorized sector", async () => {
    await assertDisposableTestDatabase(url!, runtimeUrl!);
    const sql = postgres(url!, { max: 2, prepare: false });
    const marker = new Error("rollback fixture");
    try {
      await expect(sql.begin(async (tx) => {
        const db = tx as unknown as postgres.Sql;
        const [q] = await db<{ id: number }[]>`insert into questions(question_kind,scope,sector_id,is_nps,display_order,created_by_user_id)
          values ('standard','selected_sectors',null,false,50000,1) returning id`;
        const [v] = await db<{ id: number }[]>`insert into question_versions(question_id,version_number,text,is_current,created_by_user_id)
          values (${q!.id},1,'Pergunta compartilhada',true,1) returning id`;
        for (const sectorId of [1, 2]) await db`insert into question_sector_assignments(question_id,sector_id,assignment_source,display_order,assigned_by_user_id)
          values (${q!.id},${sectorId},'selected',50000,1)`;
        const service = new FormDraftService(db);
        const manager = identity(5, "sector_manager");
        const initial = await service.get(manager, 2);
        const shared = { questionId: q!.id, sourceQuestionVersionId: v!.id, questionKind: "standard" as const,
          isNps: false, text: "Pergunta compartilhada", position: initial.items.length + 1 };
        await expect(service.save(manager, 2, 0, [...initial.items, shared])).resolves.toMatchObject({ draftStatus: "drafting" });
        expect((await service.get(manager, 2)).items.find((item) => item.questionId === q!.id)).toMatchObject({
          canEditContent: false, editRestrictionReason: "shared_question",
        });
        await expect(service.save(manager, 2, 1, [...initial.items, { ...shared, text: "Texto alterado" }]))
          .rejects.toMatchObject({ code: "DRAFT_CONTENT_FORBIDDEN" });
        await expect(service.save(manager, 2, 1, initial.items)).resolves.toMatchObject({ draftStatus: "published" });
        throw marker;
      })).rejects.toBe(marker);
      expect(await sql`select id from submission_form_drafts where sector_id=2`).toHaveLength(0);
    } finally { await sql.end({ timeout: 5 }); }
  });

  it("keeps published forms unchanged, enforces scope and revision, and physically discards one sector draft", async () => {
    await assertDisposableTestDatabase(url!, runtimeUrl!);
    const sql = postgres(url!, { max: 2, prepare: false });
    const manager = identity(5, "sector_manager"), admin = identity(1, "superuser");
    const service = new FormDraftService(sql);
    try {
      const [state] = await sql<{ db: string; ledger: number }[]>`select current_database() as db,(select count(*)::int from drizzle.__drizzle_migrations) as ledger`;
      expect(state).toEqual({ db: "fhdod_test", ledger: 18 });
      const [before] = await sql<{ versions: number; sessions: number; answers: number }[]>`
        select (select count(*)::int from submission_form_versions) versions,
               (select count(*)::int from submission_sessions) sessions,
               (select count(*)::int from submission_answers) answers`;
      const historicalBefore = await sql`select id,form_version_id as "formVersionId",shift_sheet_version_id as "shiftVersionId" from submission_sessions order by id`;
      const initial = await service.get(manager, 2);
      expect(initial.revision).toBe(0);
      expect(initial.items.length).toBeGreaterThan(1);
      const own = initial.items.find((q) => q.questionId === 8)!;
      const shared = initial.items.find((q) => q.questionId === 26)!;
      expect(own.canEditContent).toBe(true);
      expect(shared).toMatchObject({ canEditContent: false, editRestrictionReason: "global_question" });
      expect(initial.items.find((q) => q.isNps)).toMatchObject({ canEditContent: false, editRestrictionReason: "nps_admin_only" });
      await expect(service.get(manager, 3)).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(await sql`select id from submission_form_drafts where sector_id=2`).toHaveLength(0);

      const edited = initial.items.map((q) => ({ ...q, text: q.questionId === own.questionId ? "Texto provisório autorizado" : q.text }));
      await expect(service.save(manager, 2, 0, edited)).resolves.toMatchObject({ revision: 1, draftStatus: "drafting" });
      const restarted = new FormDraftService(sql);
      expect(await restarted.get(manager, 2)).toMatchObject({ draftStatus: "drafting", revision: 1, publishedVersionId: initial.publishedVersionId });
      expect((await restarted.get(manager, 2)).items.find((q) => q.questionId === own.questionId)?.text).toBe("Texto provisório autorizado");
      await expect(service.save(manager, 2, 0, edited)).rejects.toMatchObject({ code: "DRAFT_CONFLICT" });
      await expect(service.save(manager, 2, 1, edited)).resolves.toMatchObject({ revision: 1 });

      const forbidden = edited.map((q) => ({ ...q, text: q.questionId === 26 ? "Alteração indevida" : q.text }));
      await expect(service.save(manager, 2, 1, forbidden)).rejects.toMatchObject({ code: "DRAFT_CONTENT_FORBIDDEN" });
      const npsEdited = edited.map((q) => ({ ...q, text: q.isNps ? "NPS alterado sem autorização" : q.text }));
      await expect(service.save(manager, 2, 1, npsEdited)).rejects.toMatchObject({ code: "DRAFT_CONTENT_FORBIDDEN" });
      const [foreignVersion] = await sql<{ id: number; text: string }[]>`select id,text from question_versions where question_id=12 order by version_number desc limit 1`;
      const foreign = [...edited, { questionId: 12, sourceQuestionVersionId: foreignVersion!.id, questionKind: "sector" as const, isNps: false, text: foreignVersion!.text, position: edited.length + 1 }];
      await expect(service.save(manager, 2, 1, foreign)).rejects.toMatchObject({ code: "DRAFT_QUESTION_SCOPE" });
      const npsTampered = edited.map((q) => ({ ...q, isNps: q.questionId === own.questionId ? true : q.isNps }));
      await expect(service.save(manager, 2, 1, npsTampered)).rejects.toMatchObject({ code: "INVALID_FORM_DRAFT" });
      const versionTampered = edited.map((q) => ({ ...q, sourceQuestionVersionId: q.questionId === 26 ? own.sourceQuestionVersionId : q.sourceQuestionVersionId }));
      await expect(service.save(manager, 2, 1, versionTampered)).rejects.toMatchObject({ code: "DRAFT_QUESTION_SCOPE" });
      await expect(service.save(admin, 2, 1, forbidden)).resolves.toMatchObject({ revision: 2 });
      expect((await service.get(admin, 2)).items.find((q) => q.questionId === 26)?.text).toBe("Alteração indevida");
      const [draftRow] = await sql<{ id: number }[]>`select id from submission_form_drafts where sector_id=2`;
      const other = await service.get(admin, 4);
      const otherEdited = other.items.map((q) => ({ ...q, text: q.questionId === 20 ? "Outro rascunho" : q.text }));
      await expect(service.save(admin, 4, 0, otherEdited)).resolves.toMatchObject({ draftStatus: "drafting" });
      await expect(service.discard(manager, 2, 1)).rejects.toMatchObject({ code: "DRAFT_CONFLICT" });
      await expect(service.discard(manager, 2, 2)).resolves.toEqual({ discarded: true });
      expect(await sql`select id from submission_form_drafts where sector_id=2`).toHaveLength(0);
      expect(await sql`select id from submission_form_draft_questions where draft_id=${draftRow!.id}`).toHaveLength(0);
      expect(await sql`select id from submission_form_drafts where sector_id=4`).toHaveLength(1);
      await service.discard(admin, 4, 1);
      const [after] = await sql<{ versions: number; sessions: number; answers: number }[]>`
        select (select count(*)::int from submission_form_versions) versions,
               (select count(*)::int from submission_sessions) sessions,
               (select count(*)::int from submission_answers) answers`;
      expect(after).toEqual(before);
      expect(await sql`select id,form_version_id as "formVersionId",shift_sheet_version_id as "shiftVersionId" from submission_sessions order by id`).toEqual(historicalBefore);
    } finally {
      await sql`delete from submission_form_drafts where sector_id in (2,4)`;
      await sql.end({ timeout: 5 });
    }
  });
});
