import { Router } from "express";
import { z } from "zod";
import { requireRole } from "../auth/auth.middleware.js";
import type { AnalyticsService } from "./analytics.service.js";

export const analyticsQuery = z.object({
  from: z.iso.datetime({ offset: true }), to: z.iso.datetime({ offset: true }),
  sectorId: z.coerce.number().int().positive().max(2147483647).optional(),
  sectorIds: z.string().regex(/^\d+(,\d+)*$/).transform(value => [...new Set(value.split(",").map(Number))])
    .pipe(z.array(z.number().int().positive().max(2147483647)).max(200)).optional(),
  shiftRangeId: z.coerce.number().int().positive().max(2147483647).optional(),
}).refine(input => !input.sectorId || !input.sectorIds, { message: "Use sectorId ou sectorIds." }).refine(input => Date.parse(input.to) > Date.parse(input.from) && Date.parse(input.to) - Date.parse(input.from) <= 366 * 86400000,
  { message: "Informe um período crescente de no máximo 366 dias.", path: ["to"] });

export function analyticsRoutes(service: AnalyticsService): Router {
  const router = Router();
  router.get("/analytics/dashboard", requireRole("superuser", "sector_manager"), async (req, res, next) => {
    try { res.set("Cache-Control", "no-store").json({ data: await service.dashboard(req.identity!, analyticsQuery.parse(req.query)) }); }
    catch (error) { next(error); }
  });
  router.get("/analytics/global-questions", requireRole("superuser", "sector_manager"), async (req, res, next) => {
    try {
      const filter = analyticsQuery.parse(req.query);
      const questionId = z.coerce.number().int().positive().max(2147483647).optional().parse(req.query.questionId);
      res.set("Cache-Control", "no-store").json({ data: await service.globalQuestions(req.identity!, filter, questionId) });
    } catch (error) { next(error); }
  });
  router.get("/analytics/heatmap", requireRole("superuser", "sector_manager"), async (req, res, next) => {
    try { res.set("Cache-Control", "no-store").json({ data: await service.heatmap(req.identity!, analyticsQuery.parse(req.query)) }); }
    catch (error) { next(error); }
  });
  router.get("/analytics/questions/distribution", requireRole("superuser", "sector_manager"), async (req, res, next) => {
    try {
      const filter = analyticsQuery.parse(req.query);
      if (!filter.sectorId) { res.status(400).json({error:{code:"VALIDATION_ERROR",message:"Informe sectorId."}}); return; }
      res.set("Cache-Control", "no-store").json({ data: await service.questionDistribution(req.identity!, filter) });
    } catch (error) { next(error); }
  });
  router.get("/analytics/questions/critical", requireRole("superuser", "sector_manager"), async (req, res, next) => {
    try {
      const filter = analyticsQuery.parse(req.query);
      const limit = z.coerce.number().pipe(z.union([z.literal(3),z.literal(5)])).default(5).parse(req.query.limit);
      res.set("Cache-Control", "no-store").json({ data: await service.criticalQuestions(req.identity!, filter, limit) });
    } catch (error) { next(error); }
  });
  return router;
}
