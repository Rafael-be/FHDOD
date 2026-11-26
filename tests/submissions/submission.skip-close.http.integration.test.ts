import { randomBytes, randomUUID } from "node:crypto";
import postgres from "postgres";
import request from "supertest";
import { createApp } from "../../src/app.js";
import type { AppConfig } from "../../src/config/env.js";
import { AnalyticsRepository } from "../../src/modules/analytics/analytics.repository.js";
import { AnalyticsService } from "../../src/modules/analytics/analytics.service.js";
import type { AuthService } from "../../src/modules/auth/auth.service.js";
import { PostgresSubmissionRepository } from "../../src/modules/submissions/submission.repository.js";
import { SubmissionService } from "../../src/modules/submissions/submission.service.js";
import { testDatabaseUrl, usesIsolatedDatabase } from "../helpers/database.js";
import { createFormFixture } from "../helpers/form-fixture.js";

const adminUrl = testDatabaseUrl();
const runtimeUrl = process.env.DATABASE_URL;
const integration = usesIsolatedDatabase(adminUrl, runtimeUrl) ? describe : describe.skip;

integration("public skip and voluntary close through HTTP", () => {
  it("keeps the optional skip immutable, then counts a rated, voluntarily closed attempt as incomplete", async () => {
    const fixture = await createFormFixture(adminUrl!, runtimeUrl!);
    const db = postgres(runtimeUrl!, { max: 2 });
    try {
      const clock = { now: () => new Date("2050-01-01T12:00:00Z") };
      const app = createApp({NODE_ENV:"test"} as AppConfig, {
        authService: {authenticate:async()=>({role:"sector_manager",userId:fixture.managerId,mustChangePassword:false})} as unknown as AuthService,
        submissionService: new SubmissionService(new PostgresSubmissionRepository(db), clock),
        analyticsService: new AnalyticsService(new AnalyticsRepository(db)),
      });
      const client = request(app);
      const sector = `/api/public/sectors/${fixture.sectorId}`;
      const { body } = await client.get(sector + "/current-form").expect(200);
      const [optional, required, nps] = body.data.questions;
      expect(optional.required).toBe(false);
      const skip = {questionId:optional.questionId,questionVersionId:optional.questionVersionId,status:"skipped",score:null};
      const id = randomUUID(), token = randomBytes(32).toString("base64url");
      const session = `/api/public/submissions/${id}`;
      const initial = {formVersionId:body.data.formVersionId,attemptId:id,capability:token,answer:skip};
      await client.post(sector + "/submissions").send(initial).expect(201)
        .expect(({body})=>expect(body.data.answer).toMatchObject({answered:false,status:"incomplete"}));
      await client.post(sector + "/submissions").send(initial).expect(200)
        .expect(({body})=>expect(body.data.replayed).toBe(true));
      const answer = (input: object) => client.post(session + "/answers").set("x-session-capability",token).send(input);
      await answer(skip).expect(200).expect(({body})=>expect(body.data).toMatchObject({answered:false,replayed:true}));
      await answer({...skip,status:"answered",score:1}).expect(409)
        .expect(({body})=>expect(body.error.code).toBe("ANSWER_ALREADY_CONFIRMED"));
      const next = {questionId:required.questionId,questionVersionId:required.questionVersionId};
      await answer({...skip,...next}).expect(400).expect(({body})=>expect(body.error.code).toBe("QUESTION_NOT_SKIPPABLE"));
      await answer({...next,status:"answered",score:5}).expect(200);
      await client.post(session + "/close").expect(403);
      for (let i=0; i<2; i++) {
        await client.post(session + "/close").set("x-session-capability",token).expect(200,{data:{sessionId:id,status:"closed"}});
      }
      await answer({questionId:nps.questionId,questionVersionId:nps.questionVersionId,status:"answered",score:9})
        .expect(409).expect(({body})=>expect(body.error.code).toBe("SUBMISSION_CLOSED"));
      const report = await client.get("/api/analytics/dashboard").set("Cookie","access_token=test")
        .query({from:"2050-01-01T00:00:00Z",to:"2050-01-02T00:00:00Z",sectorId:fixture.sectorId}).expect(200);
      expect(report.body.data.sessions).toMatchObject({started:1,complete:0,incomplete:1,endedOrExpired:1});
      expect(report.body.data.questions).toContainEqual(expect.objectContaining({question_id:optional.questionId,skipped:1,responses:0,mean:null}));
      expect(report.body.data.nps).toMatchObject({responses:0,value:null});
    } finally {
      await db.end();
      await fixture.cleanup();
    }
  });
});
