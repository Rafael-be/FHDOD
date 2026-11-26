import "dotenv/config";
import { AnalyticsRepository } from "../../src/modules/analytics/analytics.repository.js";
import postgres from "postgres";
import { SubmissionService } from "../../src/modules/submissions/submission.service.js";
import { PostgresSubmissionRepository } from "../../src/modules/submissions/submission.repository.js";
import { testDatabaseUrl, usesIsolatedDatabase } from "../helpers/database.js";
import type { Clock } from "../../src/shared/core.js";
import { publishEffectiveForm } from "../helpers/publish-form.js";

const testUrl = testDatabaseUrl();
const runtimeUrl = process.env.DATABASE_URL;
const describeIntegration = usesIsolatedDatabase(testUrl, runtimeUrl) ? describe : describe.skip;
const clock: Clock = { now: () => new Date("2026-01-01T12:00:00Z") };

describeIntegration("anonymous submissions integration", () => {
  it("completes in published order with explicitly skipped sector questions", async () => {
    const sql = postgres(testUrl!, { max: 1 });
    try {
      await expect(sql.begin(async (tx) => {
        const user = await tx<{ id: number }[]>`insert into users (role_id, full_name, email, password_hash, created_at, updated_at) values (1, 'Teste', ${`submission-${Date.now()}@test.invalid`}, 'hash', now(), now()) returning id`;
        const sector = await tx<{ id: number }[]>`insert into sectors (code, name, created_at, updated_at) values (${`submission-${Date.now()}`}, 'Setor submissão', now(), now()) returning id`;
        await tx`update shift_sheet_versions set is_current = false where is_current = true`;
        const version = await tx<{ id: number }[]>`insert into shift_sheet_versions (version_number, uploaded_by_user_id, uploaded_at, valid_from, is_current) select coalesce(max(version_number), 0) + 1, ${user[0]!.id}, now(), now(), true from shift_sheet_versions returning id`;
        await tx`insert into sector_shift_ranges (shift_sheet_version_id, sector_id, shift_name, starts_at, ends_at, day_of_week) values (${version[0]!.id}, ${sector[0]!.id}, 'Dia', '08:00', '16:00', 4)`;
        const sectorQuestion = await tx<{ id: number }[]>`insert into questions (question_kind, scope, sector_id, is_nps, display_order, created_by_user_id, created_at, updated_at) values ('sector', 'sector_only', ${sector[0]!.id}, false, 1, ${user[0]!.id}, now(), now()) returning id`;
        const standardQuestion = await tx<{ id: number }[]>`insert into questions (question_kind, scope, sector_id, is_nps, display_order, created_by_user_id, created_at, updated_at) values ('standard', 'all_sectors', null, false, 1, ${user[0]!.id}, now(), now()) returning id`;
        const npsQuestion = await tx<{ id: number }[]>`insert into questions (question_kind, scope, sector_id, is_nps, display_order, created_by_user_id, created_at, updated_at) values ('standard', 'selected_sectors', null, true, 1, ${user[0]!.id}, now(), now()) returning id`;
        for (const [question, text] of [[sectorQuestion[0]!.id, "Setor"], [standardQuestion[0]!.id, "Padrão"], [npsQuestion[0]!.id, "NPS"]] as const) await tx`insert into question_versions (question_id, version_number, text, is_current, created_by_user_id, created_at) values (${question}, 1, ${text}, true, ${user[0]!.id}, now())`;
        await tx`insert into question_sector_assignments (question_id, sector_id, assignment_source, display_order, assigned_at, assigned_by_user_id) values (${standardQuestion[0]!.id}, ${sector[0]!.id}, 'global', 1, now(), ${user[0]!.id})`;
        await tx`insert into sector_nps_assignments (sector_id, question_id, assignment_source, assigned_at, assigned_by_user_id) values (${sector[0]!.id}, ${npsQuestion[0]!.id}, 'specific', now(), ${user[0]!.id})`;
        await publishEffectiveForm(tx as unknown as postgres.Sql, sector[0]!.id, user[0]!.id);
        const service = new SubmissionService(new PostgresSubmissionRepository(tx as unknown as postgres.Sql), clock);
        const started = await service.start(sector[0]!.id, 4, "09:00");
        expect(started.questions).toHaveLength(3);
        const sectorItem = started.questions.find((question) => question.questionKind === "sector")!;
        const standardItem = started.questions.find((question) => question.questionKind === "standard" && !question.isNps)!;
        const npsItem = started.questions.find((question) => question.isNps)!;
        await expect(service.answer(started.capability.sessionId, started.capability.token, { questionId: sectorItem.questionId, questionVersionId: sectorItem.questionVersionId, status: "answered", score: 6 })).rejects.toMatchObject({ code: "INVALID_ANSWER_SCORE" });
        await expect(service.answer(started.capability.sessionId, started.capability.token, { questionId: sectorItem.questionId, questionVersionId: sectorItem.questionVersionId, status: "skipped", score: null })).resolves.toMatchObject({ status: "incomplete" });
        await expect(service.answer(started.capability.sessionId, started.capability.token, { questionId: npsItem.questionId, questionVersionId: npsItem.questionVersionId, status: "answered", score: 10 })).rejects.toMatchObject({ code: "QUESTION_OUT_OF_SEQUENCE" });
        await expect(service.answer(started.capability.sessionId, started.capability.token, { questionId: standardItem.questionId, questionVersionId: standardItem.questionVersionId, status: "answered", score: 5 })).resolves.toMatchObject({ status: "incomplete" });
        await expect(service.answer(started.capability.sessionId, started.capability.token, { questionId: npsItem.questionId, questionVersionId: npsItem.questionVersionId, status: "answered", score: 10 })).resolves.toMatchObject({ status: "complete" });
        const answer = await tx<{ status: string; score: number | null }[]>`select status, score from submission_form_answers where session_id=${started.capability.sessionId} and question_id=${sectorItem.questionId}`;
        expect(answer).toEqual([{ status: "skipped", score: null }]);

        const withoutOptionalAnswer = await service.start(sector[0]!.id, 4, "09:00");
        const required = withoutOptionalAnswer.questions.filter((question) => question.questionKind === "standard");
        const common = required.find((question) => !question.isNps)!;
        const nps = required.find((question) => question.isNps)!;
        const sectorOptional = withoutOptionalAnswer.questions.find((question) => question.questionKind === "sector")!;
        await service.answer(withoutOptionalAnswer.capability.sessionId, withoutOptionalAnswer.capability.token, { questionId: sectorOptional.questionId, questionVersionId: sectorOptional.questionVersionId, status: "skipped", score: null });
        await expect(service.answer(withoutOptionalAnswer.capability.sessionId, withoutOptionalAnswer.capability.token, { questionId: common.questionId, questionVersionId: common.questionVersionId, status: "answered", score: 5 })).resolves.toMatchObject({ status: "incomplete" });
        await expect(service.answer(withoutOptionalAnswer.capability.sessionId, withoutOptionalAnswer.capability.token, { questionId: nps.questionId, questionVersionId: nps.questionVersionId, status: "answered", score: 10 })).resolves.toMatchObject({ status: "complete" });
        const optionalAnswers = await tx<{ count: number }[]>`
          select count(*)::int as count
          from submission_form_answers a join submission_form_questions q on q.form_version_id=a.form_version_id and q.question_id=a.question_id
          where a.session_id = ${withoutOptionalAnswer.capability.sessionId} and q.question_kind = 'sector'
        `;
        expect(optionalAnswers[0]!.count).toBe(1);
        const sectorId = sector[0]!.id;
        const partial = await service.start(sectorId, 4, "09:00");
        const partialAnswer = { ...sectorItem, status: "answered" as const, score: 3 };
        await service.answer(partial.session.id, partial.capability.token, partialAnswer);
        for (let retry = 0; retry < 2; retry++)
          await expect(service.close(partial.session.id, partial.capability.token)).resolves.toEqual({ sessionId: partial.session.id, status: "closed" });
        await expect(service.answer(partial.session.id, partial.capability.token, { ...standardItem, status:"answered", score:5 }))
          .rejects.toMatchObject({ code: "SUBMISSION_CLOSED" });
        await tx`insert into sector_shift_ranges (shift_sheet_version_id,sector_id,shift_name,starts_at,ends_at,day_of_week)
          values (${version[0]!.id},${sectorId},'Noite','20:00','07:00',4)`;
        const report = await new AnalyticsRepository(tx as unknown as postgres.Sql).dashboard({
          sectorId, from: "2026-01-01T00:00:00Z", to: "2026-01-02T00:00:00Z",
        }, null);
        expect(report.sessions).toMatchObject({ started:3, complete:2, incomplete:1, endedOrExpired:1 });
        expect(report.shifts).toEqual([
          expect.objectContaining({ name:"Dia", completed:2, percentage:100 }),
          expect.objectContaining({ name:"Noite", completed:0, percentage:0 }),
        ]);
        expect(report.unclassifiedCompleted).toBe(0);
        expect(report.questions).toContainEqual(expect.objectContaining({question_id:sectorItem.questionId,responses:1,skipped:2,mean:3}));
        const analytics = new AnalyticsRepository(tx as unknown as postgres.Sql);
        const range = { sectorId, from:"2026-01-01T00:00:00Z", to:"2026-01-02T00:00:00Z" };
        const global = await analytics.globalQuestions(range, [sectorId], standardItem.questionId);
        expect(global).toEqual([expect.objectContaining({
          questionId: standardItem.questionId, questionVersionId: standardItem.questionVersionId,
          publishedSectorIds:[sectorId], responses:2, mean:5, distribution:[{score:5,responses:2,percentage:100}],
          sectors:[{sectorId,responses:2,mean:5,distribution:[{score:5,responses:2,percentage:100}]}],
        })]);
        expect(await analytics.globalQuestions(range, [])).toEqual([]);
        expect(await analytics.globalQuestions({...range, to:range.from}, null)).toEqual([
          expect.objectContaining({publishedSectorIds:[sectorId], responses:0, mean:null, distribution:[], sectors:[]}),
        ]);
        await tx`delete from sector_current_forms where sector_id=${sectorId}`;
        expect(await analytics.globalQuestions(range, null)).toEqual([
          expect.objectContaining({questionId:standardItem.questionId, publishedSectorIds:[], responses:2}),
        ]);
        throw new Error("ROLLBACK_SUBMISSION_FIXTURE");
      })).rejects.toThrow("ROLLBACK_SUBMISSION_FIXTURE");
    } finally { await sql.end({ timeout: 5 }); }
  });
});
