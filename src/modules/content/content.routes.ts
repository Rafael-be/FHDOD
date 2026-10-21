import { Router } from "express";
import { z } from "zod";
import type { AuthService } from "../auth/auth.service.js";
import { authenticate, csrfProtection, requireRole } from "../auth/auth.middleware.js";
import { ContentService } from "./content.service.js";

const slug=z.string().regex(/^[a-z0-9-]+$/).max(80);const publish=z.object({title:z.string().trim().min(2).max(160),content:z.string().trim().min(1).max(50_000)});
export function contentRoutes(service:ContentService,auth:AuthService):Router{const router=Router();router.get("/pages/:slug",async(req,res,next)=>{try{res.json({data:await service.getPublished(slug.parse(req.params.slug))});}catch(error){next(error);}});router.put("/pages/:slug",authenticate(auth),requireRole("superuser"),csrfProtection(auth),async(req,res,next)=>{try{const input=publish.parse(req.body);res.json({data:await service.publish(req.identity!,slug.parse(req.params.slug),input.title,input.content)});}catch(error){next(error);}});return router;}
