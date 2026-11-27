import { Router } from "express";
import { z } from "zod";
import type { SubmissionService } from "./submission.service.js";
import { rateLimitByIp } from "../../security/rate-limit.middleware.js";
import type { SecurityRateLimiter } from "../../security/rate-limiter.js";
import { surveyEvent } from "../../shared/performance.js";

const sectorId = z.coerce.number().int().positive();
const firstAnswer = z.object({
  formVersionId: z.number().int().positive(),
  attemptId: z.string().uuid(),
  capability: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  answer: z.object({ questionId: z.number().int().positive(), questionVersionId: z.number().int().positive(), status: z.enum(["answered", "skipped"]), score: z.number().int().nullable() }),
});

export function submissionRoutes(service: SubmissionService, limiter?: SecurityRateLimiter, limit = 180): Router {
  const router = Router();
  if (limiter) router.use("/public/sectors/:sectorId/current-form", rateLimitByIp(limiter, "current-form-public", { limit, windowSeconds: 60 }, "SUBMISSION_RATE_LIMITED", "Muitas solicitações. Aguarde um momento."));
  router.get("/public/sectors/:sectorId/current-form", async (request, response, next) => {
    try {
      const form = await service.currentForm(sectorId.parse(request.params.sectorId));
      response.set("Cache-Control", "public, max-age=0, must-revalidate");
      response.set("ETag", form.etag);
      if (request.get("if-none-match")?.split(",").map((part) => part.trim()).includes(form.etag)) { response.status(304).end(); return; }
      response.json({ data: { sectorId: form.sectorId, sectorName: form.sectorName, formVersionId: form.formVersionId, questions: form.questions } });
    } catch (error) { surveyEvent("ANSWER_REJECTED", "submission.current_form", (error as { code?: string }).code ?? "VALIDATION_FAILED"); next(error); }
  });
  if (limiter) router.use("/public/sectors/:sectorId/submissions", rateLimitByIp(limiter, "submission-public", { limit, windowSeconds: 60 }, "SUBMISSION_RATE_LIMITED", "Muitas solicitações. Aguarde um momento."));
  router.post("/public/sectors/:sectorId/submissions", async (request, response, next) => {
    try {
      const id = sectorId.parse(request.params.sectorId);
      const body = firstAnswer.parse(request.body);
      const result = await service.startWithFirstAnswer(id, body.formVersionId, body.attemptId, body.capability, body.answer);
      response.set("Cache-Control", "no-store").status(result.replayed ? 200 : 201).json({ data: result });
    } catch (error) {
      surveyEvent("ANSWER_REJECTED", "submission.first_answer", (error as { code?: string }).code ?? "VALIDATION_FAILED");
      next(error);
    }
  });
  return router;
}
