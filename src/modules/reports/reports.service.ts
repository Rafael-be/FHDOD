import type { AuthIdentity } from "../auth/auth.service.js";
import type { AnalyticsService } from "../analytics/analytics.service.js";
import type { AnalyticsRepository } from "../analytics/analytics.repository.js";
import { DomainError } from "../../shared/core.js";
import type { ReportsRepository, ReportQuestion, TicketSummary } from "./reports.repository.js";
import type { ReportRequest } from "./reports.schemas.js";

const descriptions = {
  general:"Experiência do paciente",sector:"Experiência por setor",questions:"Satisfação por perguntas",ombudsman:"Ouvidoria gerencial",
} as const;
export interface ReportModel {
  type:ReportRequest["type"]; title:string; filters:{from:string;to:string;sectorId:number|null;sectorName:string|null;timeZone:string}; generatedAt:string;
  indicators:Record<string,number|null>; tables:Record<string,Record<string,unknown>[]>; recordCount:number; warnings:string[]; minimumResponses:number;
}
export class ReportsService {
  constructor(private readonly reports:ReportsRepository,private readonly analytics:AnalyticsService,private readonly analyticsRepository:AnalyticsRepository) {}
  types(actor:AuthIdentity) {
    return (Object.entries(descriptions) as [ReportRequest["type"],string][])
      .filter(([type]) => type!=="ombudsman" || actor.role==="superuser")
      .map(([type,description])=>({type,description,formats:["pdf","xlsx"],filters:{from:true,to:true,sectorId:type==="sector"?"required":type==="general"?"not_applicable":"optional"}}));
  }
  async preview(actor:AuthIdentity,input:ReportRequest):Promise<ReportModel> {
    if (input.type==="ombudsman" && actor.role!=="superuser") throw new DomainError("FORBIDDEN","Acesso à Ouvidoria restrito.",403);
    if (input.type==="general" && input.sectorId) throw new DomainError("VALIDATION_ERROR","Relatório geral não aceita sectorId.",400);
    const filter={from:input.from,to:input.to,...(input.sectorId?{sectorId:input.sectorId}:{})};
    // Validate manager scope before any report-specific query.
    const sectors=await this.analytics.heatmap(actor,filter);
    const names=await this.reports.sectorNames(sectors.map(row=>row.sectorId));
    const nameById=new Map(names.map(row=>[row.id,row.name]));
    if (input.sectorId && !nameById.has(input.sectorId)) throw new DomainError("SECTOR_NOT_FOUND","Setor inexistente ou inativo.",404);
    const scope=actor.role==="superuser"?null:await this.analyticsRepository.sectorIds(actor.userId);
    const warnings:string[]=[];
    const tables:ReportModel["tables"]={};
    const indicators:Record<string,number|null>={};
    const minimumResponses=Number.isSafeInteger(Number(process.env.ANALYTICS_MIN_RESPONSES)) && Number(process.env.ANALYTICS_MIN_RESPONSES)>=1 && Number(process.env.ANALYTICS_MIN_RESPONSES)<=1000
      ? Number(process.env.ANALYTICS_MIN_RESPONSES):5;
    let recordCount:number;
    if (input.type==="ombudsman") {
      const tickets=await this.reports.ombudsman(filter);
      Object.assign(indicators,{total:tickets.total,resolved:tickets.resolved,pending:tickets.pending,resolutionPercentage:tickets.resolutionPercentage,
        complaints:tickets.byType.find(x=>x.ticketType==="complaint")?.tickets??0,
        compliments:tickets.byType.find(x=>x.ticketType==="compliment")?.tickets??0,
        suggestionsOther:tickets.byType.find(x=>x.ticketType==="suggestion_other")?.tickets??0});
      tables.types=tickets.byType;tables.status=tickets.byStatus;tables.sectors=tickets.bySector;tables.evolution=tickets.daily;
      recordCount=tickets.total;
    } else {
      const dashboard=await this.analytics.dashboard(actor,filter);
      const selected=input.sectorId?sectors.find(row=>row.sectorId===input.sectorId):undefined;
      const started=sectors.reduce((n,row)=>n+row.started,0),completed=sectors.reduce((n,row)=>n+row.completed,0);
      const common=dashboard.distribution.filter(row=>!row.is_nps);
      const nps=dashboard.distribution.filter(row=>row.is_nps);
      const sum=(rows:typeof common)=>rows.reduce((n,row)=>n+row.responses,0);
      const mean=(rows:typeof common)=>{const count=sum(rows);return count?rows.reduce((n,row)=>n+row.score*row.responses,0)/count:null;};
      Object.assign(indicators,{started,completed,incomplete:started-completed,completionRate:started?100*completed/started:null,
        satisfactionMean:selected?.satisfactionMean??mean(common),npsMean:selected?.npsMean??mean(nps),npsResponses:sum(nps),
        positivePercentage:selected?.positivePercentage??(sum(common)?100*common.filter(row=>row.score>=4).reduce((n,row)=>n+row.responses,0)/sum(common):null)});
      tables.distribution=dashboard.distribution.filter(row=>!row.is_nps).map(row=>({score:row.score,responses:row.responses}));
      tables.evolution=(await this.reports.dailySessions(filter,scope)).map(day=>({...day,satisfactionMean:dashboard.dailyAnswers.find(item=>item.day===day.day)?.mean??null}));
      tables.sectors=sectors.map(row=>({...row,sectorName:nameById.get(row.sectorId)??""}));
      if (input.type==="general") {
        const shiftCounts=new Map<string,number>();
        for(const shift of dashboard.shifts) shiftCounts.set(shift.name,(shiftCounts.get(shift.name)??0)+shift.completed);
        tables.shifts=[...shiftCounts].map(([name,completed])=>({name,completed}));
        if(dashboard.unclassifiedCompleted) tables.shifts.push({name:"Não classificado",completed:dashboard.unclassifiedCompleted});
        tables.critical=(await this.analytics.criticalQuestions(actor,filter,5)).items.map(item=>({...item}));
        if (actor.role==="superuser") {const tickets:TicketSummary=await this.reports.ombudsman(filter);tables.ombudsman=tickets.byType;indicators.ombudsmanTotal=tickets.total;}
      }
      if (input.type==="sector" || input.type==="questions") {
        const questions:ReportQuestion[]=await this.reports.questions(filter,scope);
        if (questions.length>5000) throw new DomainError("REPORT_TOO_LARGE","Há mais de 5.000 perguntas no escopo; reduza o período ou selecione um setor.",413);
        if (input.type==="sector" && !questions.length) warnings.push("O setor não possui perguntas comuns em formulário vigente.");
        tables.questions=questions.map(q=>({...q,insufficientSample:q.responses<minimumResponses}));
        tables.critical=[...questions].filter(q=>q.responses>=minimumResponses && q.mean!==null).sort((a,b)=>a.mean!-b.mean!||b.responses-a.responses).slice(0,5).map(q=>({...q}));
        if (questions.some(q=>q.responses<minimumResponses)) warnings.push(`Perguntas com menos de ${minimumResponses} respostas têm amostra insuficiente.`);
      }
      recordCount=started;
      if (!started) warnings.push("Não há pesquisas iniciadas no período selecionado.");
    }
    warnings.push("Agregados não permitem avaliar o desempenho individual de pacientes ou profissionais.");
    return {type:input.type,title:descriptions[input.type],filters:{from:input.from,to:input.to,sectorId:input.sectorId??null,
      sectorName:input.sectorId?nameById.get(input.sectorId)??null:null,timeZone:"America/Sao_Paulo"},
      generatedAt:new Date().toISOString(),indicators,tables,recordCount,warnings,minimumResponses};
  }
}
