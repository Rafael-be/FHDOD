import { Router } from "express";
import type { SubmissionService } from "./submission.service.js";
import { rateLimitByIp } from "../../security/rate-limit.middleware.js";
import type { SecurityRateLimiter } from "../../security/rate-limiter.js";
import { z } from "zod";

const sessionId = z.string().uuid();

export function submissionRestartRoutes(service: SubmissionService, limiter?: SecurityRateLimiter, limit = 180): Router {
  const router = Router();
  if (limiter) router.use("/public/submissions/:sessionId", rateLimitByIp(limiter, "submission-public", { limit, windowSeconds: 60 }, "SUBMISSION_RATE_LIMITED", "Muitas solicitações. Aguarde um momento."));
  router.post("/public/submissions/:sessionId/restart", async (request, response, next) => {
    try {
      const token = request.get("x-session-capability");
      if (!token) { response.status(403).json({ error: { code: "SUBMISSION_CAPABILITY_INVALID", message: "Capability de sessão ausente." } }); return; }
      response.status(201).json({ data: await service.restart(sessionId.parse(request.params.sessionId), token) });
    } catch (error) { next(error); }
  });
  for (const action of ["refresh", "close"] as const) router.post(`/public/submissions/:sessionId/${action}`, async (request, response, next) => {
    try {
      const token = request.get("x-session-capability");
      if (!token) { response.status(403).json({ error: { code: "SUBMISSION_CAPABILITY_INVALID", message: "Capability de sessão ausente." } }); return; }
      const id = sessionId.parse(request.params.sessionId);
      response.json({ data: action === "refresh" ? await service.refresh(id, token) : await service.close(id, token) });
    } catch (error) { next(error); }
  });
  return router;
}
