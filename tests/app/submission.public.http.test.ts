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
  startNow: async (sectorId: number) => ({ capability: { sessionId: "session-http", token: "cap-http" }, session: { sectorId }, questions: [] }),
  answer: async () => ({ sessionId: "session-http", status: "incomplete", answered: true }),
  restart: async () => ({ capability: { sessionId: "session-new", token: "cap-new" }, session: { sectorId: 7 }, questions: [] }),
} as unknown as SubmissionService;
const app = createApp(config, { authService: new AuthService(repository, clock, config), submissionService });

describe("public submission routes through createApp", () => {
  it("starts without an admin session and returns a capability", async () => {
    await request(app).post("/api/public/sectors/7/submissions").expect(201).expect(({ body }) => expect(body.data.capability.token).toBe("cap-http"));
  });

  it("rejects answers and restart without the capability", async () => {
    await request(app).post("/api/public/submissions/session-http/answers").send({ sessionQuestionId: 1, status: "answered", score: 3 }).expect(403);
    await request(app).post("/api/public/submissions/session-http/restart").expect(403);
  });
});
