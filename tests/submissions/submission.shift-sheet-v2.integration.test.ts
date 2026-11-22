import "dotenv/config";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { SubmissionService } from "../../src/modules/submissions/submission.service.js";
import { PostgresSubmissionRepository } from "../../src/modules/submissions/submission.repository.js";
import { assertDisposableTestDatabase, testDatabaseUrl, usesIsolatedDatabase } from "../helpers/database.js";

const testUrl = testDatabaseUrl();
const runtimeUrl = process.env.DATABASE_URL;
const describeIntegration = usesIsolatedDatabase(testUrl, runtimeUrl) ? describe : describe.skip;
const now = new Date("2026-01-05T22:00:00.000Z");

describeIntegration("submissão com planilha sem funcionários", () => {
  it("persists ordered questions and NPS outside operating hours, rejects invalid answers, and blocks inactive sectors", async () => {
    await assertDisposableTestDatabase(testUrl!, runtimeUrl!);
    const sql = postgres(testUrl!, { max: 1 });
    const suffix = randomUUID().slice(0, 8);
    const code = `patient-${suffix}`;
    try {
      await expect(sql.begin(async (tx) => {
        const [user] = await tx<{ id: number }[]>`
          insert into users (role_id, full_name, email, password_hash, created_at, updated_at)
          values (1, 'Teste de respostas', ${`patient-${suffix}@test.invalid`}, 'hash', now(), now()) returning id`;
        const [sector] = await tx<{ id: number }[]>`
          insert into sectors (code, name, created_at, updated_at) values (${code}, 'Setor de teste', now(), now()) returning id`;
        const active = await tx<{ id: number }[]>`select id from sectors where deleted_at is null`;
        const [version] = await tx<{ id: number }[]>`
          insert into shift_sheet_versions (version_number, csv_format, is_current)
          select coalesce(max(version_number), 0) + 1, 2, false from shift_sheet_versions returning id`;
        for (const item of active) for (let day = 1; day <= 7; day++) await tx`
          insert into sector_shift_days (shift_sheet_version_id, sector_id, day_of_week, is_closed)
          values (${version!.id}, ${item.id}, ${day}, ${item.id !== sector!.id || day !== 1})`;
        const [range] = await tx<{ id: number }[]>`
          insert into sector_shift_ranges (shift_sheet_version_id, sector_id, shift_name, starts_at, ends_at, day_of_week)
          values (${version!.id}, ${sector!.id}, 'SEM_TURNO', '08:00', '17:00', 1) returning id`;
        await tx`update shift_sheet_versions set is_current = false where is_current`;
        await tx`update shift_sheet_versions set is_current = true where id = ${version!.id}`;

        const [local] = await tx<{ id: number }[]>`
          insert into questions (question_kind, scope, sector_id, is_nps, display_order, created_by_user_id, created_at, updated_at)
          values ('sector', 'sector_only', ${sector!.id}, false, 2, ${user!.id}, now(), now()) returning id`;
        const [standard] = await tx<{ id: number }[]>`
          insert into questions (question_kind, scope, sector_id, is_nps, display_order, created_by_user_id, created_at, updated_at)
          values ('standard', 'selected_sectors', null, false, 1, ${user!.id}, now(), now()) returning id`;
        const [nps] = await tx<{ id: number }[]>`
          insert into questions (question_kind, scope, sector_id, is_nps, display_order, created_by_user_id, created_at, updated_at)
          values ('standard', 'selected_sectors', null, true, 2147483647, ${user!.id}, now(), now()) returning id`;
        for (const [questionId, label] of [[local!.id, "Atendimento"], [standard!.id, "Qualidade"], [nps!.id, "NPS"]] as const) await tx`
          insert into question_versions (question_id, version_number, text, is_current, created_by_user_id, created_at)
          values (${questionId}, 1, ${label}, true, ${user!.id}, now())`;
        await tx`
          insert into question_sector_assignments (question_id, sector_id, assignment_source, display_order, assigned_at, assigned_by_user_id)
          values (${standard!.id}, ${sector!.id}, 'selected', 1, now(), ${user!.id})`;
        await tx`
          insert into sector_nps_assignments (sector_id, question_id, assignment_source, assigned_at, assigned_by_user_id)
          values (${sector!.id}, ${nps!.id}, 'specific', now(), ${user!.id})`;

        let currentTime = now;
        const service = new SubmissionService(new PostgresSubmissionRepository(tx as unknown as postgres.Sql), { now: () => currentTime });
        const inHours = await service.start(sector!.id, 1, "09:00");
        expect(inHours.session).toMatchObject({ sectorId: sector!.id, shiftSheetVersionId: version!.id, shiftRangeId: range!.id });
        expect(inHours.session.expiresAt).toBe(new Date(now.getTime() + 180_000).toISOString());
        const outside = await service.start(sector!.id, 1, "19:00");
        expect(outside.session).toMatchObject({ sectorId: sector!.id, shiftSheetVersionId: version!.id, shiftRangeId: null });
        expect(outside.questions.map((item) => [item.questionId, item.text, item.position])).toEqual([
          [standard!.id, "Qualidade", 1], [local!.id, "Atendimento", 2], [nps!.id, "NPS", 3],
        ]);
        const session = await tx<{ sectorId: number; versionId: number; rangeId: number | null }[]>`
          select sector_id as "sectorId", shift_sheet_version_id as "versionId", shift_range_id as "rangeId"
          from submission_sessions where id = ${outside.capability.sessionId}`;
        expect(session).toEqual([{ sectorId: sector!.id, versionId: version!.id, rangeId: null }]);
        const standardItem = outside.questions[0]!, npsItem = outside.questions[2]!;
        expect(outside.session.formVersionId).toBe(inHours.session.formVersionId);
        await expect(service.answer(outside.capability.sessionId, "invalid", { questionId: standardItem.questionId, questionVersionId: standardItem.questionVersionId, status: "answered", score: 5 })).rejects.toMatchObject({ code: "SUBMISSION_CAPABILITY_INVALID" });
        await expect(service.answer(outside.capability.sessionId, outside.capability.token, { questionId: standardItem.questionId, questionVersionId: standardItem.questionVersionId, status: "answered", score: 6 })).rejects.toMatchObject({ code: "INVALID_ANSWER_SCORE" });
        await expect(service.answer(outside.capability.sessionId, outside.capability.token, { questionId: 2147483647, questionVersionId: 2147483647, status: "answered", score: 5 })).rejects.toMatchObject({ code: "SUBMISSION_QUESTION_NOT_FOUND" });
        await expect(service.answer(outside.capability.sessionId, outside.capability.token, { questionId: standardItem.questionId, questionVersionId: npsItem.questionVersionId, status: "answered", score: 5 })).rejects.toMatchObject({ code: "SUBMISSION_QUESTION_NOT_FOUND" });
        expect(await tx`select question_id from submission_form_answers where session_id=${outside.capability.sessionId}`).toHaveLength(0);
        const firstAnswer = await service.answer(outside.capability.sessionId, outside.capability.token, { questionId: standardItem.questionId, questionVersionId: standardItem.questionVersionId, status: "answered", score: 5 });
        expect(firstAnswer).toMatchObject({ status: "incomplete", expiresAt: new Date(now.getTime() + 300_000).toISOString() });
        // Simulates a process restart: this instance has no shared in-memory state.
        const restartedService = new SubmissionService(new PostgresSubmissionRepository(tx as unknown as postgres.Sql), { now: () => currentTime });
        await expect(restartedService.refresh(outside.capability.sessionId, outside.capability.token)).resolves.toMatchObject({ refreshesUsed: 1 });
        await expect(restartedService.refresh(outside.capability.sessionId, "x".repeat(43))).rejects.toMatchObject({ code: "SUBMISSION_CAPABILITY_INVALID" });
        const retry = await service.answer(outside.capability.sessionId, outside.capability.token, { questionId: standardItem.questionId, questionVersionId: standardItem.questionVersionId, status: "answered", score: 5 });
        expect(retry.expiresAt).toBe(new Date(now.getTime() + 420_000).toISOString());
        for (let attempt = 2; attempt <= 3; attempt++) {
          await expect(service.refresh(outside.capability.sessionId, outside.capability.token)).resolves.toMatchObject({ refreshesUsed: attempt, refreshesRemaining: 3 - attempt, expiresAt: new Date(now.getTime() + (5 + 2 * attempt) * 60_000).toISOString() });
        }
        await expect(service.refresh(outside.capability.sessionId, outside.capability.token)).rejects.toMatchObject({ code: "SUBMISSION_REFRESH_LIMIT" });
        await expect(service.answer(outside.capability.sessionId, outside.capability.token, { questionId: npsItem.questionId, questionVersionId: npsItem.questionVersionId, status: "answered", score: 9 })).resolves.toMatchObject({ status: "complete" });
        const answers = await tx<{ questionId: number; text: string; score: number; status: string }[]>`
          select q.question_id as "questionId", v.text, a.score, a.status
          from submission_form_answers a
          join submission_form_questions q on q.form_version_id = a.form_version_id and q.question_id = a.question_id
          join question_versions v on v.id = a.question_version_id
          where a.session_id = ${outside.capability.sessionId} order by q.position`;
        expect(answers).toEqual([
          { questionId: standard!.id, text: "Qualidade", score: 5, status: "answered" },
          { questionId: nps!.id, text: "NPS", score: 9, status: "answered" },
        ]);
        await expect(service.refresh(outside.capability.sessionId, outside.capability.token)).rejects.toMatchObject({ code: "SUBMISSION_CLOSED" });
        await expect(service.close(inHours.capability.sessionId, inHours.capability.token)).resolves.toMatchObject({ status: "closed" });
        await expect(service.answer(inHours.capability.sessionId, inHours.capability.token, { questionId: standardItem.questionId, questionVersionId: standardItem.questionVersionId, status: "answered", score: 5 })).rejects.toMatchObject({ code: "SUBMISSION_CLOSED" });
        await tx`update shift_sheet_versions set is_current = false where id = ${version!.id}`;
        const noSchedule = await service.start(sector!.id, 1, "19:00");
        expect(noSchedule.session).toMatchObject({ sectorId: sector!.id, shiftSheetVersionId: null, shiftRangeId: null });
        expect(await tx<{ versionId: number | null; rangeId: number | null }[]>`
          select shift_sheet_version_id as "versionId", shift_range_id as "rangeId" from submission_sessions
          where id = ${noSchedule.capability.sessionId}`).toEqual([{ versionId: null, rangeId: null }]);
        await service.answer(noSchedule.capability.sessionId, noSchedule.capability.token, { questionId: noSchedule.questions[0]!.questionId, questionVersionId: noSchedule.questions[0]!.questionVersionId, status: "answered", score: 4 });
        await expect(service.answer(noSchedule.capability.sessionId, noSchedule.capability.token, { questionId: noSchedule.questions[2]!.questionId, questionVersionId: noSchedule.questions[2]!.questionVersionId, status: "answered", score: 8 })).resolves.toMatchObject({ status: "complete" });
        const expiring = await service.start(sector!.id, 1, "19:00");
        currentTime = new Date(now.getTime() + 180_001);
        await expect(service.answer(expiring.capability.sessionId, expiring.capability.token, { questionId: standardItem.questionId, questionVersionId: standardItem.questionVersionId, status: "answered", score: 5 })).rejects.toMatchObject({ code: "SUBMISSION_EXPIRED" });
        expect(await tx<{ ended: boolean }[]>`select ended_at is not null as ended from submission_sessions where id=${expiring.capability.sessionId}`).toEqual([{ ended: true }]);
        await tx`update sectors set deleted_at = now() where id = ${sector!.id}`;
        await expect(service.start(sector!.id, 1, "19:00")).rejects.toMatchObject({ code: "SECTOR_NOT_FOUND" });
        expect(await tx`select id from submission_sessions where sector_id = ${sector!.id}`).toHaveLength(4);
        throw new Error("ROLLBACK_PATIENT_FLOW");
      })).rejects.toThrow("ROLLBACK_PATIENT_FLOW");
      expect(await sql`select id from sectors where code = ${code}`).toHaveLength(0);
    } finally { await sql.end({ timeout: 5 }); }
  });
});
