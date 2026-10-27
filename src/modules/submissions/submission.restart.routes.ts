import { Router } from "express";
import type { SubmissionService } from "./submission.service.js";

export function submissionRestartRoutes(service: SubmissionService): Router {
  const router = Router();
  router.post("/public/submissions/:sessionId/restart", async (request, response, next) => {
    try {
      const token = request.get("x-session-capability");
      if (!token) { response.status(403).json({ error: { code: "SUBMISSION_CAPABILITY_INVALID", message: "Capability de sessão ausente." } }); return; }
      response.status(201).json({ data: await service.restart(request.params.sessionId, token) });
    } catch (error) { next(error); }
  });
  return router;
}
