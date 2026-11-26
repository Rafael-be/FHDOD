import "dotenv/config";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { PostgresShiftSheetRepository } from "../../src/modules/shifts/shift-sheet.repository.js";
import { PostgresSubmissionRepository } from "../../src/modules/submissions/submission.repository.js";
import { assertDisposableTestDatabase, testDatabaseUrl, usesIsolatedDatabase } from "../helpers/database.js";
import { publishEffectiveForm } from "../helpers/publish-form.js";

const adminUrl = testDatabaseUrl();
const runtimeUrl = process.env.DATABASE_URL;
const describeIntegration = usesIsolatedDatabase(adminUrl, runtimeUrl) ? describe : describe.skip;

describeIntegration("Phase 3 runtime RLS contract", () => {
  async function currentVersionIds(admin: postgres.Sql): Promise<number[]> {
    const rows = await admin<{ id: number }[]>`
      select id from shift_sheet_versions where is_current = true order by id
    `;
    return rows.map((row) => row.id);
  }

  async function restoreCurrentVersions(admin: postgres.Sql, ids: number[]): Promise<void> {
    if (ids.length) {
      await admin`update shift_sheet_versions set is_current = true where id = any(${ids})`;
    }
  }

  it("allows only the upload and submission operations used by fhdod_api", async () => {
    await assertDisposableTestDatabase(adminUrl!, runtimeUrl!);
    const admin = postgres(adminUrl!, { max: 1 });
    const runtime = postgres(runtimeUrl!, { max: 1 });
    const suffix = randomUUID().slice(0, 8);
    const now = new Date("2026-01-01T12:00:00.000Z");
    let sectorId = 0;
    let userId = 0;
    let questionId = 0;
    let commonQuestionId = 0;
    let formVersionId = 0;
    let versionId = 0;
    let fixtureCurrentVersionId = 0;
    let originalCurrentVersionIds: number[] = [];
    let sessionId = "";

    try {
      originalCurrentVersionIds = await currentVersionIds(admin);
      if (originalCurrentVersionIds.length) {
        await admin`update shift_sheet_versions set is_current = false where id = any(${originalCurrentVersionIds})`;
      }
      const original = await admin<{ id: number }[]>`
        insert into shift_sheet_versions (version_number, uploaded_at, valid_from, is_current)
        select coalesce(max(version_number), 0) + 1, now(), now(), true
        from shift_sheet_versions
        returning id
      `;
      fixtureCurrentVersionId = original[0]!.id;
      const user = await admin<{ id: number }[]>`insert into users (role_id, full_name, email, password_hash, created_at, updated_at) values (1, ${`RLS ${suffix}`}, ${`rls-${suffix}@test.invalid`}, 'hash', now(), now()) returning id`;
      userId = user[0]!.id;
      const sector = await admin<{ id: number }[]>`insert into sectors (code, name, created_by_user_id, created_at, updated_at) values (${`rls-${suffix}`}, 'Setor RLS', ${userId}, now(), now()) returning id`;
      sectorId = sector[0]!.id;
      const question = await admin<{ id: number }[]>`insert into questions (question_kind, scope, sector_id, is_nps, display_order, created_by_user_id, created_at, updated_at) values ('standard', 'selected_sectors', null, true, 2147483647, ${userId}, now(), now()) returning id`;
      questionId = question[0]!.id;
      await admin`insert into question_versions (question_id, version_number, text, is_current, created_by_user_id, created_at) values (${questionId}, 1, 'NPS RLS', true, ${userId}, now())`;
      await admin`insert into sector_nps_assignments (sector_id, question_id, assignment_source, assigned_at, assigned_by_user_id) values (${sectorId}, ${questionId}, 'specific', now(), ${userId})`;
      const common = await admin<{ id: number }[]>`insert into questions (question_kind, scope, sector_id, is_nps, display_order, created_by_user_id, created_at, updated_at) values ('standard', 'selected_sectors', null, false, 1, ${userId}, now(), now()) returning id`;
      commonQuestionId = common[0]!.id;
      await admin`insert into question_versions (question_id, version_number, text, is_current, created_by_user_id, created_at) values (${commonQuestionId}, 1, 'Atendimento RLS', true, ${userId}, now())`;
      await admin`insert into question_sector_assignments(question_id,sector_id,assignment_source,display_order,assigned_by_user_id)
        values (${commonQuestionId},${sectorId},'selected',1,${userId})`;
      formVersionId = await publishEffectiveForm(admin, sectorId, userId);

      const shifts = new PostgresShiftSheetRepository(runtime);
      const activeSectors = await shifts.sectors();
      const rows = activeSectors.flatMap((activeSector) => Array.from({ length: 7 }, (_, index) => {
        const dayOfWeek = index + 1;
        const isFixtureSector = activeSector.code === `rls-${suffix}`;
        const open = isFixtureSector && dayOfWeek === 4;
        return {
          codigo_setor: activeSector.code,
          nome_setor: activeSector.name,
          nome_turno: open ? "Dia" : "FECHADO",
          hora_inicio: open ? "08:00" : "00:00",
          hora_fim: open ? "16:00" : "00:00",
          dia_semana_iso: String(dayOfWeek),
          line: dayOfWeek + 1,
          startsAt: open ? 480 : 0,
          endsAt: open ? 960 : 0,
          dayOfWeek,
          closed: !open,
        };
      }));
      const sheet = await shifts.transaction((repository) => repository.replaceCurrentSheet(rows, now));
      versionId = sheet.versionId;
      await shifts.recordUploadAttempt(userId, "accepted", versionId, []);

      const submissions = new PostgresSubmissionRepository(runtime);
      sessionId = randomUUID();
      const snapshot = await submissions.transaction((repository) => repository.createSessionSnapshot({
        sessionId,
        sectorId,
        dayOfWeek: 4,
        previousDayOfWeek: 3,
        localTime: "09:00",
        now,
      }));
      expect(snapshot.questions).toHaveLength(2);
      formVersionId = snapshot.session.formVersionId;
      const standardQuestion = snapshot.questions.find((item) => !item.isNps)!;
      await submissions.transaction((repository) => repository.saveAnswer(sessionId, {
        questionId: standardQuestion.questionId,
        questionVersionId: standardQuestion.questionVersionId,
        status: "answered",
        score: 5,
      }, now));
      const npsQuestion = snapshot.questions.find((item) => item.isNps)!;
      await submissions.transaction((repository) => repository.saveAnswer(sessionId, {
        questionId: npsQuestion.questionId,
        questionVersionId: npsQuestion.questionVersionId,
        status: "answered",
        score: 10,
      }, now));

      await expect(runtime`delete from submission_form_answers where false`).rejects.toMatchObject({ code: "42501" });
    } finally {
      try {
      if (sessionId) {
        await admin`delete from dashboard_dirty_groups where sector_id = ${sectorId}`;
        await admin`delete from submission_form_answers where session_id = ${sessionId}`;
        await admin`delete from submission_sessions where id = ${sessionId}`;
      }
      if (formVersionId) {
        await admin`delete from sector_current_forms where sector_id=${sectorId}`;
        await admin`delete from submission_form_questions where form_version_id = ${formVersionId}`;
        await admin`delete from submission_form_versions where id = ${formVersionId}`;
      }
      if (versionId) {
        await admin`delete from shift_upload_attempts where resulting_version_id = ${versionId}`;
        await admin`delete from sector_shift_ranges where shift_sheet_version_id = ${versionId}`;
        await admin`delete from sector_shift_days where shift_sheet_version_id = ${versionId}`;
        await admin`delete from shift_sheet_versions where id = ${versionId}`;
      }
      if (fixtureCurrentVersionId) await admin`delete from shift_sheet_versions where id = ${fixtureCurrentVersionId}`;
      if (questionId) {
        await admin`delete from sector_nps_assignments where question_id = ${questionId}`;
        await admin`delete from question_versions where question_id = ${questionId}`;
        await admin`delete from questions where id = ${questionId}`;
      }
      if (commonQuestionId) {
        await admin`delete from question_sector_assignments where question_id=${commonQuestionId}`;
        await admin`delete from question_versions where question_id = ${commonQuestionId}`;
        await admin`delete from questions where id = ${commonQuestionId}`;
      }
      if (sectorId) await admin`delete from sectors where id = ${sectorId}`;
      if (userId) await admin`delete from users where id = ${userId}`;
      // Format 2 validates all active sectors; remove the fixture before restoring its predecessor.
      await restoreCurrentVersions(admin, originalCurrentVersionIds);
      await expect(currentVersionIds(admin)).resolves.toEqual(originalCurrentVersionIds);
      } finally { await Promise.all([admin.end({ timeout: 5 }), runtime.end({ timeout: 5 })]); }
    }
  });

  it("restores the exact current version state after an interrupted setup", async () => {
    await assertDisposableTestDatabase(adminUrl!, runtimeUrl!);
    const admin = postgres(adminUrl!, { max: 1 });
    const originalCurrentVersionIds = await currentVersionIds(admin);
    let fixtureVersionId = 0;

    try {
      if (originalCurrentVersionIds.length) {
        await admin`update shift_sheet_versions set is_current = false where id = any(${originalCurrentVersionIds})`;
      }
      const fixture = await admin<{ id: number }[]>`
        insert into shift_sheet_versions (version_number, uploaded_at, valid_from, is_current)
        select coalesce(max(version_number), 0) + 1, now(), now(), true
        from shift_sheet_versions
        returning id
      `;
      fixtureVersionId = fixture[0]!.id;
      throw new Error("INTERRUPTED_RLS_SETUP");
    } catch (error) {
      expect(error).toMatchObject({ message: "INTERRUPTED_RLS_SETUP" });
    } finally {
      if (fixtureVersionId) await admin`delete from shift_sheet_versions where id = ${fixtureVersionId}`;
      await restoreCurrentVersions(admin, originalCurrentVersionIds);
      await expect(currentVersionIds(admin)).resolves.toEqual(originalCurrentVersionIds);
      await admin.end({ timeout: 5 });
    }
  });
});
