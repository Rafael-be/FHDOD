import { Router } from "express";
import { z } from "zod";
import type { SubmissionService } from "./submission.service.js";
import { submissionPublicLimiter } from "./submission.public-limiter.js";

const input = z.object({ sessionQuestionId: z.coerce.number().int().positive(), status: z.enum(["answered", "skipped"]), score: z.number().int().nullable() });

export function submissionAnswerRoutes(service: SubmissionService): Router {
  const router = Router();
  router.use(submissionPublicLimiter);
  router.post("/public/submissions/:sessionId/answers", async (request, response, next) => {
    try {
      const token = request.get("x-session-capability");
      if (!token) { response.status(403).json({ error: { code: "SUBMISSION_CAPABILITY_INVALID", message: "Capability de sessão ausente." } }); return; }
      const body = input.parse(request.body);
      response.json({ data: await service.answer(request.params.sessionId, token, body) });
    } catch (error) { next(error); }
  });
  return router;
}
