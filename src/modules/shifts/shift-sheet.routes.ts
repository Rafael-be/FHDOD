import { Router } from "express";
import { csrfProtection, requireRole } from "../auth/auth.middleware.js";
import type { AuthService } from "../auth/auth.service.js";
import type { ShiftSheetService } from "./shift-sheet.service.js";

export function shiftSheetRoutes(service: ShiftSheetService, auth: AuthService): Router {
  const router = Router();
  router.use(requireRole("superuser"));
  router.post("/shift-sheets", csrfProtection(auth), async (request, response, next) => {
    try {
      if (!Buffer.isBuffer(request.body)) {
        response.status(400).json({ error: { code: "INVALID_SHIFT_SHEET_BODY", message: "Envie a planilha como corpo binário." } });
        return;
      }
      const result = await service.import(new Uint8Array(request.body));
      response.status(201).json({ data: result });
    } catch (error) {
      next(error);
    }
  });
  return router;
}
