import request from "supertest";
import { createApp } from "../../src/app.js";
import type { AppConfig } from "../../src/config/env.js";
import type { AuthService } from "../../src/modules/auth/auth.service.js";
import type { AdminService } from "../../src/modules/admin/admin.service.js";
import type { SubmissionService } from "../../src/modules/submissions/submission.service.js";
import type { ShiftSheetService } from "../../src/modules/shifts/shift-sheet.service.js";
import type { QuestionsService } from "../../src/modules/questions/questions.service.js";
import { SecurityRateLimiter } from "../../src/security/rate-limiter.js";

const config = { NODE_ENV: "test", PORT: 3000, DATABASE_URL: "postgres://unused@localhost/unused", ALLOWED_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "12345678901234567890123456789012", JWT_ISSUER: "fhdod-api", JWT_AUDIENCE: "fhdod-web",
  PERFORMANCE_MEASUREMENTS: false, RATE_LIMIT_ADMIN_PER_IP: 300, RATE_LIMIT_SUBMISSION_PER_IP: 1 } as AppConfig;

it("keeps public submission limits on public paths while administrative routes remain reachable", async () => {
  const auth = { authenticate: async () => ({ userId: 1, sessionId: "test", role: "superuser", mustChangePassword: false }) } as AuthService;
  const admin = { listSectors: async () => [] } as unknown as AdminService;
  const submissions = { startNow: async () => ({ session: { id: "test" } }) } as unknown as SubmissionService;
  const app = createApp(config, { authService: auth, adminService: admin, submissionService: submissions,
    securityRateLimiter: new SecurityRateLimiter(undefined, false, config.JWT_SECRET) });
  for (let i = 0; i < 3; i++) await request(app).get("/api/sectors").set("Cookie", "access_token=test").expect(200);
  await request(app).post("/api/public/sectors/1/submissions").expect(201);
  await request(app).post("/api/public/sectors/1/submissions").expect(429)
    .expect(({ body }) => expect(body.error.code).toBe("SUBMISSION_RATE_LIMITED"));
});

it("keeps manager question routes reachable while shift sheets require a superuser", async () => {
  const auth = { authenticate: async () => ({ userId: 5, sessionId: "test", role: "sector_manager", mustChangePassword: false }) } as AuthService;
  const shifts = { template: async () => new Uint8Array() } as unknown as ShiftSheetService;
  const questions = { listSector: async () => [{ questionId: 8, text: "Pergunta do setor" }] } as unknown as QuestionsService;
  const app = createApp(config, { authService: auth, shiftSheetService: shifts, questionsService: questions });
  await request(app).get("/api/sectors/2/questions").set("Cookie", "access_token=test").expect(200)
    .expect(({ body }) => expect(body.data[0].questionId).toBe(8));
  await request(app).get("/api/shift-sheets/template").set("Cookie", "access_token=test").expect(403)
    .expect(({ body }) => expect(body.error.code).toBe("FORBIDDEN"));
});

it("authenticates only once when an administrative request crosses module routers",async()=>{
  let authentications=0;
  const auth={authenticate:async()=>{authentications++;return {userId:1,sessionId:'test',role:'superuser',mustChangePassword:false};}} as AuthService;
  const app=createApp(config,{authService:auth,adminService:{} as AdminService,shiftSheetService:{} as ShiftSheetService,
    questionsService:{} as QuestionsService,analyticsService:{dashboard:async()=>({sessions:{started:0}})} as unknown as import('../../src/modules/analytics/analytics.service.js').AnalyticsService});
  await request(app).get('/api/analytics/dashboard?from=2026-01-01T00:00:00Z&to=2026-01-02T00:00:00Z').set('Cookie','access_token=test').expect(200);
  expect(authentications).toBe(1);
});
