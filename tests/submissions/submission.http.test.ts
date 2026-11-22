import express from "express";
import request from "supertest";
import { submissionRoutes } from "../../src/modules/submissions/submission.routes.js";
import { submissionAnswerRoutes } from "../../src/modules/submissions/submission.answer.routes.js";
import { submissionRestartRoutes } from "../../src/modules/submissions/submission.restart.routes.js";
import type { SubmissionService } from "../../src/modules/submissions/submission.service.js";

const receivedAnswers: Array<{ sessionId: string; token: string; input: { questionId: number; questionVersionId: number; status: string; score: number | null } }> = [];
const service = {
  startNow: async (sectorId: number) => ({ capability: { sessionId: "session", token: "capability" }, session: { sectorId }, questions: [] }),
  answer: async (sessionId: string, token: string, input: { questionId: number; questionVersionId: number; status: string; score: number | null }) => { receivedAnswers.push({ sessionId, token, input }); return { sessionId, status: "incomplete", answered: true }; },
  restart: async () => ({ capability: { sessionId: "new-session", token: "new-capability" }, session: { sectorId: 7 }, questions: [] }),
  refresh: async () => ({ expiresAt: "2026-01-01T12:05:00.000Z", refreshesUsed: 1, refreshesRemaining: 2 }),
  close: async () => ({ sessionId, status: "closed" }),
} as unknown as SubmissionService;
const app = express();
const sessionId = "00000000-0000-4000-8000-000000000001";
app.use(express.json());
app.use("/api", submissionRoutes(service));
app.use("/api", submissionAnswerRoutes(service));
app.use("/api", submissionRestartRoutes(service));
app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => response.status(500).json({ error }));

describe("anonymous submission HTTP routes", () => {
  it("starts without an administrative cookie or CSRF token", async () => {
    await request(app).post("/api/public/sectors/7/submissions").expect(201).expect(({ body }) => expect(body.data.capability.token).toBe("capability"));
  });

  it("requires the ephemeral capability for answers and restart", async () => {
    receivedAnswers.length = 0;
    await request(app).post(`/api/public/submissions/${sessionId}/answers`).send({ questionId: 1, questionVersionId: 2, status: "answered", score: 3 }).expect(403);
    expect(receivedAnswers).toEqual([]);
    await request(app).post(`/api/public/submissions/${sessionId}/answers`).set("x-session-capability", "capability").send({ questionId: 1, questionVersionId: 2, status: "answered", score: 3 }).expect(200).expect(({ body }) => expect(body.data).toEqual({ sessionId, status: "incomplete", answered: true }));
    expect(receivedAnswers).toEqual([{ sessionId, token: "capability", input: { questionId: 1, questionVersionId: 2, status: "answered", score: 3 } }]);
    await request(app).post(`/api/public/submissions/${sessionId}/restart`).set("x-session-capability", "capability").expect(201);
    await request(app).post(`/api/public/submissions/${sessionId}/refresh`).set("x-session-capability", "capability").expect(200).expect(({ body }) => expect(body.data.refreshesRemaining).toBe(2));
    await request(app).post(`/api/public/submissions/${sessionId}/close`).set("x-session-capability", "capability").expect(200).expect(({ body }) => expect(body.data.status).toBe("closed"));
  });
});
