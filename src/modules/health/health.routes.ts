import { Router } from "express";
import { HealthService } from "./health.service.js";

export function healthRoutes(service: HealthService): Router { const router=Router(); router.get("/health",(_request,response)=>response.json({data:service.live()})); router.get("/health/ready",async(_request,response,next)=>{try{response.json({data:await service.ready()});}catch(error){next(error);}}); return router; }
