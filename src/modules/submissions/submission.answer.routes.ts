import { Router } from "express";
import { z } from "zod";
import type { SubmissionService } from "./submission.service.js";

const input = z.object({ status: z.enum(["answered", "skipped"]), score: z.number().int().nullable() });

export function submissionAnswerRoutes(service: SubmissionService): Router {
  const router = Router();
  router.post("/public/submissions/:sessionId/answers", async (request, response, next) => {
    try {
      const token = request.get("x-session-capability");
      if (!token) { response.status(403).json({ error: { code: "SUBMISSION_CAPABILITY_INVALID", message: "Capability de sessão ausente." } }); return; }
      const body = input.parse(request.body);
      const sessionQuestionId = z.coerce.number().int().positive().parse(request.body.sessionQuestionId);
      response.json({ data: await service.answer(request.params.sessionId, token, { ...body, sessionQuestionId }) });
    } catch (error) { next(error); }
  });
  return router;
}
