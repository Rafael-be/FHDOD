import "dotenv/config";
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { usesIsolatedDatabase } from "../helpers/database.js";

const testUrl = process.env.DATABASE_URL_TEST;
const runtimeUrl = process.env.DATABASE_URL;
const describeIntegration = usesIsolatedDatabase(testUrl, runtimeUrl) ? describe : describe.skip;

describeIntegration("submission answer concurrency integration", () => {
  it("keeps one current answer when two writes race", async () => {
    const sql = postgres(testUrl!, { max: 4 });
    const suffix = randomUUID().slice(0, 8);
    try {
      const user = await sql<{ id: number }[]>`insert into users (role_id, full_name, email, password_hash, created_at, updated_at) values (1, 'Concorrência', ${`race-${suffix}@test.invalid`}, 'hash', now(), now()) returning id`;
      const sector = await sql<{ id: number }[]>`insert into sectors (code, name, created_at, updated_at) values (${`race-${suffix}`}, 'Setor concorrência', now(), now()) returning id`;
      const version = await sql<{ id: number }[]>`insert into shift_sheet_versions (version_number, uploaded_by_user_id, uploaded_at, valid_from, is_current) select coalesce(max(version_number), 0) + 1, ${user[0]!.id}, now(), now(), false from shift_sheet_versions returning id`;
      const range = await sql<{ id: number }[]>`insert into sector_shift_ranges (shift_sheet_version_id, sector_id, shift_name, starts_at, ends_at) values (${version[0]!.id}, ${sector[0]!.id}, 'Race', '08:00', '16:00') returning id`;
      const sessionId = randomUUID();
      await sql`insert into submission_sessions (id, sector_id, shift_sheet_version_id, shift_range_id, started_at, last_activity_at, status) values (${sessionId}, ${sector[0]!.id}, ${version[0]!.id}, ${range[0]!.id}, now(), now(), 'incomplete')`;
      const question = await sql<{ id: number }[]>`insert into questions (question_kind, scope, sector_id, is_nps, display_order, created_by_user_id, created_at, updated_at) values ('sector', 'sector_only', ${sector[0]!.id}, false, 1, ${user[0]!.id}, now(), now()) returning id`;
      const questionVersion = await sql<{ id: number }[]>`insert into question_versions (question_id, version_number, text, is_current, created_by_user_id, created_at) values (${question[0]!.id}, 1, 'Race', true, ${user[0]!.id}, now()) returning id`;
      const item = await sql<{ id: number }[]>`insert into submission_session_questions (session_id, question_id, question_version_id, position, question_kind, is_nps, created_at) values (${sessionId}, ${question[0]!.id}, ${questionVersion[0]!.id}, 1, 'sector', false, now()) returning id`;
      await Promise.all([1, 5].map((score) => sql`insert into submission_answers (session_question_id, status, score, created_at, updated_at) values (${item[0]!.id}, 'answered', ${score}, now(), now()) on conflict (session_question_id) do update set score = excluded.score, updated_at = excluded.updated_at`));
      const answers = await sql<{ count: number; score: number }[]>`select count(*)::int as count, max(score)::int as score from submission_answers where session_question_id=${item[0]!.id}`;
      expect(answers).toEqual([{ count: 1, score: expect.any(Number) }]);
    } finally {
      await sql`delete from submission_answers where session_question_id in (select id from submission_session_questions where session_id in (select id from submission_sessions where sector_id in (select id from sectors where code=${`race-${suffix}`})))`;
      await sql`delete from submission_session_questions where session_id in (select id from submission_sessions where sector_id in (select id from sectors where code=${`race-${suffix}`}))`;
      await sql`delete from submission_sessions where sector_id in (select id from sectors where code=${`race-${suffix}`})`;
      await sql`delete from sector_shift_ranges where sector_id in (select id from sectors where code=${`race-${suffix}`})`;
      await sql`delete from shift_sheet_versions where id in (select id from shift_sheet_versions where uploaded_by_user_id in (select id from users where email=${`race-${suffix}@test.invalid`}))`;
      await sql`delete from question_versions where question_id in (select id from questions where sector_id in (select id from sectors where code=${`race-${suffix}`}))`;
      await sql`delete from questions where sector_id in (select id from sectors where code=${`race-${suffix}`})`;
      await sql`delete from sectors where code=${`race-${suffix}`}`;
      await sql`delete from users where email=${`race-${suffix}@test.invalid`}`;
      await sql.end({ timeout: 5 });
    }
  });
});
