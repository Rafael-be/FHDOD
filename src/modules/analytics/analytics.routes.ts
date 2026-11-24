import { Router } from "express";
import { z } from "zod";
import { requireRole } from "../auth/auth.middleware.js";
import type { AnalyticsService } from "./analytics.service.js";

export const analyticsQuery = z.object({
  from: z.iso.datetime({ offset: true }), to: z.iso.datetime({ offset: true }),
  sectorId: z.coerce.number().int().positive().optional(),
  shiftRangeId: z.coerce.number().int().positive().optional(),
}).refine(input => Date.parse(input.to) > Date.parse(input.from) && Date.parse(input.to) - Date.parse(input.from) <= 366 * 86400000,
  { message: "Informe um período crescente de no máximo 366 dias.", path: ["to"] });

export function analyticsRoutes(service: AnalyticsService): Router {
  const router = Router();
  router.get("/analytics/dashboard", requireRole("superuser", "sector_manager"), async (req, res, next) => {
    try { res.set("Cache-Control", "no-store").json({ data: await service.dashboard(req.identity!, analyticsQuery.parse(req.query)) }); }
    catch (error) { next(error); }
  });
  return router;
}
