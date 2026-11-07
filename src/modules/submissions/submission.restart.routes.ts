import { Router } from "express";
import type { SubmissionService } from "./submission.service.js";
import { submissionPublicLimiter } from "./submission.public-limiter.js";
import { z } from "zod";

const sessionId = z.string().uuid();

export function submissionRestartRoutes(service: SubmissionService): Router {
  const router = Router();
  router.use(submissionPublicLimiter);
  router.post("/public/submissions/:sessionId/restart", async (request, response, next) => {
    try {
      const token = request.get("x-session-capability");
      if (!token) { response.status(403).json({ error: { code: "SUBMISSION_CAPABILITY_INVALID", message: "Capability de sessão ausente." } }); return; }
      response.status(201).json({ data: await service.restart(sessionId.parse(request.params.sessionId), token) });
    } catch (error) { next(error); }
  });
  return router;
}
