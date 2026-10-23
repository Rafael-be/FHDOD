import { Router } from "express";
import { z } from "zod";
import { csrfProtection, requireRole } from "../auth/auth.middleware.js";
import type { AuthService } from "../auth/auth.service.js";
import type { QuestionsService } from "./questions.service.js";

const id = z.coerce.number().int().positive();
const sectorId = z.coerce.number().int().positive();
const text = z.string().trim().min(1).max(2000);
const order = z.number().int().positive();

export function questionsRoutes(service: QuestionsService, auth: AuthService) {
  const router = Router();
  router.use(requireRole("superuser", "sector_manager"));
  const csrf = csrfProtection(auth);
  router.get("/sectors/:sectorId/questions", async (req, res, next) => { try { res.json({ data: await service.listSector(req.identity!, sectorId.parse(req.params.sectorId), req.query.deleted === "true") }); } catch (error) { next(error); } });
  router.post("/sectors/:sectorId/questions", csrf, async (req, res, next) => { try { const body = z.object({ text, displayOrder: order }).parse(req.body); res.status(201).json({ data: await service.createSector(req.identity!, sectorId.parse(req.params.sectorId), body.text, body.displayOrder) }); } catch (error) { next(error); } });
  router.patch("/questions/:id", csrf, async (req, res, next) => { try { const body = z.object({ text }).parse(req.body); res.json({ data: await service.updateText(req.identity!, id.parse(req.params.id), body.text) }); } catch (error) { next(error); } });
  router.post("/questions/:id/deactivate", csrf, async (req, res, next) => { try { await service.setDeleted(req.identity!, id.parse(req.params.id), true); res.status(204).end(); } catch (error) { next(error); } });
  router.post("/questions/:id/reactivate", csrf, async (req, res, next) => { try { await service.setDeleted(req.identity!, id.parse(req.params.id), false); res.status(204).end(); } catch (error) { next(error); } });
  return router;
}
