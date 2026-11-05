import express from "express";
import request from "supertest";
import { submissionRoutes } from "../../src/modules/submissions/submission.routes.js";
import { submissionAnswerRoutes } from "../../src/modules/submissions/submission.answer.routes.js";
import { submissionRestartRoutes } from "../../src/modules/submissions/submission.restart.routes.js";
import type { SubmissionService } from "../../src/modules/submissions/submission.service.js";

const service = {
  startNow: async (sectorId: number) => ({ capability: { sessionId: "session", token: "capability" }, session: { sectorId }, questions: [] }),
  answer: async () => ({ sessionId: "session", status: "incomplete", answered: true }),
  restart: async () => ({ capability: { sessionId: "new-session", token: "new-capability" }, session: { sectorId: 7 }, questions: [] }),
} as unknown as SubmissionService;
const app = express();
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
    await request(app).post("/api/public/submissions/session/answers").send({ sessionQuestionId: 1, status: "answered", score: 3 }).expect(403);
    await request(app).post("/api/public/submissions/session/answers").set("x-session-capability", "capability").send({ sessionQuestionId: 1, status: "answered", score: 3 }).expect(200);
    await request(app).post("/api/public/submissions/session/restart").set("x-session-capability", "capability").expect(201);
  });
});
