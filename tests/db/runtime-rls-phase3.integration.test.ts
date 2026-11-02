import "dotenv/config";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { PostgresShiftSheetRepository } from "../../src/modules/shifts/shift-sheet.repository.js";
import { PostgresSubmissionRepository } from "../../src/modules/submissions/submission.repository.js";
import { assertDisposableTestDatabase, testDatabaseUrl, usesIsolatedDatabase } from "../helpers/database.js";

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
    let employeeId = 0;
    let userId = 0;
    let questionId = 0;
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
      const employee = await admin<{ id: number }[]>`insert into employees (employee_code, full_name) values (${`EMP-${suffix}`}, 'Funcionário RLS') returning id`;
      employeeId = employee[0]!.id;
      const question = await admin<{ id: number }[]>`insert into questions (question_kind, scope, sector_id, is_nps, display_order, created_by_user_id, created_at, updated_at) values ('standard', 'selected_sectors', null, true, 2147483647, ${userId}, now(), now()) returning id`;
      questionId = question[0]!.id;
      await admin`insert into question_versions (question_id, version_number, text, is_current, created_by_user_id, created_at) values (${questionId}, 1, 'NPS RLS', true, ${userId}, now())`;
      await admin`insert into sector_nps_assignments (sector_id, question_id, assignment_source, assigned_at, assigned_by_user_id) values (${sectorId}, ${questionId}, 'specific', now(), ${userId})`;

      const shifts = new PostgresShiftSheetRepository(runtime);
      const sheet = await shifts.transaction((repository) => repository.replaceCurrentSheet([{
        codigo_setor: `rls-${suffix}`,
        nome_setor: "Setor RLS",
        nome_turno: "Dia",
        hora_inicio: "08:00",
        hora_fim: "16:00",
        codigo_funcionario: `EMP-${suffix}`,
        nome_funcionario: "Funcionário RLS",
        dia_semana_iso: "4",
        line: 2,
        startsAt: 480,
        endsAt: 960,
        dayOfWeek: 4,
      }], now));
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
      expect(snapshot.questions).toHaveLength(1);
      await submissions.transaction((repository) => repository.saveAnswer(sessionId, {
        sessionQuestionId: snapshot.questions[0]!.sessionQuestionId,
        status: "answered",
        score: 10,
      }, now));

      await expect(runtime`delete from submission_answers where false`).rejects.toMatchObject({ code: "42501" });
    } finally {
      if (sessionId) {
        await admin`delete from dashboard_dirty_groups where sector_id = ${sectorId}`;
        await admin`delete from submission_answers where session_question_id in (select id from submission_session_questions where session_id = ${sessionId})`;
        await admin`delete from submission_session_questions where session_id = ${sessionId}`;
        await admin`delete from submission_sessions where id = ${sessionId}`;
      }
      if (versionId) {
        await admin`delete from shift_upload_attempts where resulting_version_id = ${versionId}`;
        await admin`delete from employee_shift_assignments where shift_sheet_version_id = ${versionId}`;
        await admin`delete from sector_shift_ranges where shift_sheet_version_id = ${versionId}`;
        await admin`delete from shift_sheet_versions where id = ${versionId}`;
      }
      if (fixtureCurrentVersionId) await admin`delete from shift_sheet_versions where id = ${fixtureCurrentVersionId}`;
      await restoreCurrentVersions(admin, originalCurrentVersionIds);
      await expect(currentVersionIds(admin)).resolves.toEqual(originalCurrentVersionIds);
      if (questionId) {
        await admin`delete from sector_nps_assignments where question_id = ${questionId}`;
        await admin`delete from question_versions where question_id = ${questionId}`;
        await admin`delete from questions where id = ${questionId}`;
      }
      if (employeeId) await admin`delete from employees where id = ${employeeId}`;
      if (sectorId) await admin`delete from sectors where id = ${sectorId}`;
      if (userId) await admin`delete from users where id = ${userId}`;
      await Promise.all([admin.end({ timeout: 5 }), runtime.end({ timeout: 5 })]);
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
