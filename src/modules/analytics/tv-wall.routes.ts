import { Router } from "express";
import { z } from "zod";
import type { AuthService } from "../auth/auth.service.js";
import { requireRole, csrfProtection } from "../auth/auth.middleware.js";
import { tvSettings, type TvWallService } from "./tv-wall.service.js";
import type { RequestHandler } from "express";

export function publicWallRoutes(service: TvWallService, limiter?: RequestHandler) {
  const router = Router();
  router.get("/public/tv-wall", limiter ?? ((_req, _res, next) => next()), async (req, res) => {
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
