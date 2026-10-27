import "dotenv/config";
import postgres from "postgres";
import { SubmissionService } from "../../src/modules/submissions/submission.service.js";
import { PostgresSubmissionRepository } from "../../src/modules/submissions/submission.repository.js";
import { usesIsolatedDatabase } from "../helpers/database.js";
import type { Clock } from "../../src/shared/core.js";

const testUrl = process.env.DATABASE_URL_TEST;
const runtimeUrl = process.env.DATABASE_URL;
const describeIntegration = usesIsolatedDatabase(testUrl, runtimeUrl) ? describe : describe.skip;
const clock: Clock = { now: () => new Date("2026-01-01T12:00:00Z") };

describeIntegration("anonymous submissions integration", () => {
  it("snapshots questions and overwrites one answer state", async () => {
    const sql = postgres(testUrl!, { max: 1 });
    try {
      await sql.begin(async (tx) => {
        const user = await tx<{ id: number }[]>`insert into users (role_id, full_name, email, password_hash, created_at, updated_at) values (1, 'Teste', ${`submission-${Date.now()}@test.invalid`}, 'hash', now(), now()) returning id`;
        const sector = await tx<{ id: number }[]>`insert into sectors (code, name, created_at, updated_at) values (${`submission-${Date.now()}`}, 'Setor submissão', now(), now()) returning id`;
        const employee = await tx<{ id: number }[]>`insert into employees (employee_code, full_name) values (${`SUB-${Date.now()}`}, 'Atendente') returning id`;
        await tx`update shift_sheet_versions set is_current = false where is_current = true`;
        const version = await tx<{ id: number }[]>`insert into shift_sheet_versions (version_number, uploaded_by_user_id, uploaded_at, valid_from, is_current) select coalesce(max(version_number), 0) + 1, ${user[0]!.id}, now(), now(), true from shift_sheet_versions returning id`;
        const range = await tx<{ id: number }[]>`insert into sector_shift_ranges (shift_sheet_version_id, sector_id, shift_name, starts_at, ends_at) values (${version[0]!.id}, ${sector[0]!.id}, 'Dia', '08:00', '16:00') returning id`;
        await tx`insert into employee_shift_assignments (shift_sheet_version_id, sector_id, shift_range_id, employee_id, day_of_week) values (${version[0]!.id}, ${sector[0]!.id}, ${range[0]!.id}, ${employee[0]!.id}, 4)`;
        const sectorQuestion = await tx<{ id: number }[]>`insert into questions (question_kind, scope, sector_id, is_nps, display_order, created_by_user_id, created_at, updated_at) values ('sector', 'sector_only', ${sector[0]!.id}, false, 1, ${user[0]!.id}, now(), now()) returning id`;
        const standardQuestion = await tx<{ id: number }[]>`insert into questions (question_kind, scope, sector_id, is_nps, display_order, created_by_user_id, created_at, updated_at) values ('standard', 'all_sectors', null, false, 1, ${user[0]!.id}, now(), now()) returning id`;
        const npsQuestion = await tx<{ id: number }[]>`insert into questions (question_kind, scope, sector_id, is_nps, display_order, created_by_user_id, created_at, updated_at) values ('standard', 'selected_sectors', null, true, 1, ${user[0]!.id}, now(), now()) returning id`;
        for (const [question, text] of [[sectorQuestion[0]!.id, "Setor"], [standardQuestion[0]!.id, "Padrão"], [npsQuestion[0]!.id, "NPS"]] as const) await tx`insert into question_versions (question_id, version_number, text, is_current, created_by_user_id, created_at) values (${question}, 1, ${text}, true, ${user[0]!.id}, now())`;
        await tx`insert into question_sector_assignments (question_id, sector_id, assignment_source, display_order, assigned_at, assigned_by_user_id) values (${standardQuestion[0]!.id}, ${sector[0]!.id}, 'global', 1, now(), ${user[0]!.id})`;
        await tx`insert into sector_nps_assignments (sector_id, question_id, assignment_source, assigned_at, assigned_by_user_id) values (${sector[0]!.id}, ${npsQuestion[0]!.id}, 'specific', now(), ${user[0]!.id})`;
        const service = new SubmissionService(new PostgresSubmissionRepository(tx as unknown as postgres.Sql), clock);
        const started = await service.start(sector[0]!.id, 4, "09:00");
        expect(started.questions).toHaveLength(3);
        const sectorItem = started.questions.find((question) => question.questionKind === "sector")!;
        await expect(service.answer(started.capability.sessionId, started.capability.token, { sessionQuestionId: sectorItem.sessionQuestionId!, status: "skipped", score: null })).resolves.toMatchObject({ status: "incomplete" });
        await expect(service.answer(started.capability.sessionId, started.capability.token, { sessionQuestionId: sectorItem.sessionQuestionId!, status: "answered", score: 5 })).resolves.toMatchObject({ status: "incomplete" });
        const answer = await tx<{ status: string; score: number }[]>`select status, score from submission_answers where session_question_id=${sectorItem.sessionQuestionId}`;
        expect(answer).toEqual([{ status: "answered", score: 5 }]);
      });
    } finally { await sql.end({ timeout: 5 }); }
  });
});
