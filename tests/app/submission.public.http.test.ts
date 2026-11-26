import request from "supertest";
import { createApp } from "../../src/app.js";
import { AuthService } from "../../src/modules/auth/auth.service.js";
import type { AuthRepository } from "../../src/modules/auth/auth.repository.js";
import type { SubmissionService } from "../../src/modules/submissions/submission.service.js";
import type { AppConfig } from "../../src/config/env.js";
import type { Clock } from "../../src/shared/core.js";

const config: AppConfig = { NODE_ENV: "test", PORT: 3000, DATABASE_URL: "postgres://api:pass@localhost/fhdod", ALLOWED_ORIGIN: "http://localhost:5173", JWT_SECRET: "12345678901234567890123456789012", JWT_ISSUER: "fhdod-api", JWT_AUDIENCE: "fhdod-web", PERFORMANCE_MEASUREMENTS: false };
const repository: AuthRepository = {
  transaction: async (work) => work(repository), findUserByEmail: async () => null, findUserById: async () => null, lockUser: async () => null, findSession: async () => null, findAuthenticatedSession: async () => null, findRefresh: async () => null,
  revokeUserSessions: async () => undefined, createSession: async () => undefined, createRefresh: async () => undefined, consumeRefresh: async () => false, linkRefreshReplacement: async () => undefined, revokeSession: async () => undefined, touchSession: async () => undefined, changePassword: async () => undefined, changeEmail: async () => undefined,
};
const clock: Clock = { now: () => new Date("2026-01-01T12:00:00Z") };
const submissionService = {
  currentForm: async (sectorId: number) => ({ sectorId, formVersionId: 8, questions: [], etag: '"form-8"' }),
  startWithFirstAnswer: async (sectorId: number, _version: number, attemptId: string, token: string) => ({ capability: { sessionId: attemptId, token }, session: { sectorId }, replayed: false }),
  answer: async () => ({ sessionId: "session-http", status: "incomplete", answered: true }),
  restart: async () => ({ capability: { sessionId: "session-new", token: "cap-new" }, session: { sectorId: 7 }, questions: [] }),
} as unknown as SubmissionService;
const app = createApp(config, { authService: new AuthService(repository, clock, config), submissionService });

describe("public submission routes through createApp", () => {
  it("reads the current form without a session and starts on the first answer", async () => {
    await request(app).get("/api/public/sectors/7/current-form").expect(200).expect(({ body }) => expect(body.data.formVersionId).toBe(8));
    await request(app).get("/api/public/sectors/7/current-form").set("If-None-Match", '"form-8"').expect(304);
    await request(app).post("/api/public/sectors/7/submissions").send({ formVersionId: 8, attemptId: "00000000-0000-4000-8000-000000000001", capability: "A".repeat(43), answer: { questionId: 1, questionVersionId: 2, status: "answered", score: 3 } }).expect(201).expect(({ body }) => expect(body.data.capability.token).toBe("A".repeat(43)));
  });

  it("rejects answers and restart without the capability", async () => {
    await request(app).post("/api/public/submissions/session-http/answers").send({ sessionQuestionId: 1, status: "answered", score: 3 }).expect(403);
    await request(app).post("/api/public/submissions/session-http/restart").expect(403);
  });

  it("rejects malformed public session identifiers before authorization", async () => {
    await request(app).post("/api/public/submissions/not-a-uuid/answers").set("x-session-capability", "cap-http").send({ sessionQuestionId: 1, status: "answered", score: 3 }).expect(400);
    await request(app).post("/api/public/submissions/not-a-uuid/restart").set("x-session-capability", "cap-http").expect(400);
  });
});
