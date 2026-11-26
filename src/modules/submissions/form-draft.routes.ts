import { Router } from "express";
import { z } from "zod";
import { csrfProtection, requireRole } from "../auth/auth.middleware.js";
import type { AuthService } from "../auth/auth.service.js";
import type { FormDraftService } from "./form-draft.service.js";

const id = z.coerce.number().int().positive();
const revision = z.number().int().nonnegative();
const item = z.object({
  questionId: z.number().int().positive().nullable(), sourceQuestionVersionId: z.number().int().positive().nullable(),
  questionKind: z.enum(["sector", "standard"]), isNps: z.boolean(), text: z.string().trim().min(1).max(2000),
  position: z.number().int().positive(),
});

export function formDraftRoutes(service: FormDraftService, auth: AuthService): Router {
  const router = Router();
  router.use(requireRole("superuser", "sector_manager"));
  const csrf = csrfProtection(auth);
  router.get("/sectors/:sectorId/form-draft", async (req, res, next) => {
    try { res.json({ data: await service.get(req.identity!, id.parse(req.params.sectorId)) }); } catch (error) { next(error); }
  });
  router.put("/sectors/:sectorId/form-draft", csrf, async (req, res, next) => {
    try { const body = z.object({ expectedRevision: revision, items: z.array(item).max(200) }).parse(req.body);
      res.json({ data: await service.save(req.identity!, id.parse(req.params.sectorId), body.expectedRevision, body.items) }); }
    catch (error) { next(error); }
  });
  router.delete("/sectors/:sectorId/form-draft", csrf, async (req, res, next) => {
    try { const body = z.object({ expectedRevision: revision }).parse(req.body);
      res.json({ data: await service.discard(req.identity!, id.parse(req.params.sectorId), body.expectedRevision) }); }
    catch (error) { next(error); }
  });
  router.get("/sectors/:sectorId/form-draft/readiness", async (req, res, next) => {
    try { res.json({ data: await service.readiness(req.identity!, id.parse(req.params.sectorId)) }); } catch (error) { next(error); }
  });
  router.post("/sectors/:sectorId/form-draft/publish", csrf, async (req, res, next) => {
    try { const body = z.object({ expectedRevision: revision }).parse(req.body);
      res.json({ data: await service.publish(req.identity!, id.parse(req.params.sectorId), body.expectedRevision) }); }
    catch (error) { next(error); }
  });
  router.get("/sectors/:sectorId/form-versions", async (req, res, next) => {
    try { res.json({ data: await service.history(req.identity!, id.parse(req.params.sectorId)) }); } catch (error) { next(error); }
  });
  router.get("/sectors/:sectorId/form-versions/:versionId", async (req, res, next) => {
    try { res.json({ data: await service.version(req.identity!, id.parse(req.params.sectorId), id.parse(req.params.versionId)) }); } catch (error) { next(error); }
  });
  router.post("/sectors/:sectorId/form-versions/:versionId/restore", csrf, async (req, res, next) => {
    try { const body = z.object({ expectedRevision: revision }).parse(req.body);
      res.json({ data: await service.restore(req.identity!, id.parse(req.params.sectorId), id.parse(req.params.versionId), body.expectedRevision) }); }
    catch (error) { next(error); }
  });
  return router;
}
