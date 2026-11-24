import { Router } from "express";
import { z } from "zod";
import type { AuthService } from "../auth/auth.service.js";
import { authenticate, csrfProtection, requireRole } from "../auth/auth.middleware.js";
import type { SecurityRateLimiter } from "../../security/rate-limiter.js";
import { rateLimitByIp } from "../../security/rate-limit.middleware.js";
import type { OmbudsmanService } from "./ombudsman.service.js";
import { ticketStatuses, ticketTypes } from "./ombudsman.repository.js";
import { optionalBrazilianPhone } from "./ombudsman.validation.js";

const id=z.coerce.number().int().positive();
const create=z.strictObject({sectorId:id,ticketType:z.enum(ticketTypes),body:z.string().trim().min(1).max(300),phone:optionalBrazilianPhone,acceptedPolicyVersionId:id.optional(),policyAccepted:z.literal(true)});
const filters=z.object({sectorId:id.optional(),ticketType:z.enum(ticketTypes).optional(),status:z.enum(ticketStatuses).optional(),from:z.iso.datetime({offset:true}).optional(),to:z.iso.datetime({offset:true}).optional(),page:z.coerce.number().int().positive().default(1),pageSize:z.coerce.number().int().min(1).max(100).default(20)});
export function ombudsmanRoutes(service:OmbudsmanService,auth:AuthService,limiter?:SecurityRateLimiter,publicLimit=180):Router {
  const router=Router();
  const publicLimiter=limiter ? rateLimitByIp(limiter,"ombudsman-public",{limit:publicLimit,windowSeconds:60},"OMBUDSMAN_RATE_LIMITED","Muitas solicitações. Aguarde um momento.") : (_req:import("express").Request,_res:import("express").Response,next:import("express").NextFunction)=>next();
  router.post("/public/ombudsman/tickets",publicLimiter,async(req,res,next)=>{try{const input=create.parse(req.body);res.status(201).json({data:await service.create(input)});}catch(error){next(error);}});
  const admin=Router(); admin.use(authenticate(auth),requireRole("superuser"));
  admin.get("/tickets",async(req,res,next)=>{try{res.json({data:await service.list(req.identity!,filters.parse(req.query))});}catch(error){next(error);}});
  admin.get("/tickets/:id",async(req,res,next)=>{try{res.json({data:await service.get(req.identity!,id.parse(req.params.id))});}catch(error){next(error);}});
  admin.patch("/tickets/:id/status",csrfProtection(auth),async(req,res,next)=>{try{const body=z.strictObject({status:z.enum(ticketStatuses)}).parse(req.body);res.json({data:await service.updateStatus(req.identity!,id.parse(req.params.id),body.status)});}catch(error){next(error);}});
  router.use("/ombudsman",admin);
  return router;
}
