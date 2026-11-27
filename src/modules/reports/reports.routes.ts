import { Router } from "express";
import type { AuthService } from "../auth/auth.service.js";
import { csrfProtection, requireRole } from "../auth/auth.middleware.js";
import { downloadRequest, reportRequest } from "./reports.schemas.js";
import type { ReportsService } from "./reports.service.js";
import { writeReportPdf } from "./reports.pdf.js";
import { renderReportXlsx } from "./reports.xlsx.js";

export function reportsRoutes(service:ReportsService,auth:AuthService):Router {
  const router=Router();router.use("/reports",requireRole("superuser","sector_manager"));
  router.get("/reports/types",(req,res)=>{res.set("Cache-Control","no-store").json({data:service.types(req.identity!)});});
  router.post("/reports/preview",csrfProtection(auth),async(req,res,next)=>{try{
    const model=await service.preview(req.identity!,reportRequest.parse(req.body));
    res.set("Cache-Control","no-store").json({data:model});
  }catch(error){next(error);}});
  router.post("/reports/download",csrfProtection(auth),async(req,res,next)=>{try{
    const input=downloadRequest.parse(req.body);const model=await service.preview(req.identity!,input);
    const month=input.from.slice(0,7);const suffix=input.sectorId?`setor-${input.sectorId}`:({general:"geral",sector:"setor",questions:"perguntas",ombudsman:"ouvidoria"} as const)[input.type];
    const file=`fhdod-relatorio-${suffix}-${month}.${input.format}`;
    if(input.format==="xlsx"){
      const bytes=await renderReportXlsx(model);res.set({"Content-Type":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition":`attachment; filename="${file}"`,"Cache-Control":"no-store"}).send(bytes);return;
    }
    res.set({"Content-Type":"application/pdf","Content-Disposition":`attachment; filename="${file}"`,"Cache-Control":"no-store"});
    await writeReportPdf(model,res);
  }catch(error){if(res.headersSent){res.destroy(error instanceof Error?error:undefined);return;}next(error);}});
  return router;
}
