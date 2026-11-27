import { TvWallService } from "../../src/modules/analytics/tv-wall.service.js";
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
            values ('standard',${nps ? 'selected_sectors' : 'all_sectors'},${nps},${nps ? 2 : 1},${user!.id}) returning id`;
          const [v] = await db<{ id: number }[]>`insert into question_versions(question_id,version_number,text,is_current,created_by_user_id)
            values (${q!.id},1,'Fixture question',true,${user!.id}) returning id`;
          await db`insert into submission_form_questions(form_version_id,question_id,question_version_id,position,question_kind,is_nps,text)
            values (${form!.id},${q!.id},${v!.id},${nps ? 2 : 1},'standard',${nps},'Fixture question')`;
          ids.push(q!.id, v!.id);
        }
        await db`insert into sector_current_forms(sector_id,form_version_id) values (${sector!.id},${form!.id})
          on conflict(sector_id) do update set form_version_id=excluded.form_version_id`;
        const [session] = await db<{ id: string }[]>`insert into submission_sessions(sector_id,form_version_id,started_at,last_activity_at,capability_hash)
          values (${sector!.id},${form!.id},'2050-01-01T03:00:00Z','2050-01-01T03:00:00Z',decode(repeat('01',32),'hex')) returning id`;
        for (const [q, v, value] of [[ids[0]!,ids[1]!,5],[ids[2]!,ids[3]!,score]])
          await db`insert into submission_form_answers(session_id,form_version_id,question_id,question_version_id,status,score)
            values (${session!.id},${form!.id},${q},${v},'answered',${value})`;
        // Transitional data can contain both layouts. The pinned form is authoritative.
        const [shadow] = await db`insert into submission_session_questions(session_id,question_id,question_version_id,position,question_kind,is_nps)
          values (${session!.id},${ids[2]!},${ids[3]!},1,'standard',true) returning id`;
        await db`insert into submission_answers(session_question_id,status,score) values (${shadow!.id},'answered',0)`;
        const repo = new AnalyticsRepository(db);
        const filter = { from: '2050-01-01T03:00:00Z', to: '2050-01-02T03:00:00Z', sectorId: sector!.id };
        await db`update submission_sessions set expires_at=now()+interval '3 minutes' where id=${session!.id}`;
        const [page] = await db`insert into content_pages(slug,title) values (${crypto.randomUUID()},'Policy') returning id`;
        const [policy] = await db`insert into content_page_versions(page_id,version_number,content,created_by_user_id)
          values (${page!.id},1,'Consent',${user!.id}) returning id`;
        await db`insert into ombudsman_tickets(sector_id,ticket_type,body,accepted_policy_version_id,policy_accepted_at,occurred_at)
          values (${sector!.id},'compliment','Fixture',${policy!.id},now(),${filter.from})`;
        await db`set local role fhdod_api`;
        const data = await repo.dashboard(filter, null);
        expect(data.ombudsman).toMatchObject([{sector_id:sector!.id,tickets:1}]);
        expect((await repo.dashboard(filter,[sector!.id])).ombudsman).toEqual([]);
        expect(data.sessions).toMatchObject({ started: 1, complete: 0, incomplete: 1, inProgress:1, endedOrExpired:0, completionRate:0, nonCompletionRate:100 });
        expect((await repo.dashboard(filter,[])).sessions).toMatchObject({completionRate:null,nonCompletionRate:null});
        expect(data.nps).toMatchObject({ responses: 1, value: expected });
        expect(await repo.heatmap(filter,null)).toEqual([expect.objectContaining({sectorId:sector!.id,
          satisfactionMean:5,npsMean:score,positivePercentage:100,responses:1,npsResponses:1,started:1,completed:0,completionRate:0})]);
        expect(await repo.heatmap(filter,[])).toEqual([]);
        expect(await repo.questionDistribution(filter,null)).toMatchObject({sectorId:sector!.id,formVersionId:form!.id,
          questions:[expect.objectContaining({questionId:ids[0],questionVersionId:ids[1],mean:5,responses:1,skipped:0,
            distribution:[{score:1,responses:0},{score:2,responses:0},{score:3,responses:0},{score:4,responses:0},{score:5,responses:1}]})]});
        expect(await repo.criticalQuestions(filter,null,3,1)).toEqual([expect.objectContaining({sectorId:sector!.id,questionId:ids[0],mean:5,responses:1})]);
        expect(await repo.criticalQuestions(filter,null,5,5)).toEqual([]);
        expect(data.questions).toEqual(expect.arrayContaining([expect.objectContaining({ question_id: ids[0],question_version_id: ids[1],responses: 1,mean: 5 })]));
        expect(data.daily).toEqual([{ day: '2050-01-01', started: 1, complete: 0 }]);
        expect((await repo.dashboard({ ...filter, to: filter.from }, null)).nps).toMatchObject({ responses: 0, value: null });
        expect((await repo.dashboard(filter, [])).sessions).toMatchObject({ started: 0 });
        const service = new AnalyticsService(repo);
        await expect(service.dashboard({ userId:user!.id,sessionId:'test',role:'sector_manager',mustChangePassword:false },filter)).rejects.toMatchObject({ code:'FORBIDDEN' });
        const manager = { userId:user!.id,sessionId:'test',role:'sector_manager' as const,mustChangePassword:false };
        await expect(service.heatmap(manager,filter)).rejects.toMatchObject({code:'FORBIDDEN'});
        await expect(service.questionDistribution(manager,filter)).rejects.toMatchObject({code:'FORBIDDEN'});
        await expect(service.criticalQuestions(manager,filter,5)).rejects.toMatchObject({code:'FORBIDDEN'});
        await db`reset role`;
        await db`update submission_sessions set expires_at=now()-interval '1 second' where id=${session!.id}`;
        const [legacy] = await db<{id:string}[]>`insert into submission_sessions(sector_id,started_at,last_activity_at,capability_hash)
          values (${sector!.id},'2050-01-01T03:00:00Z','2050-01-01T03:00:00Z',decode(repeat('02',32),'hex')) returning id`;
        const [legacyQuestion] = await db<{id:number}[]>`insert into submission_session_questions(session_id,question_id,question_version_id,position,question_kind,is_nps)
          values (${legacy!.id},${ids[2]!},${ids[3]!},1,'standard',true) returning id`;
        await db`insert into submission_answers(session_question_id,status,score) values (${legacyQuestion!.id},'answered',9)`;
        await db`set local role fhdod_api`;
        const mixed = await repo.dashboard(filter,null);
        expect(mixed.sessions).toMatchObject({ started:2, incomplete:2, inProgress:0, endedOrExpired:1, unknownDeadline:1 });
        expect(mixed.nps).toMatchObject({ responses:2,value:score<=6 ? 0 : score<=8 ? 50 : 100 });
        await db`reset role`;
        const [other] = await db`insert into sectors(code,name) values (${crypto.randomUUID()},'Other sector') returning id`;
        // A second published version and a heavily unbalanced sector validate pooled NPS.
        const [nextForm] = await db`insert into submission_form_versions(sector_id,version_number,fingerprint)
          values (${other!.id},2,${crypto.randomUUID()}) returning id`;
        await db`insert into submission_form_questions(form_version_id,question_id,question_version_id,position,question_kind,is_nps,text)
          values (${nextForm!.id},${ids[2]!},${ids[3]!},1,'standard',true,'Fixture question')`;
        await db`insert into submission_form_questions(form_version_id,question_id,question_version_id,position,question_kind,is_nps,text)
          values (${nextForm!.id},${ids[0]!},${ids[1]!},2,'standard',false,'Fixture question')`;
        await db`insert into sector_current_forms(sector_id,form_version_id) values (${other!.id},${nextForm!.id})
          on conflict(sector_id) do update set form_version_id=excluded.form_version_id`;
        await db`with added as (
          insert into submission_sessions(sector_id,form_version_id,started_at,last_activity_at,ended_at,status,capability_hash)
          select ${other!.id},${nextForm!.id},'2050-01-01T04:00Z','2050-01-01T04:00Z','2050-01-01T04:01Z','complete',decode(repeat('03',32),'hex')
          from generate_series(1,18) returning id)
          insert into submission_form_answers(session_id,form_version_id,question_id,question_version_id,status,score)
          select id,${nextForm!.id},${ids[2]!},${ids[3]!},'answered',0 from added`;
        await db`insert into submission_form_answers(session_id,form_version_id,question_id,question_version_id,status,score)
          select id,${nextForm!.id},${ids[0]!},${ids[1]!},'answered',2 from submission_sessions where form_version_id=${nextForm!.id}`;
        await db`insert into submission_sessions(sector_id,started_at,last_activity_at,capability_hash)
          values (${other!.id},'2050-01-01T04:00Z','2050-01-01T04:00Z',decode(repeat('04',32),'hex'))`;
        await db`set local role fhdod_api`;
        const multiple = { from: filter.from, to: filter.to, sectorIds: [sector!.id, other!.id] };
        const [common] = await repo.globalQuestions(multiple, null, ids[0]);
        expect(common).toMatchObject({ responses:19, mean:expect.closeTo(41/19),
          sectors:[expect.objectContaining({sectorId:sector!.id,responses:1,mean:5}),expect.objectContaining({sectorId:other!.id,responses:18,mean:2})],
          distribution:[{score:2,responses:18,percentage:expect.closeTo(1800/19)},{score:5,responses:1,percentage:expect.closeTo(100/19)}],
        });
        const pooled = await repo.dashboard(multiple, null);
        expect(await repo.heatmap(multiple,null)).toEqual(expect.arrayContaining([
          expect.objectContaining({sectorId:sector!.id,satisfactionMean:5,responses:1,started:2,completed:0}),
          expect.objectContaining({sectorId:other!.id,satisfactionMean:2,npsMean:0,positivePercentage:0,responses:18,npsResponses:18,started:19,completed:18}),
        ]));
        expect((await repo.criticalQuestions(multiple,null,3,1)).map(row => row.sectorId)).toEqual([other!.id,sector!.id]);
        expect((await repo.criticalQuestions({...multiple,sectorIds:undefined,sectorId:other!.id},null,5,1)).map(row => row.sectorId)).toEqual([other!.id]);
        expect(pooled.sessions).toMatchObject({ started: 20, complete: 18, incomplete: 2, completionRate: 90, nonCompletionRate: 10 });
        expect(pooled.unclassifiedCompleted).toBe(18);
        expect(pooled.shifts).toEqual([]);
        expect(pooled.nps).toMatchObject({ responses: 20, value: score <= 6 ? -90 : score <= 8 ? -85 : -80 });
        await expect(service.dashboard({ userId:user!.id, sessionId:'test',role:'sector_manager',mustChangePassword:false },multiple))
          .rejects.toMatchObject({ code:'FORBIDDEN' });
        const tv = new TvWallService(db, repo);
        const settings = { periodDays: 1, refreshSeconds: 30, sectorIds: [other!.id], indicators: ["npsGroups", "completionRate", "nps"] as ("npsGroups" | "completionRate" | "nps")[] };
        expect(await tv.configure(settings)).toEqual(settings);
        const nextDay = new Date("2050-01-02T03:00:00Z");
        expect(await tv.display(nextDay)).toEqual({refreshSeconds:30,periodDays:1,indicators:[
          {id:"npsGroups",value:{promoters:0,passives:0,detractors:100}},{id:"completionRate",value:100},{id:"nps",value:-100},
        ]});
        // A second process updates the singleton while the display cache is warm.
        await new TvWallService(db,repo).configure({...settings,sectorIds:[other!.id,sector!.id]});
        expect((await tv.display(nextDay)).indicators.every(item => item.value===null)).toBe(true);
        expect((await tv.display(new Date("2050-01-02T02:59:59Z"))).indicators.every(item => item.value===null)).toBe(true);
        await expect(tv.configure({...settings,sectorIds:[2147483647]})).rejects.toMatchObject({code:"TV_WALL_SECTOR_INVALID"});
        await tv.configure({...settings,indicators:[],sectorIds:[]});
        expect(await tv.display(nextDay)).toEqual({refreshSeconds:30,periodDays:1,indicators:[]});
        expect(await repo.heatmap({from:'2048-01-01T00:00:00Z',to:'2048-01-02T00:00:00Z',sectorId:sector!.id},null))
          .toEqual([expect.objectContaining({sectorId:sector!.id,satisfactionMean:null,npsMean:null,
            positivePercentage:null,completionRate:null,responses:0,npsResponses:0,started:0,completed:0})]);
        await db`reset role`;
        const [olderVersion] = await db<{id:number}[]>`insert into question_versions(question_id,version_number,text,is_current,created_by_user_id)
          values (${ids[0]!},2,'Earlier wording',false,${user!.id}) returning id`;
        const [olderForm] = await db<{id:number}[]>`insert into submission_form_versions(sector_id,version_number,fingerprint)
          values (${sector!.id},2,${crypto.randomUUID()}) returning id`;
        await db`insert into submission_form_questions(form_version_id,question_id,question_version_id,position,question_kind,is_nps,text)
          values (${olderForm!.id},${ids[0]!},${olderVersion!.id},1,'standard',false,'Earlier wording')`;
        const [historical] = await db<{id:string}[]>`insert into submission_sessions(sector_id,form_version_id,started_at,last_activity_at,capability_hash)
          values (${sector!.id},${olderForm!.id},'2049-01-01T03:00:00Z','2049-01-01T03:00:00Z',decode(repeat('05',32),'hex')) returning id`;
        await db`insert into submission_form_answers(session_id,form_version_id,question_id,question_version_id,status,score)
          values (${historical!.id},${olderForm!.id},${ids[0]!},${olderVersion!.id},'answered',1)`;
        await db`set local role fhdod_api`;
        const historicalFilter = {from:'2049-01-01T00:00:00Z',to:'2050-01-02T03:00:00Z',sectorId:sector!.id};
        expect((await repo.questionDistribution(historicalFilter,null))?.questions[0]).toMatchObject({
          questionVersionId:ids[1],responses:1,mean:5,distribution:[
            {score:1,responses:0},{score:2,responses:0},{score:3,responses:0},{score:4,responses:0},{score:5,responses:1}],
        });
        expect(await repo.heatmap(historicalFilter,null)).toEqual([expect.objectContaining({
          sectorId:sector!.id,responses:2,satisfactionMean:3,started:3,
        })]);
        throw rollback;
      })).rejects.toBe(rollback);
    } finally { await sql.end({ timeout: 5 }); }
  });

  it("counts skipped-only sessions in participation metrics without treating them as ratings", async () => {
    await assertDisposableTestDatabase(url!, runtime!);
    const sql = postgres(url!, { max: 1 });
    const rollback = new Error("rollback");
    try {
      await expect(sql.begin(async tx => {
        const db = tx as unknown as postgres.Sql;
        const [user] = await db<{ id: number }[]>`insert into users(role_id,full_name,email,password_hash)
          select id,'Skipped analytics fixture',${`analytics-skipped-${crypto.randomUUID()}@test.invalid`},'not-a-login-hash' from roles where code='superuser' returning id`;
        const [sector] = await db<{ id: number }[]>`insert into sectors(code,name) values (${crypto.randomUUID()},'Skipped analytics fixture') returning id`;
        const [form] = await db<{ id: number }[]>`insert into submission_form_versions(sector_id,version_number,fingerprint) values (${sector!.id},1,${crypto.randomUUID()}) returning id`;
        const [common] = await db<{ id: number }[]>`insert into questions(question_kind,scope,is_nps,display_order,created_by_user_id)
          values ('standard','selected_sectors',false,1,${user!.id}) returning id`;
        const [commonVersion] = await db<{ id: number }[]>`insert into question_versions(question_id,version_number,text,is_current,created_by_user_id)
          values (${common!.id},1,'Common',true,${user!.id}) returning id`;
        const [optional] = await db<{ id: number }[]>`insert into questions(question_kind,scope,is_nps,display_order,created_by_user_id)
          values ('sector','selected_sectors',false,2,${user!.id}) returning id`;
        const [optionalVersion] = await db<{ id: number }[]>`insert into question_versions(question_id,version_number,text,is_current,created_by_user_id)
          values (${optional!.id},1,'Optional',true,${user!.id}) returning id`;
        for (const [question, version, position, kind] of [[common!.id, commonVersion!.id, 1, 'standard'], [optional!.id, optionalVersion!.id, 2, 'sector']])
          await db`insert into submission_form_questions(form_version_id,question_id,question_version_id,position,question_kind,is_nps,text)
            values (${form!.id},${question},${version},${position},${kind},false,'Fixture')`;
        const [rated] = await db<{ id: string }[]>`insert into submission_sessions(sector_id,form_version_id,started_at,last_activity_at,status,capability_hash)
          values (${sector!.id},${form!.id},'2051-01-01T03:00:00Z','2051-01-01T03:00:00Z','incomplete',decode(repeat('11',32),'hex')) returning id`;
        await db`insert into submission_form_answers(session_id,form_version_id,question_id,question_version_id,status,score)
          values (${rated!.id},${form!.id},${common!.id},${commonVersion!.id},'answered',4)`;
        const [skipped] = await db<{ id: string }[]>`insert into submission_sessions(sector_id,form_version_id,started_at,last_activity_at,status,capability_hash)
          values (${sector!.id},${form!.id},'2051-01-01T03:01:00Z','2051-01-01T03:01:00Z','incomplete',decode(repeat('12',32),'hex')) returning id`;
        await db`insert into submission_form_answers(session_id,form_version_id,question_id,question_version_id,status,score)
          values (${skipped!.id},${form!.id},${optional!.id},${optionalVersion!.id},'skipped',null)`;
        await db`set local role fhdod_api`;
        const repo = new AnalyticsRepository(db);
        const filter = { from: '2051-01-01T03:00:00Z', to: '2051-01-01T04:00:00Z', sectorId: sector!.id };
        await expect(repo.dashboard(filter, null)).resolves.toMatchObject({
          sessions: { started: 2, complete: 0, incomplete: 2, completionRate: 0, nonCompletionRate: 100 },
          nps: { responses: 0, value: null },
        });
        await expect(repo.heatmap(filter, null)).resolves.toEqual([expect.objectContaining({
          sectorId: sector!.id, started: 2, completed: 0, responses: 1, npsResponses: 0,
          satisfactionMean: 4, npsMean: null, completionRate: 0,
        })]);
        throw rollback;
      })).rejects.toBe(rollback);
    } finally { await sql.end({ timeout: 5 }); }
  });
});
