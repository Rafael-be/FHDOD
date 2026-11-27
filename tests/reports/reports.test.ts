import express from "express";
import request from "supertest";
import { PassThrough } from "node:stream";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { writeReportPdf } from "../../src/modules/reports/reports.pdf.js";
import { renderReportXlsx } from "../../src/modules/reports/reports.xlsx.js";
import { reportsRoutes } from "../../src/modules/reports/reports.routes.js";
import { ReportsService, type ReportModel } from "../../src/modules/reports/reports.service.js";
import type { ReportsRepository } from "../../src/modules/reports/reports.repository.js";
import type { AnalyticsService } from "../../src/modules/analytics/analytics.service.js";
import type { AnalyticsRepository } from "../../src/modules/analytics/analytics.repository.js";
import type { AuthService } from "../../src/modules/auth/auth.service.js";
import { errorHandler } from "../../src/shared/core.js";
import { reportRequest, downloadRequest } from "../../src/modules/reports/reports.schemas.js";
import { formatted, label, period } from "../../src/modules/reports/reports.presentation.js";
import { reportCharts } from "../../src/modules/reports/reports.charts.js";
import { chartImage } from "../../src/modules/reports/reports.chart-image.js";

const model:ReportModel={type:"questions",title:"Satisfação por perguntas",filters:{from:"2050-01-01T00:00:00Z",to:"2050-01-02T00:00:00Z",sectorId:1,sectorName:"Clínica",timeZone:"America/Sao_Paulo"},
  generatedAt:"2050-01-03T00:00:00Z",indicators:{started:2,completionRate:50,npsMean:8.5},tables:{questions:[{sectorId:1,text:"=HYPERLINK(\"https://invalid\")",mean:4.5,responses:2,distribution:[{score:1,responses:0}]}]},recordCount:2,warnings:["Amostra pequena"],minimumResponses:5};
const range={from:model.filters.from,to:model.filters.to};

test("calendar dates include both São Paulo days and preserve timestamp clients",()=>{
  const calendar=reportRequest.parse({type:"general",from:"2050-01-01",to:"2050-01-02"});
  expect(calendar).toMatchObject({from:"2050-01-01T03:00:00.000Z",to:"2050-01-03T03:00:00.000Z"});
  expect(downloadRequest.parse({type:"general",format:"xlsx",from:"2050-01-01",to:"2050-01-02"})).toMatchObject(calendar);
  expect(reportRequest.parse({type:"general",...range})).toMatchObject(range);
  for(const body of [
    {type:"general",from:"2050-02-30",to:"2050-03-01"},
    {type:"general",from:"2050-01-02",to:"2050-01-01"},
    {type:"general",from:"2050-01-01"},
    {type:"general",from:"2050-01-01",to:"2051-02-01"},
  ])expect(()=>reportRequest.parse(body)).toThrow();
  const fallback=reportRequest.parse({type:"general"});
  expect(Date.parse(fallback.to)-Date.parse(fallback.from)).toBeGreaterThanOrEqual(29*86400000);
  expect(Date.parse(fallback.to)-Date.parse(fallback.from)).toBeLessThanOrEqual(31*86400000);
});

test("translates and formats all key indicators while preserving normalized interval semantics",()=>{
  expect(label("started")).toBe("Pesquisas iniciadas");expect(label("completed")).toBe("Pesquisas concluídas");
  expect(label("incomplete")).toBe("Pesquisas incompletas");expect(label("completionRate")).toBe("Taxa de conclusão");
  expect(label("satisfactionMean")).toBe("Satisfação média");expect(label("npsMean")).toBe("Nota média NPS");
  expect(label("npsResponses")).toBe("Respostas NPS");expect(label("positivePercentage")).toBe("Percentual de avaliações positivas");
  expect(formatted("completionRate",50)).toBe("50%");expect(formatted("satisfactionMean",3)).toBe("3,0 / 5");
  expect(formatted("npsMean",8.4)).toBe("8,4 / 10");expect(formatted("positivePercentage",40)).toBe("40%");
  const calendar={...model,filters:{...model.filters,from:"2050-01-01T03:00:00Z",to:"2050-01-03T03:00:00Z"}};
  expect(period(calendar)).toBe("01/01/2050 a 02/01/2050");
  expect(period(model)).toContain("fim exclusivo");
});

test("selects charts by report type and creates valid PNG images",()=>{
  const general={...model,type:"general" as const,indicators:{...model.indicators,npsResponses:2},tables:{...model.tables,evolution:[{day:"2050-01-01",started:2,complete:1}],shifts:[{name:"Manhã",completed:1}]}};
  const charts=reportCharts(general);expect(charts.map(c=>c.title)).toEqual(expect.arrayContaining(["Andamento das pesquisas","Evolução das pesquisas","Nota média NPS","Pesquisas por turno"]));
  expect(charts.find(c=>c.title==="Evolução das pesquisas")?.series.map(s=>s.dashed)).toEqual([true,undefined]);
  expect(chartImage(charts[0]!).subarray(0,8)).toEqual(Buffer.from([137,80,78,71,13,10,26,10]));
  const ombudsman={...model,type:"ombudsman" as const,tables:{types:[{ticketType:"complaint",tickets:2}]}};
  expect(reportCharts(ombudsman).map(c=>c.title)).toEqual(["Manifestações por tipo"]);
});

test("renders valid PDF and XLSX with labels, charts and editable numeric cells",async()=>{
  const stream=new PassThrough();const chunks:Buffer[]=[];stream.on("data",chunk=>chunks.push(Buffer.from(chunk)));
  await writeReportPdf(model,stream);const pdf=Buffer.concat(chunks);
  expect(pdf.subarray(0,8).toString()).toBe("%PDF-1.3");
  const dir=mkdtempSync(join(tmpdir(),"fhdod-report-"));const path=join(dir,"report.pdf");writeFileSync(path,pdf);
  try {const info=spawnSync("pdfinfo",[path]);expect(info.status).toBe(0);expect(info.stdout.toString()).toContain("Pages:");
    const extracted=spawnSync("pdftotext",[path,"-"]);expect(extracted.status).toBe(0);
    const text=extracted.stdout.toString();expect(text).toContain("Satisfação por perguntas");expect(text).toContain("Pesquisas iniciadas");expect(text).toContain("50%");expect(text).toContain("8,5 / 10");expect(text).toContain("Andamento das pesquisas");expect(text).toContain("Página 1 de");expect(text).toContain("Amostra pequena");
  } finally {rmSync(dir,{recursive:true,force:true});}
  const bytes=await renderReportXlsx(model);const book=new ExcelJS.Workbook();await book.xlsx.load(bytes);
  expect(book.worksheets.map(sheet=>sheet.name)).toEqual(["Resumo","Indicadores","Gráficos","Resultados por pergunta"]);
  expect(book.getWorksheet("Resumo")!.getCell("A1").value).toContain("FHDOD");
  expect(book.getWorksheet("Indicadores")!.getCell("A4").value).toBe("Pesquisas iniciadas");
  expect(book.getWorksheet("Indicadores")!.getCell("B4").value).toBe(2);
  expect(book.getWorksheet("Indicadores")!.getCell("B5").value).toBe(50);
  expect(book.getWorksheet("Indicadores")!.getCell("B5").numFmt).toContain("%");
  expect(book.getWorksheet("Resultados por pergunta")!.getCell("B4").value).toBe("'=HYPERLINK(\"https://invalid\")");
  expect(book.getWorksheet("Resultados por pergunta")!.getCell("C4").value).toBe(4.5);
  expect(book.getWorksheet("Gráficos")!.getImages().length).toBeGreaterThan(0);
});

test("embeds configured official logo in PDF and XLSX",async()=>{
  const dir=mkdtempSync(join(tmpdir(),"fhdod-logo-"));const path=join(dir,"logo.png");
  const image=chartImage({title:"Marca",unit:"",kind:"bars",categories:["A"],series:[{name:"A",values:[1],color:"153963"}]});writeFileSync(path,image);
  const previous=process.env.REPORT_LOGO_PATH;process.env.REPORT_LOGO_PATH=path;
  try {const stream=new PassThrough();const chunks:Buffer[]=[];stream.on("data",chunk=>chunks.push(Buffer.from(chunk)));await writeReportPdf(model,stream);
    const pdfPath=join(dir,"with-logo.pdf");writeFileSync(pdfPath,Buffer.concat(chunks));const images=spawnSync("pdfimages",["-list",pdfPath]);expect(images.status).toBe(0);expect(images.stdout.toString()).toContain("image");
    const book=new ExcelJS.Workbook();await book.xlsx.load(await renderReportXlsx(model));expect(book.getWorksheet("Resumo")!.getImages()).toHaveLength(1);
  }finally{if(previous===undefined)delete process.env.REPORT_LOGO_PATH;else process.env.REPORT_LOGO_PATH=previous;rmSync(dir,{recursive:true,force:true});}
});

test("paginates detailed PDF records without losing the final row",async()=>{
  const many={...model,tables:{questions:Array.from({length:45},(_,i)=>({sectorId:1,text:`Pergunta administrativa ${i+1}`,mean:3.5,responses:10}))}};
  const stream=new PassThrough();const chunks:Buffer[]=[];stream.on("data",chunk=>chunks.push(Buffer.from(chunk)));await writeReportPdf(many,stream);
  const dir=mkdtempSync(join(tmpdir(),"fhdod-pages-"));const path=join(dir,"many.pdf");writeFileSync(path,Buffer.concat(chunks));
  try{const info=spawnSync("pdfinfo",[path]);expect(info.status).toBe(0);expect(Number(info.stdout.toString().match(/Pages:\s+(\d+)/)?.[1])).toBeGreaterThan(1);
    const extracted=spawnSync("pdftotext",[path,"-"]);expect(extracted.status).toBe(0);expect(extracted.stdout.toString()).toContain("Pergunta administrativa 45");
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test("validates private HTTP routes, CSRF, filters and download headers",async()=>{
  const received:unknown[]=[];
  const service={types:()=>[{type:"general"}],preview:async(_actor:unknown,input:unknown)=>{received.push(input);return model;}} as unknown as ReportsService;
  const auth={recoverCsrfForIdentity:async()=>"csrf-test"} as unknown as AuthService;
  const app=express();app.use(express.json());app.use((req,_res,next)=>{req.identity={userId:1,sessionId:"test",role:"superuser",mustChangePassword:false};next();});
  app.use(reportsRoutes(service,auth));app.use(errorHandler);
  await request(app).get("/reports/types").expect(200,{data:[{type:"general"}]});
  await request(app).post("/reports/preview").send({type:"general",...range}).expect(403);
  await request(app).post("/reports/preview").set("x-csrf-token","csrf-test").send({type:"general",...range}).expect(200)
    .expect(({body})=>expect(body.data.indicators.started).toBe(2));
  await request(app).post("/reports/preview").set("x-csrf-token","csrf-test")
    .send({type:"general",from:"2050-01-01",to:"2050-01-02"}).expect(200);
  expect(received.at(-1)).toMatchObject({from:"2050-01-01T03:00:00.000Z",to:"2050-01-03T03:00:00.000Z"});
  for(const body of [{type:"unknown",...range},{type:"general",from:range.to,to:range.from},{type:"sector",...range}])
    await request(app).post("/reports/preview").set("x-csrf-token","csrf-test").send(body).expect(400);
  await request(app).post("/reports/download").set("x-csrf-token","csrf-test").send({type:"general",format:"unknown",...range}).expect(400);
  const pdf=await request(app).post("/reports/download").set("x-csrf-token","csrf-test").send({type:"general",format:"pdf",...range}).expect(200);
  expect(pdf.headers["content-type"]).toContain("application/pdf");expect(pdf.headers["content-disposition"]).toContain("fhdod-relatorio-geral-2050-01.pdf");
  const xlsx=await request(app).post("/reports/download").set("x-csrf-token","csrf-test").send({type:"general",format:"xlsx",...range}).expect(200);
  expect(xlsx.headers["content-type"]).toContain("spreadsheetml.sheet");
  expect(xlsx.headers["cache-control"]).toBe("no-store");
  await request(app).post("/reports/download").set("x-csrf-token","csrf-test")
    .send({type:"general",format:"pdf",from:"2050-01-01",to:"2050-01-02"}).expect(200);
  expect(received.at(-1)).toMatchObject({from:"2050-01-01T03:00:00.000Z",to:"2050-01-03T03:00:00.000Z"});
});

test("reuses analytics values and hides Ombudsman from managers",async()=>{
  const reports={sectorNames:async()=>[{id:1,name:"Clínica"}],dailySessions:async()=>[{day:"2050-01-01",started:2,complete:1}],questions:async()=>[],ombudsman:async()=>({total:1,resolved:1,pending:0,resolutionPercentage:100,byType:[{ticketType:"complaint",tickets:1}],byStatus:[],bySector:[],daily:[]})} as unknown as ReportsRepository;
  const analytics={heatmap:async()=>[{sectorId:1,started:2,completed:1,satisfactionMean:4.5,npsMean:8.5,positivePercentage:50,responses:2,npsResponses:2,completionRate:50}],
    dashboard:async()=>({distribution:[{is_nps:false,score:4,responses:1},{is_nps:false,score:5,responses:1},{is_nps:true,score:8,responses:1},{is_nps:true,score:9,responses:1}],dailyAnswers:[{day:"2050-01-01",mean:4.5}],shifts:[],unclassifiedCompleted:0}),
    criticalQuestions:async()=>({items:[]})} as unknown as AnalyticsService;
  const repository={sectorIds:async()=>[1]} as unknown as AnalyticsRepository;
  const service=new ReportsService(reports,analytics,repository);
  const actor={userId:1,sessionId:"test",role:"sector_manager" as const,mustChangePassword:false};
  expect(service.types(actor).map(x=>x.type)).not.toContain("ombudsman");
  const preview=await service.preview(actor,{type:"sector",...range,sectorId:1});
  expect(preview.indicators).toMatchObject({started:2,completed:1,completionRate:50,satisfactionMean:4.5,npsMean:8.5});
  await expect(service.preview(actor,{type:"ombudsman",...range})).rejects.toMatchObject({code:"FORBIDDEN"});
  const tooMany={...reports,questions:async()=>Array.from({length:5001},()=>({}))} as unknown as ReportsRepository;
  await expect(new ReportsService(tooMany,analytics,repository).preview(actor,{type:"questions",...range})).rejects.toMatchObject({code:"REPORT_TOO_LARGE"});
});
