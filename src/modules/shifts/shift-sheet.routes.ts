import { Router } from "express";
import { csrfProtection, requireRole } from "../auth/auth.middleware.js";
import type { AuthService } from "../auth/auth.service.js";
import type { ShiftSheetService } from "./shift-sheet.service.js";

export function shiftSheetRoutes(service: ShiftSheetService, auth: AuthService): Router {
  const router = Router();
  router.use(requireRole("superuser"));
  router.get("/shift-sheets", async (_request, response, next) => {
    try {
      const csv = await service.download();
      response.status(200).type("text/csv; charset=utf-8").set("Content-Disposition", "attachment; filename=planilha-turnos.csv").send(Buffer.from(csv));
    } catch (error) {
      next(error);
    }
  });
  router.post("/shift-sheets", csrfProtection(auth), async (request, response, next) => {
    try {
      if (!Buffer.isBuffer(request.body)) {
        response.status(400).json({ error: { code: "INVALID_SHIFT_SHEET_BODY", message: "Envie a planilha como corpo binário." } });
        return;
      }
      const result = await service.import(new Uint8Array(request.body), request.identity!.userId);
      response.status(201).json({ data: result });
    } catch (error) {
      next(error);
    }
  });
  return router;
}
