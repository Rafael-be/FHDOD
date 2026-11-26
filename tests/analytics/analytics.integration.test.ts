import postgres from "postgres";
import { AnalyticsRepository } from "../../src/modules/analytics/analytics.repository.js";
import { AnalyticsService } from "../../src/modules/analytics/analytics.service.js";
import { assertDisposableTestDatabase, testDatabaseUrl, usesIsolatedDatabase } from "../helpers/database.js";

const url = testDatabaseUrl(), runtime = process.env.DATABASE_URL;
const integration = usesIsolatedDatabase(url, runtime) ? describe : describe.skip;
integration("analytics on disposable PostgreSQL", () => {
  it.each([[10, 100], [5, -100], [8, 0]])("calculates NPS score %i as %i without multiplying sessions", async (score, expected) => {
    await assertDisposableTestDatabase(url!, runtime!);
    const sql = postgres(url!, { max: 1 });
    const rollback = new Error("rollback");
    try {
      await expect(sql.begin(async tx => {
        const db = tx as unknown as postgres.Sql;
        const [user] = await db<{ id: number }[]>`insert into users(role_id,full_name,email,password_hash)
          select id,'Analytics fixture',${`analytics-${crypto.randomUUID()}@test.invalid`},'not-a-login-hash' from roles where code='superuser' returning id`;
        const [sector] = await db<{ id: number }[]>`insert into sectors(code,name) values (${crypto.randomUUID()},'Analytics fixture') returning id`;
        const [form] = await db<{ id: number }[]>`insert into submission_form_versions(sector_id,version_number,fingerprint) values (${sector!.id},1,${crypto.randomUUID()}) returning id`;
        const ids: number[] = [];
        for (const nps of [false, true]) {
          const [q] = await db<{ id: number }[]>`insert into questions(question_kind,scope,is_nps,display_order,created_by_user_id)
            values ('standard','selected_sectors',${nps},${nps ? 2 : 1},${user!.id}) returning id`;
          const [v] = await db<{ id: number }[]>`insert into question_versions(question_id,version_number,text,is_current,created_by_user_id)
            values (${q!.id},1,'Fixture question',true,${user!.id}) returning id`;
          await db`insert into submission_form_questions(form_version_id,question_id,question_version_id,position,question_kind,is_nps,text)
            values (${form!.id},${q!.id},${v!.id},${nps ? 2 : 1},'standard',${nps},'Fixture question')`;
          ids.push(q!.id, v!.id);
        }
        const [session] = await db<{ id: string }[]>`insert into submission_sessions(sector_id,form_version_id,started_at,last_activity_at,capability_hash)
          values (${sector!.id},${form!.id},'2050-01-01T03:00:00Z','2050-01-01T03:00:00Z',decode(repeat('01',32),'hex')) returning id`;
        for (const [q, v, value] of [[ids[0]!,ids[1]!,5],[ids[2]!,ids[3]!,score]])
          await db`insert into submission_form_answers(session_id,form_version_id,question_id,question_version_id,status,score)
            values (${session!.id},${form!.id},${q},${v},'answered',${value})`;
        const repo = new AnalyticsRepository(db);
        const filter = { from: '2050-01-01T03:00:00Z', to: '2050-01-02T03:00:00Z', sectorId: sector!.id };
        await db`set local role fhdod_api`;
        const data = await repo.dashboard(filter, null);
        expect(data.sessions).toMatchObject({ started: 1, complete: 0, incomplete: 1 });
        expect(data.nps).toMatchObject({ responses: 1, value: expected });
        expect(data.questions).toEqual(expect.arrayContaining([expect.objectContaining({ question_id: ids[0],question_version_id: ids[1],responses: 1,mean: 5 })]));
        expect(data.daily).toEqual([{ day: '2050-01-01', started: 1, complete: 0 }]);
        expect((await repo.dashboard({ ...filter, to: filter.from }, null)).nps).toMatchObject({ responses: 0, value: null });
        expect((await repo.dashboard(filter, [])).sessions).toMatchObject({ started: 0 });
        const service = new AnalyticsService(repo);
        await expect(service.dashboard({ userId:user!.id,sessionId:'test',role:'sector_manager',mustChangePassword:false },filter)).rejects.toMatchObject({ code:'FORBIDDEN' });
        await db`reset role`;
        const [legacy] = await db<{id:string}[]>`insert into submission_sessions(sector_id,started_at,last_activity_at,capability_hash)
          values (${sector!.id},'2050-01-01T03:00:00Z','2050-01-01T03:00:00Z',decode(repeat('02',32),'hex')) returning id`;
        const [legacyQuestion] = await db<{id:number}[]>`insert into submission_session_questions(session_id,question_id,question_version_id,position,question_kind,is_nps)
          values (${legacy!.id},${ids[2]!},${ids[3]!},1,'standard',true) returning id`;
        await db`insert into submission_answers(session_question_id,status,score) values (${legacyQuestion!.id},'answered',9)`;
        await db`set local role fhdod_api`;
        const mixed = await repo.dashboard(filter,null);
        expect(mixed.sessions).toMatchObject({ started:2, incomplete:2 });
        expect(mixed.nps).toMatchObject({ responses:2,value:score<=6 ? 0 : score<=8 ? 50 : 100 });
        await db`reset role`;
        const [other] = await db`insert into sectors(code,name) values (${crypto.randomUUID()},'Other sector') returning id`;
        // A second published version and a heavily unbalanced sector validate pooled NPS.
        const [nextForm] = await db`insert into submission_form_versions(sector_id,version_number,fingerprint)
          values (${other!.id},2,${crypto.randomUUID()}) returning id`;
        await db`insert into submission_form_questions(form_version_id,question_id,question_version_id,position,question_kind,is_nps,text)
          values (${nextForm!.id},${ids[2]!},${ids[3]!},1,'standard',true,'Fixture question')`;
        await db`with added as (
          insert into submission_sessions(sector_id,form_version_id,started_at,last_activity_at,ended_at,status,capability_hash)
          select ${other!.id},${nextForm!.id},'2050-01-01T04:00Z','2050-01-01T04:00Z','2050-01-01T04:01Z','complete',decode(repeat('03',32),'hex')
          from generate_series(1,18) returning id)
          insert into submission_form_answers(session_id,form_version_id,question_id,question_version_id,status,score)
          select id,${nextForm!.id},${ids[2]!},${ids[3]!},'answered',0 from added`;
        await db`insert into submission_sessions(sector_id,started_at,last_activity_at,capability_hash)
          values (${other!.id},'2050-01-01T04:00Z','2050-01-01T04:00Z',decode(repeat('04',32),'hex'))`;
        await db`set local role fhdod_api`;
        const multiple = { from: filter.from, to: filter.to, sectorIds: [sector!.id, other!.id] };
        const pooled = await repo.dashboard(multiple, null);
        expect(pooled.sessions).toMatchObject({ started: 20, complete: 18, incomplete: 2, completionRate: 90, nonCompletionRate: 10 });
        expect(pooled.nps).toMatchObject({ responses: 20, value: score <= 6 ? -90 : score <= 8 ? -85 : -80 });
        await expect(service.dashboard({ userId:user!.id, sessionId:'test',role:'sector_manager',mustChangePassword:false },multiple))
          .rejects.toMatchObject({ code:'FORBIDDEN' });
        throw rollback;
      })).rejects.toBe(rollback);
    } finally { await sql.end({ timeout: 5 }); }
  });
});
