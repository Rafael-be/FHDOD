import { Router } from "express";
import { z } from "zod";
import { csrfProtection, requireRole } from "../auth/auth.middleware.js";
import type { AuthService } from "../auth/auth.service.js";
import type { QuestionsService } from "./questions.service.js";

const id = z.coerce.number().int().positive();
const sectorId = z.coerce.number().int().positive();
const text = z.string().trim().min(1).max(2000);
const order = z.number().int().positive();
const scope = z.enum(["all_sectors", "selected_sectors"]);

export function questionsRoutes(service: QuestionsService, auth: AuthService) {
  const router = Router();
  router.use(requireRole("superuser", "sector_manager"));
  const csrf = csrfProtection(auth);
  router.get("/sectors/:sectorId/questions", async (req, res, next) => { try { res.json({ data: await service.listSector(req.identity!, sectorId.parse(req.params.sectorId), req.query.deleted === "true") }); } catch (error) { next(error); } });
  router.post("/sectors/:sectorId/questions", csrf, async (req, res, next) => { try { const body = z.object({ text, displayOrder: order }).parse(req.body); res.status(201).json({ data: await service.createSector(req.identity!, sectorId.parse(req.params.sectorId), body.text, body.displayOrder) }); } catch (error) { next(error); } });
  router.post("/standard-questions", csrf, async (req, res, next) => { try { const body = z.object({ text, scope, sectorIds: z.array(id).max(100).default([]), displayOrder: order }).parse(req.body); res.status(201).json({ data: await service.createStandard(req.identity!, body) }); } catch (error) { next(error); } });
  router.post("/nps-questions", csrf, async (req, res, next) => { try { const body = z.object({ text, scope, sectorIds: z.array(id).max(100).default([]) }).parse(req.body); res.status(201).json({ data: await service.createNps(req.identity!, body) }); } catch (error) { next(error); } });
  router.post("/sectors/:sectorId/nps", csrf, async (req, res, next) => { try { const body = z.object({ questionId: id, replace: z.boolean().default(false) }).parse(req.body); await service.assignNps(req.identity!, sectorId.parse(req.params.sectorId), body.questionId, body.replace); res.status(204).end(); } catch (error) { next(error); } });
  router.post("/sectors/:sectorId/questions/reorder", csrf, async (req, res, next) => { try { const body = z.object({ orderedIds: z.array(id).min(1) }).parse(req.body); await service.reorderSector(req.identity!, sectorId.parse(req.params.sectorId), body.orderedIds); res.status(204).end(); } catch (error) { next(error); } });
  router.post("/sectors/:sectorId/standard-questions/reorder", csrf, async (req, res, next) => { try { const body = z.object({ orderedIds: z.array(id).min(1) }).parse(req.body); await service.reorderStandard(req.identity!, sectorId.parse(req.params.sectorId), body.orderedIds); res.status(204).end(); } catch (error) { next(error); } });
  router.patch("/questions/:id", csrf, async (req, res, next) => { try { const body = z.object({ text }).parse(req.body); res.json({ data: await service.updateText(req.identity!, id.parse(req.params.id), body.text) }); } catch (error) { next(error); } });
  router.post("/questions/:id/deactivate", csrf, async (req, res, next) => { try { await service.setDeleted(req.identity!, id.parse(req.params.id), true); res.status(204).end(); } catch (error) { next(error); } });
  router.post("/questions/:id/reactivate", csrf, async (req, res, next) => { try { await service.setDeleted(req.identity!, id.parse(req.params.id), false); res.status(204).end(); } catch (error) { next(error); } });
  return router;
}
