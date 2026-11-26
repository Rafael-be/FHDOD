import { Router } from "express";
import { z } from "zod";
import type { AuthService } from "../auth/auth.service.js";
import { requireRole, csrfProtection } from "../auth/auth.middleware.js";
import { tvSettings, type TvWallService } from "./tv-wall.service.js";

export function publicWallRoutes(service: TvWallService) {
  const router = Router();
  router.get("/public/tv-wall", async (req, res) => {
    z.strictObject({}).parse(req.query);
    res.set("Cache-Control", "no-store").json({ data: await service.display() });
  });
  return router;
}

export function wallConfigRoutes(service: TvWallService, auth: AuthService) {
  const router = Router();
  router.route("/tv-wall/config")
    .get(requireRole("superuser"), async (_req, res) => {
      res.set("Cache-Control", "no-store").json({ data: await service.configuration() });
    })
    .put(requireRole("superuser"), csrfProtection(auth), async (req, res) => {
      res.set("Cache-Control", "no-store").json({ data: await service.configure(tvSettings.parse(req.body)) });
    });
  return router;
}
