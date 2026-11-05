import "dotenv/config";
import postgres from "postgres";
import { SubmissionService } from "../../src/modules/submissions/submission.service.js";
import { PostgresSubmissionRepository } from "../../src/modules/submissions/submission.repository.js";
import { testDatabaseUrl, usesIsolatedDatabase } from "../helpers/database.js";
import type { Clock } from "../../src/shared/core.js";

const testUrl = testDatabaseUrl();
const runtimeUrl = process.env.DATABASE_URL;
const describeIntegration = usesIsolatedDatabase(testUrl, runtimeUrl) ? describe : describe.skip;
const clock: Clock = { now: () => new Date("2026-01-01T12:00:00Z") };

describeIntegration("anonymous submissions dynamic global NPS integration", () => {
  it("resolves four sectors, preserves order and rolls back all fixtures", async () => {
    const sql = postgres(testUrl!, { max: 1 });
    try {
      await expect(sql.begin(async (tx) => {
        await tx`update questions set deleted_at = now() where is_nps = true and scope = 'all_sectors' and deleted_at is null`;
        const [user] = await tx<{ id: number }[]>`
          insert into users (role_id, full_name, email, password_hash, created_at, updated_at)
          values (1, 'NPS integration', ${`global-${Date.now()}@test.invalid`}, 'hash', now(), now())
          returning id`;
        const sectors: number[] = [];
        for (let index = 1; index <= 4; index += 1) {
          const [sector] = await tx<{ id: number }[]>`
            insert into sectors (code, name, created_at, updated_at)
            values (${`nps-global-${Date.now()}-${index}`}, ${`NPS sector ${index}`}, now(), now())
            returning id`;
          sectors.push(sector!.id);
        }

        const [sheet] = await tx<{ id: number }[]>`
          insert into shift_sheet_versions (version_number, uploaded_by_user_id, uploaded_at, valid_from, is_current)
          select coalesce(max(version_number), 0) + 1, ${user!.id}, now(), now(), false
          from shift_sheet_versions returning id`;
        await tx`update shift_sheet_versions set is_current = false where is_current = true`;
        await tx`update shift_sheet_versions set is_current = true where id = ${sheet!.id}`;
        for (const sectorId of sectors) {
          await tx`
            insert into sector_shift_ranges (shift_sheet_version_id, sector_id, shift_name, starts_at, ends_at)
            values (${sheet!.id}, ${sectorId}, 'Day', '08:00', '16:00')`;
        }
        await tx`
          insert into employee_shift_assignments (shift_sheet_version_id, sector_id, shift_range_id, employee_code, employee_name, day_of_week)
          select ${sheet!.id}, r.sector_id, r.id, concat('NPS-', r.id), 'Profissional', 4
          from sector_shift_ranges r
          where r.shift_sheet_version_id = ${sheet!.id}
        `;

        const sectorQuestions: number[] = [];
        for (const [index, sectorId] of sectors.entries()) {
          const [question] = await tx<{ id: number }[]>`
            insert into questions (question_kind, scope, sector_id, is_nps, display_order, created_by_user_id, created_at, updated_at)
            values ('sector', 'sector_only', ${sectorId}, false, 1, ${user!.id}, now(), now())
            returning id`;
          sectorQuestions.push(question!.id);
          await tx`
            insert into question_versions (question_id, version_number, text, is_current, created_by_user_id, created_at)
            values (${question!.id}, 1, ${`Sector question ${index + 1}`}, true, ${user!.id}, now())`;
        }

        const [standard] = await tx<{ id: number }[]>`
          insert into questions (question_kind, scope, sector_id, is_nps, display_order, created_by_user_id, created_at, updated_at)
          values ('standard', 'all_sectors', null, false, 2, ${user!.id}, now(), now())
          returning id`;
        await tx`
          insert into question_versions (question_id, version_number, text, is_current, created_by_user_id, created_at)
          values (${standard!.id}, 1, 'Standard question v1', true, ${user!.id}, now())`;
        for (const sectorId of sectors) {
          await tx`
            insert into question_sector_assignments (question_id, sector_id, assignment_source, display_order, assigned_at, assigned_by_user_id)
            values (${standard!.id}, ${sectorId}, 'global', 2, now(), ${user!.id})`;
        }

        const [global] = await tx<{ id: number }[]>`
          insert into questions (question_kind, scope, sector_id, is_nps, display_order, created_by_user_id, created_at, updated_at)
          values ('standard', 'all_sectors', null, true, 2147483647, ${user!.id}, now(), now())
          returning id`;
        const [specific] = await tx<{ id: number }[]>`
          insert into questions (question_kind, scope, sector_id, is_nps, display_order, created_by_user_id, created_at, updated_at)
          values ('standard', 'selected_sectors', null, true, 2147483647, ${user!.id}, now(), now())
          returning id`;
        await tx`
          insert into question_versions (question_id, version_number, text, is_current, created_by_user_id, created_at)
          values (${global!.id}, 1, 'Global NPS v1', true, ${user!.id}, now())`;
        await tx`
          insert into question_versions (question_id, version_number, text, is_current, created_by_user_id, created_at)
          values (${specific!.id}, 1, 'Specific NPS v1', true, ${user!.id}, now())`;

        const service = new SubmissionService(new PostgresSubmissionRepository(tx as unknown as postgres.Sql), clock);
        const globalSessions = [] as Awaited<ReturnType<typeof service.start>>[];
        for (const [index, sectorId] of sectors.entries()) {
          const session = await service.start(sectorId, 4, "09:00");
          globalSessions.push(session);
          expect(session.questions).toHaveLength(3);
          expect(
            session.questions.every((question) => question.sessionQuestionId > 0)
          ).toBe(true);
          expect(session.questions.map((question) => question.questionId)).toEqual([sectorQuestions[index], standard!.id, global!.id]);
          expect(session.questions.at(-1)).toMatchObject({ questionId: global!.id, isNps: true, position: 3 });
          expect(session.questions.filter((question) => question.isNps)).toHaveLength(1);
        }

        const originalSnapshot = await tx<{ questionId: number; questionVersionId: number; text: string }[]>`
          select sq.question_id as "questionId", sq.question_version_id as "questionVersionId", qv.text
          from submission_session_questions sq
          join question_versions qv on qv.id = sq.question_version_id
          where sq.session_id = ${globalSessions[0]!.capability.sessionId} and sq.question_id = ${global!.id}`;
        expect(originalSnapshot).toHaveLength(1);
        expect(originalSnapshot[0]!.text).toBe("Global NPS v1");

        await tx`update question_versions set is_current = false where question_id = ${global!.id} and is_current = true`;
        const [globalV2] = await tx<{ id: number }[]>`
          insert into question_versions (question_id, version_number, text, is_current, created_by_user_id, created_at)
          values (${global!.id}, 2, 'Global NPS v2', true, ${user!.id}, now()) returning id`;
        const changedSession = await service.start(sectors[0]!, 4, "09:00");
        expect(changedSession.questions.at(-1)).toMatchObject({ questionId: global!.id, questionVersionId: globalV2!.id, text: "Global NPS v2" });
        const preservedSnapshot = await tx<{ questionVersionId: number; text: string }[]>`
          select sq.question_version_id as "questionVersionId", qv.text
          from submission_session_questions sq
          join question_versions qv on qv.id = sq.question_version_id
          where sq.session_id = ${globalSessions[0]!.capability.sessionId} and sq.question_id = ${global!.id}`;
        expect(preservedSnapshot).toEqual([{ questionVersionId: originalSnapshot[0]!.questionVersionId, text: "Global NPS v1" }]);

        await tx`
          insert into sector_nps_assignments (sector_id, question_id, assignment_source, assigned_at, assigned_by_user_id)
          values (${sectors[3]}, ${specific!.id}, 'specific', now(), ${user!.id})`;
        const overridden = await service.start(sectors[3]!, 4, "09:00");
        expect(overridden.questions.at(-1)).toMatchObject({ questionId: specific!.id, isNps: true, position: 3 });
        await tx`update sector_nps_assignments set ended_at = now() where sector_id = ${sectors[3]} and ended_at is null`;
        const restored = await service.start(sectors[3]!, 4, "09:00");
        expect(restored.questions.at(-1)).toMatchObject({ questionId: global!.id, isNps: true, position: 3 });

        await tx`update questions set deleted_at = now() where id = ${global!.id}`;
        await expect(service.start(sectors[0]!, 4, "09:00")).rejects.toMatchObject({ code: "NPS_CONFIGURATION_CONFLICT", status: 409 });
        await tx`
          insert into sector_nps_assignments (sector_id, question_id, assignment_source, assigned_at, assigned_by_user_id)
          values (${sectors[3]}, ${specific!.id}, 'specific', now(), ${user!.id})`;
        await tx`update questions set deleted_at = now() where id = ${specific!.id}`;
        await expect(service.start(sectors[3]!, 4, "09:00")).rejects.toMatchObject({ code: "NPS_CONFIGURATION_CONFLICT", status: 409 });

        throw new Error("ROLLBACK_TEST");
      })).rejects.toThrow("ROLLBACK_TEST");
    } finally {
      await sql.end({ timeout: 5 });
    }
  });
});
