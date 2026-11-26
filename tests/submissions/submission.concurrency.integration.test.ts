import "dotenv/config";
import { randomBytes, randomUUID } from "node:crypto";
import postgres from "postgres";
import { SubmissionService } from "../../src/modules/submissions/submission.service.js";
import { PostgresSubmissionRepository } from "../../src/modules/submissions/submission.repository.js";
import { assertDisposableTestDatabase, testDatabaseUrl, usesIsolatedDatabase } from "../helpers/database.js";
import { publishEffectiveForm } from "../helpers/publish-form.js";

const adminUrl = testDatabaseUrl();
const runtimeUrl = process.env.DATABASE_URL;
const integration = usesIsolatedDatabase(adminUrl, runtimeUrl) ? describe : describe.skip;

integration("published form answer concurrency", () => {
  it("serializes two effective writes and keeps one answer for the question", async () => {
    await assertDisposableTestDatabase(adminUrl!, runtimeUrl!);
    const admin = postgres(adminUrl!, { max: 1 });
    const runtime = postgres(runtimeUrl!, { max: 4 });
    const suffix = randomUUID().slice(0, 8);
    let userId = 0, sectorId = 0, commonId = 0, standardId = 0, npsId = 0, formVersionId = 0, sessionId = "", firstAttemptId = "";
    try {
      const user = await admin<{ id: number }[]>`insert into users (role_id, full_name, email, password_hash) values (1, 'Concorrência', ${`race-${suffix}@test.invalid`}, 'hash') returning id`;
      userId = user[0]!.id;
      const sector = await admin<{ id: number }[]>`insert into sectors (code, name) values (${`race-${suffix}`}, 'Setor concorrência') returning id`;
      sectorId = sector[0]!.id;
      const common = await admin<{ id: number }[]>`insert into questions (question_kind, scope, sector_id, is_nps, display_order, created_by_user_id) values ('sector', 'sector_only', ${sectorId}, false, 1, ${userId}) returning id`;
      commonId = common[0]!.id;
      const nps = await admin<{ id: number }[]>`insert into questions (question_kind, scope, sector_id, is_nps, display_order, created_by_user_id) values ('standard', 'selected_sectors', null, true, 2147483647, ${userId}) returning id`;
      npsId = nps[0]!.id;
      const standard = await admin<{ id: number }[]>`insert into questions (question_kind, scope, sector_id, is_nps, display_order, created_by_user_id) values ('standard', 'selected_sectors', null, false, 2, ${userId}) returning id`;
      standardId = standard[0]!.id;
      for (const [id, label] of [[commonId, "Atendimento"], [standardId, "Qualidade"], [npsId, "NPS"]] as const)
        await admin`insert into question_versions (question_id, version_number, text, is_current, created_by_user_id) values (${id}, 1, ${label}, true, ${userId})`;
      await admin`insert into question_sector_assignments (question_id, sector_id, assignment_source, display_order, assigned_by_user_id) values (${standardId}, ${sectorId}, 'selected', 2, ${userId})`;
      await admin`insert into sector_nps_assignments (sector_id, question_id, assignment_source, assigned_by_user_id) values (${sectorId}, ${npsId}, 'specific', ${userId})`;
      formVersionId = await publishEffectiveForm(admin, sectorId, userId);
      const service = new SubmissionService(new PostgresSubmissionRepository(runtime), { now: () => new Date() });
      const started = await service.startNow(sectorId);
      sessionId = started.capability.sessionId;
      formVersionId = started.session.formVersionId;
      const question = started.questions.find((item) => item.questionId === commonId)!;
      firstAttemptId = randomUUID();
      const firstCapability = randomBytes(32).toString("base64url");
      const firstInput = { questionId: commonId, questionVersionId: question.questionVersionId, status: "answered" as const, score: 5 };
      const skip = { ...firstInput, status: "skipped" as const, score: null };
      const firstResults = await Promise.all([0, 1].map(() => service.startWithFirstAnswer(sectorId, formVersionId, firstAttemptId, firstCapability, skip)));
      expect(firstResults.map((item) => item.replayed).sort()).toEqual([false, true]);
      expect((await admin<{ count: number }[]>`select count(*)::int as count from submission_form_answers where session_id=${firstAttemptId}`)[0]!.count).toBe(1);
      expect(firstResults.every(result => !result.answer.answered)).toBe(true);
      await expect(service.answer(firstAttemptId, firstCapability, firstInput)).rejects.toMatchObject({ code: "ANSWER_ALREADY_CONFIRMED" });
      const required = started.questions.find(item => item.questionId === standardId)!;
      await expect(service.answer(firstAttemptId, firstCapability, { ...skip, ...required })).rejects.toMatchObject({ code: "QUESTION_NOT_SKIPPABLE" });
      await service.answer(firstAttemptId, firstCapability, { ...firstInput, ...required });
      const final = { ...firstInput, ...started.questions.find(item => item.isNps)!, score: 10 };
      const race = await Promise.allSettled([
        service.close(firstAttemptId, firstCapability),
        service.answer(firstAttemptId, firstCapability, final),
      ]);
      expect(race.filter(item => item.status === "fulfilled")).toHaveLength(1);
      if (race[0]!.status === "fulfilled") {
        expect(race[1]).toMatchObject({ reason: { code: "SUBMISSION_CLOSED" } });
        await expect(service.close(firstAttemptId, firstCapability)).resolves.toEqual({ sessionId: firstAttemptId, status: "closed" });
        expect(await admin`select status from submission_sessions where id=${firstAttemptId}`).toMatchObject([{ status: "incomplete" }]);
      } else {
        expect(race[0]).toMatchObject({ reason: { code: "SUBMISSION_COMPLETED" } });
      }
      const results = await Promise.allSettled([1, 5].map((score) => service.answer(sessionId, started.capability.token, {
        questionId: commonId, questionVersionId: question.questionVersionId, status: "answered", score,
      })));
      expect(results).toHaveLength(2);
      expect(results.filter((item) => item.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((item) => item.status === "rejected")).toHaveLength(1);
      const answers = await admin<{ count: number; score: number }[]>`
        select count(*)::int as count, max(score)::int as score
        from submission_form_answers where session_id=${sessionId} and question_id=${commonId}`;
      expect(answers[0]!.count).toBe(1);
      expect([1, 5]).toContain(answers[0]!.score);
      await admin`update submission_sessions set expires_at=now()-interval '1 second' where id=${sessionId}`;
      await expect(service.close(sessionId, started.capability.token)).rejects.toMatchObject({ code: "SUBMISSION_EXPIRED" });
      expect(await new PostgresSubmissionRepository(runtime).reconcileExpired(new Date())).toBeGreaterThanOrEqual(1);
      expect((await admin<{ ended: boolean }[]>`select ended_at is not null as ended from submission_sessions where id=${sessionId}`)[0]!.ended).toBe(true);
    } finally {
      if (firstAttemptId) {
        await admin`delete from submission_form_answers where session_id=${firstAttemptId}`;
        await admin`delete from submission_sessions where id=${firstAttemptId}`;
      }
      if (sessionId) {
        await admin`delete from submission_form_answers where session_id=${sessionId}`;
        await admin`delete from submission_sessions where id=${sessionId}`;
      }
      if (formVersionId) {
        await admin`delete from sector_current_forms where sector_id=${sectorId}`;
        await admin`delete from submission_form_questions where form_version_id=${formVersionId}`;
        await admin`delete from submission_form_versions where id=${formVersionId}`;
      }
      if (npsId) await admin`delete from sector_nps_assignments where question_id=${npsId}`;
      if (standardId) await admin`delete from question_sector_assignments where question_id=${standardId}`;
      if (commonId || standardId || npsId) {
        await admin`delete from question_versions where question_id in (${commonId}, ${standardId}, ${npsId})`;
        await admin`delete from questions where id in (${commonId}, ${standardId}, ${npsId})`;
      }
      if (sectorId) await admin`delete from sectors where id=${sectorId}`;
      if (userId) await admin`delete from users where id=${userId}`;
      await Promise.all([admin.end({ timeout: 5 }), runtime.end({ timeout: 5 })]);
    }
  });
});
