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
