import { createFormFixture } from "../helpers/form-fixture.js";
import postgres from "postgres";
import type { AuthIdentity } from "../../src/modules/auth/auth.service.js";
import { FormDraftService } from "../../src/modules/submissions/form-draft.service.js";
import { PostgresSubmissionRepository } from "../../src/modules/submissions/submission.repository.js";
import { SubmissionService } from "../../src/modules/submissions/submission.service.js";
import { assertDisposableTestDatabase, testDatabaseUrl, usesIsolatedDatabase } from "../helpers/database.js";

const url = testDatabaseUrl(), runtimeUrl = process.env.DATABASE_URL;
const integration = usesIsolatedDatabase(url, runtimeUrl) ? describe : describe.skip;


integration("manual form publication on disposable PostgreSQL", () => {
  const manager = () : AuthIdentity => ({userId:fixture.managerId,sessionId:"test",role:"sector_manager",mustChangePassword:false});
  let fixture: Awaited<ReturnType<typeof createFormFixture>>;
  beforeAll(async()=>{fixture=await createFormFixture(url!,runtimeUrl!);});
  afterAll(async()=>{await fixture?.cleanup();});

  it("rejects missing and incomplete drafts without moving the current pointer", async () => {
    await assertDisposableTestDatabase(url!, runtimeUrl!);
    const sql = postgres(url!, { max: 2, prepare: false });
    const service = new FormDraftService(sql);
    try {
      const prior = await service.get(manager(), fixture.sectorId);
      if (prior.draftStatus === "drafting") await service.discard(manager(), fixture.sectorId, prior.revision);
      const initial = await service.get(manager(), fixture.sectorId);
      const [ledger] = await sql<{ count: number }[]>`select count(*)::int count from drizzle.__drizzle_migrations`;
      expect(ledger.count).toBe(20);
      await expect(service.publish(manager(), fixture.sectorId, 0)).rejects.toMatchObject({ code: "DRAFT_CONFLICT" });
      const incomplete = initial.items.filter((item) => !item.isNps);
      await expect(service.save(manager(), fixture.sectorId, 0, incomplete)).resolves.toMatchObject({ revision: 1 });
      await expect(service.publish(manager(), fixture.sectorId, 0)).rejects.toMatchObject({ code: "DRAFT_CONFLICT" });
      await expect(service.publish(manager(), fixture.sectorId, 1)).rejects.toMatchObject({ code: "FORM_NOT_READY",
        details: { missingRequirements: expect.arrayContaining(["nps"]) } });
      expect((await service.get(manager(), fixture.sectorId)).publishedVersionId).toBe(initial.publishedVersionId);
      expect(await sql`select id from submission_form_drafts where sector_id=${fixture.sectorId}`).toHaveLength(1);
      await service.discard(manager(), fixture.sectorId, 1);
    } finally { await sql.end({ timeout: 5 }); }
  });

  it("rejects an incomplete current pointer and a session without a first publication", async () => {
    await assertDisposableTestDatabase(url!, runtimeUrl!);
    const sql = postgres(url!, { max: 2, prepare: false });
    try {
      await expect(sql.begin(async (tx) => {
        const [sector] = await tx<{ id: number }[]>`insert into sectors(code,name) values (${`unpublished-${Date.now()}`},'Sem publicação') returning id`;
        const patient = new SubmissionService(new PostgresSubmissionRepository(tx as unknown as postgres.Sql), { now: () => new Date() });
        await expect(patient.currentForm(sector!.id)).rejects.toMatchObject({ code: "FORM_NOT_PUBLISHED" });
        await expect(patient.startNow(sector!.id)).rejects.toMatchObject({ code: "FORM_NOT_PUBLISHED" });
        const [version] = await tx<{ id: number }[]>`insert into submission_form_versions(sector_id,version_number,fingerprint)
          values (${sector!.id},1,${`incomplete-${Date.now()}`}) returning id`;
        await expect(tx`insert into sector_current_forms(sector_id,form_version_id) values (${sector!.id},${version!.id})`)
          .rejects.toMatchObject({ code: "23514" });
      })).rejects.toMatchObject({ code: "23514" });
    } finally { await sql.end({ timeout: 5 }); }
  });

  it("publishes only by explicit action and keeps old sessions and question versions", async () => {
    await assertDisposableTestDatabase(url!, runtimeUrl!);
    const sql = postgres(url!, { max: 2, prepare: false });
    const invalidatedVersions: number[]=[];
    const service = new FormDraftService(sql,{invalidateQuestions:async()=>{
      const observer=postgres(url!,{max:1});
      try{const [current]=await observer<{id:number}[]>`select form_version_id as id from sector_current_forms where sector_id=${fixture.sectorId}`;
        invalidatedVersions.push(current!.id);
        if(invalidatedVersions.length>1) throw new Error('Redis unavailable after commit');
      }finally{await observer.end({timeout:5});}
    }});
    let fixtureRangeId: number | null = null;
    let fixtureSheetId: number | null = null;
    try {
      let [sheet] = await sql<{ id: number }[]>`select id from shift_sheet_versions where is_current=true`;
      if (!sheet) {
        [sheet] = await sql<{ id: number }[]>`insert into shift_sheet_versions(version_number,uploaded_at,valid_from,is_current,csv_format)
          select coalesce(max(version_number),0)+1,now(),now(),true,1 from shift_sheet_versions returning id`;
        fixtureSheetId = sheet!.id;
      }
      const [existing] = await sql<{ present: boolean }[]>`select exists(select 1 from sector_shift_ranges where shift_sheet_version_id=${sheet!.id} and sector_id=${fixture.sectorId}) as present`;
      if (!existing!.present) {
        const [range] = await sql<{ id: number }[]>`insert into sector_shift_ranges(shift_sheet_version_id,sector_id,shift_name,starts_at,ends_at,day_of_week)
          values (${sheet!.id},${fixture.sectorId},'Teste publicação','08:00','17:00',1) returning id`;
        fixtureRangeId = range!.id;
      }
      const prior = await service.get(manager(), fixture.sectorId);
      if (prior.draftStatus === "drafting") await service.discard(manager(), fixture.sectorId, prior.revision);
      const initial = await service.get(manager(), fixture.sectorId);
      const beforeVersions = await service.history(manager(), fixture.sectorId);
      const patient = new SubmissionService(new PostgresSubmissionRepository(sql), { now: () => new Date() });
      const initialPublicForm = await patient.currentForm(fixture.sectorId);
      expect(initialPublicForm.formVersionId).toBe(initial.publishedVersionId);
      const oldQuestion = initial.items.find((q) => q.questionId === fixture.ownQuestionId)!;
      const oldText = (await sql<{ text: string }[]>`select text from question_versions where id=${oldQuestion.sourceQuestionVersionId}`)[0]!.text;
      const updatedText = `Rascunho publicado ${Date.now()}`;
      const edited = initial.items.map((q) => ({ ...q, text: q.questionId === fixture.ownQuestionId ? updatedText : q.text }));
      expect(await service.save(manager(), fixture.sectorId, 0, edited)).toMatchObject({ draftStatus: "drafting", revision: 1 });
      expect((await service.get(manager(), fixture.sectorId)).publishedVersionId).toBe(initial.publishedVersionId);
      expect(await service.history(manager(), fixture.sectorId)).toHaveLength(beforeVersions.length);
      const result = await service.publish(manager(), fixture.sectorId, 1);
      expect(result).toMatchObject({ published: true });
      expect(invalidatedVersions).toEqual([result.formVersionId]);
      expect(result.formVersionId).not.toBe(initial.publishedVersionId);
      const restarted = new FormDraftService(sql);
      expect((await restarted.get(manager(), fixture.sectorId)).publishedVersionId).toBe(result.formVersionId);
      expect((await restarted.get(manager(), fixture.sectorId)).draftStatus).toBe("published");
      const currentQuestion = (await restarted.version(manager(), fixture.sectorId, result.formVersionId!)).items.find((q) => q.questionId === fixture.ownQuestionId)!;
      expect(currentQuestion.text).toBe(updatedText);
      expect(currentQuestion.questionVersionId).not.toBe(oldQuestion.sourceQuestionVersionId);
      expect((await sql<{ text: string }[]>`select text from question_versions where id=${oldQuestion.sourceQuestionVersionId}`)[0]!.text).toBe(oldText);
      expect(await sql`select id from submission_form_drafts where sector_id=${fixture.sectorId}`).toHaveLength(0);
      expect(await restarted.history(manager(), fixture.sectorId)).toHaveLength(beforeVersions.length + 1);
      const publishedPublicForm = await patient.currentForm(fixture.sectorId);
      expect(publishedPublicForm.formVersionId).toBe(result.formVersionId);
      expect(publishedPublicForm.etag).not.toBe(initialPublicForm.etag);
      const session = await patient.startNow(fixture.sectorId);
      expect(session.session.formVersionId).toBe(result.formVersionId);
      expect(session.questions.find((q) => q.questionId === fixture.ownQuestionId)?.text).toBe(updatedText);
      expect(await service.restore(manager(), fixture.sectorId, initial.publishedVersionId!, 0)).toMatchObject({ draftStatus: "drafting", revision: 1 });
      expect((await service.get(manager(), fixture.sectorId)).publishedVersionId).toBe(result.formVersionId);
      const restored = await service.publish(manager(), fixture.sectorId, 1);
      expect(restored.formVersionId).not.toBe(initial.publishedVersionId);
      expect(invalidatedVersions).toEqual([result.formVersionId,restored.formVersionId]);
      expect(restored.formVersionId).not.toBe(result.formVersionId);
      expect((await service.history(manager(), fixture.sectorId))[0]).toMatchObject({ id: restored.formVersionId, current: true });
      const fresh = await patient.startNow(fixture.sectorId);
      expect((await patient.currentForm(fixture.sectorId)).etag).not.toBe(publishedPublicForm.etag);
      expect(fresh.session.formVersionId).toBe(restored.formVersionId);
      expect(fresh.questions.find((q) => q.questionId === fixture.ownQuestionId)?.text).toBe(oldText);
      expect((await sql<{ formVersionId: number }[]>`select form_version_id as "formVersionId" from submission_sessions where id=${session.session.id}`)[0]?.formVersionId).toBe(result.formVersionId);
      await sql`delete from submission_sessions where id=${session.session.id}`;
      await sql`delete from submission_sessions where id=${fresh.session.id}`;
    } finally {
      if (fixtureRangeId !== null) await sql`delete from sector_shift_ranges where id=${fixtureRangeId}`;
      if (fixtureSheetId !== null) await sql`delete from shift_sheet_versions where id=${fixtureSheetId}`;
      await sql.end({ timeout: 5 });
    }
  });
});
