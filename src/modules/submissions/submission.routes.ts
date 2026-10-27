import { Router } from "express";
import { z } from "zod";
import type { SubmissionService } from "./submission.service.js";

const sectorId = z.coerce.number().int().positive();

export function submissionRoutes(service: SubmissionService): Router {
  const router = Router();
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
