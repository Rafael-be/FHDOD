import { Router } from "express";
import { z } from "zod";
import { requireRole } from "../auth/auth.middleware.js";
import { AuditService, decodeAuditCursor } from "./audit.service.js";

const query=z.object({cursor:z.string().optional(),limit:z.coerce.number().int().min(1).max(100).default(50)});
export function auditRoutes(service: AuditService): Router { const router=Router(); router.get("/audit-logs",requireRole("superuser"),async(request,response,next)=>{try{const input=query.parse(request.query);response.json({data:await service.list(request.identity!,decodeAuditCursor(input.cursor),input.limit)});}catch(error){next(error);}});return router; }
