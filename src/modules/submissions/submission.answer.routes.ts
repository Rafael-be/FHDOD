import { Router } from "express";
import { z } from "zod";
import type { SubmissionService } from "./submission.service.js";
import { rateLimitByIp } from "../../security/rate-limit.middleware.js";
import type { SecurityRateLimiter } from "../../security/rate-limiter.js";

const input = z.object({ sessionQuestionId: z.coerce.number().int().positive(), status: z.enum(["answered", "skipped"]), score: z.number().int().nullable() });
const sessionId = z.string().uuid();

export function submissionAnswerRoutes(service: SubmissionService, limiter?: SecurityRateLimiter, limit = 180): Router {
  const router = Router();
  if (limiter) router.use(rateLimitByIp(limiter, "submission-public", { limit, windowSeconds: 60 }, "SUBMISSION_RATE_LIMITED", "Muitas solicitações. Aguarde um momento."));
  router.post("/public/submissions/:sessionId/answers", async (request, response, next) => {
    try {
      const token = request.get("x-session-capability");
      if (!token) { response.status(403).json({ error: { code: "SUBMISSION_CAPABILITY_INVALID", message: "Capability de sessão ausente." } }); return; }
      const body = input.parse(request.body);
      response.json({ data: await service.answer(sessionId.parse(request.params.sessionId), token, body) });
    } catch (error) { next(error); }
  });
  return router;
}
