import { Router } from "express";
import { z } from "zod";
import type { SubmissionService } from "./submission.service.js";
import { rateLimitByIp } from "../../security/rate-limit.middleware.js";
import type { SecurityRateLimiter } from "../../security/rate-limiter.js";

const sectorId = z.coerce.number().int().positive();

export function submissionRoutes(service: SubmissionService, limiter?: SecurityRateLimiter, limit = 180): Router {
  const router = Router();
  if (limiter) router.use(rateLimitByIp(limiter, "submission-public", { limit, windowSeconds: 60 }, "SUBMISSION_RATE_LIMITED", "Muitas solicitações. Aguarde um momento."));
  router.post("/public/sectors/:sectorId/submissions", async (request, response, next) => {
    try {
      const id = sectorId.parse(request.params.sectorId);
      response.status(201).json({ data: await service.startNow(id) });
    } catch (error) {
      next(error);
    }
  });
  return router;
}
