import express from "express";
import request from "supertest";
import { analyticsRoutes } from "../../src/modules/analytics/analytics.routes.js";
import type { AnalyticsService } from "../../src/modules/analytics/analytics.service.js";
import { errorHandler } from "../../src/shared/core.js";
it("requires identity and validates bounded timezone-aware periods", async () => {
  const service = { dashboard: async () => ({ sessions: { started: 0 } }) } as unknown as AnalyticsService;
  const app = express(); app.use(analyticsRoutes(service)); app.use(errorHandler);
  await request(app).get('/analytics/dashboard').expect(401);
  const admin = express(); admin.use((req,_res,next) => { req.identity={userId:1,sessionId:'test',role:'superuser',mustChangePassword:false}; next(); });
  admin.use(analyticsRoutes(service)); admin.use(errorHandler);
  await request(admin).get('/analytics/dashboard?from=bad&to=bad').expect(400);
  await request(admin).get('/analytics/dashboard?from=2050-01-02T00:00:00Z&to=2050-01-01T00:00:00Z').expect(400);
  await request(admin).get('/analytics/dashboard?from=2050-01-01T00:00:00Z&to=2050-01-02T00:00:00Z').expect(200)
    .expect(({body}) => expect(body.data.sessions.started).toBe(0));
});

it("passes selected IDs to the global question service and rejects ambiguous sector filters", async () => {
  const calls: unknown[] = [];
  const app = express();
  app.use((req,_res,next) => {
    req.identity={userId:1,sessionId:"test",role:"sector_manager",mustChangePassword:false};
    next();
  });
  app.use(analyticsRoutes({globalQuestions:async (...args: unknown[]) => { calls.push(args); return []; }} as unknown as AnalyticsService));
  app.use(errorHandler);
  const range = {from:"2050-01-01T00:00:00Z",to:"2050-01-02T00:00:00Z"};
  await request(app).get("/analytics/global-questions").query({...range,sectorIds:"3,8,3",questionId:"9"}).expect(200,{data:[]});
  expect(calls).toEqual([[expect.objectContaining({role:"sector_manager"}),{...range,sectorIds:[3,8]},9]]);
  for (const scope of [{sectorIds:"8,3",sectorId:"8"},{sectorIds:"8,0"},{sectorIds:"invalid"},{questionId:"2147483648"}])
    await request(app).get("/analytics/global-questions").query({...range,...scope}).expect(400);
});

it("validates analytics insight filters and keeps authenticated response envelopes", async () => {
  const calls: string[] = [];
  const app = express();
  app.use((req,_res,next) => { req.identity={userId:1,sessionId:"test",role:"superuser",mustChangePassword:false}; next(); });
  app.use(analyticsRoutes({
    heatmap:async () => {calls.push("heatmap"); return [];},
    questionDistribution:async () => {calls.push("distribution"); return {sectorId:2,formVersionId:4,questions:[]};},
    criticalQuestions:async (_actor:unknown,_filter:unknown,limit:number) => {calls.push(String(limit)); return {minimumResponses:5,items:[]};},
  } as unknown as AnalyticsService));
  app.use(errorHandler);
  const range={from:"2050-01-01T00:00:00Z",to:"2050-01-02T00:00:00Z"};
  await request(app).get("/analytics/heatmap").query(range).expect(200,{data:[]});
  await request(app).get("/analytics/questions/distribution").query(range).expect(400);
  await request(app).get("/analytics/questions/distribution").query({...range,sectorId:2}).expect(200);
  await request(app).get("/analytics/questions/critical").query({...range,limit:3}).expect(200,{data:{minimumResponses:5,items:[]}});
  await request(app).get("/analytics/questions/critical").query({...range,limit:4}).expect(400);
  expect(calls).toEqual(["heatmap","distribution","3"]);
});
