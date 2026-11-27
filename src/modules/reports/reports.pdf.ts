import PDFDocument from "pdfkit";
import { fileURLToPath } from "node:url";
import type { Writable } from "node:stream";
import type { ReportModel } from "./reports.service.js";
import { COLORS, formatted, label, localDateTime, officialLogo, organizationName, period, sectionLabel } from "./reports.presentation.js";
import { reportCharts, type ReportChart } from "./reports.charts.js";

const font=fileURLToPath(new URL("./fonts/DejaVuSans.ttf",import.meta.url));
const left=48,right=547,bottom=755;
const color=(hex:string)=>`#${hex}`;
function drawChart(doc:PDFKit.PDFDocument,chart:ReportChart):void {
  const height=205;
  if(doc.y+height>bottom)doc.addPage();
  const top=doc.y+8;doc.fontSize(12).fillColor(color(COLORS.navy)).text(chart.title,left,top,{width:499});
  doc.fontSize(8).fillColor(color(COLORS.muted)).text(chart.unit,left,top+18);
  const plot={x:left+40,y:top+46,w:435,h:108};
  const max=Math.max(1,...chart.series.flatMap(s=>s.values));
  const ceiling=chart.unit.includes("1 a 5")?5:chart.unit.includes("0 a 10")?10:Math.ceil(max*1.12);
  doc.lineWidth(.5).strokeColor(color(COLORS.line));
  for(let i=0;i<=4;i++){const y=plot.y+plot.h-i*plot.h/4;doc.moveTo(plot.x,y).lineTo(plot.x+plot.w,y).stroke();const tick=ceiling*i/4;doc.fontSize(7).fillColor(color(COLORS.muted)).text(ceiling<4?tick.toFixed(1).replace(".",","):String(Math.round(tick)),left,y-4,{width:34,align:"right"});}
  const count=chart.categories.length;
  if(chart.kind==="bars"){
    const gap=plot.w/count,bar=Math.min(36,gap*.58);
    chart.series[0]?.values.forEach((value,i)=>{const h=Math.max(0,plot.h*value/ceiling),x=plot.x+gap*i+(gap-bar)/2,barColor=chart.title==="Andamento das pesquisas"?[COLORS.blue,COLORS.teal,COLORS.gold][i]!:chart.series[0]!.color;doc.rect(x,plot.y+plot.h-h,bar,h).fill(color(barColor));doc.fontSize(7).fillColor(color(COLORS.ink)).text(String(Number(value.toFixed(1))),x-8,plot.y+plot.h-h-12,{width:bar+16,align:"center"});});
  }else{
    const gap=count>1?plot.w/(count-1):0;
    for(const series of chart.series){doc.strokeColor(color(series.color)).lineWidth(2);if(series.dashed)doc.dash(5,{space:4});series.values.forEach((value,i)=>{const x=plot.x+i*gap,y=plot.y+plot.h-plot.h*value/ceiling;if(i===0)doc.moveTo(x,y);else doc.lineTo(x,y);});doc.stroke().undash();series.values.forEach((value,i)=>{const x=plot.x+i*gap,y=plot.y+plot.h-plot.h*value/ceiling;doc.circle(x,y,2.5).fill(color(series.color));});}
  }
  const step=Math.max(1,Math.ceil(count/6));chart.categories.forEach((category,i)=>{if(i%step!==0&&i!==count-1)return;const x=chart.kind==="bars"?plot.x+(i+.5)*plot.w/count:plot.x+i*(count>1?plot.w/(count-1):0);doc.fontSize(7).fillColor(color(COLORS.muted)).text(category,x-31,plot.y+plot.h+7,{width:62,align:"center",ellipsis:true});});
  let lx=left+40;for(const series of chart.series){doc.strokeColor(color(series.color)).lineWidth(2);if(series.dashed)doc.dash(5,{space:4});doc.moveTo(lx,top+188).lineTo(lx+20,top+188).stroke().undash();doc.fontSize(8).fillColor(color(COLORS.ink)).text(series.name,lx+25,top+183);lx+=Math.min(200,doc.widthOfString(series.name)+65);}
  doc.y=top+height;
}
export function writeReportPdf(model:ReportModel,output:Writable):Promise<void> {
  return new Promise((resolve,reject)=>{
    const doc=new PDFDocument({size:"A4",margin:48,bufferPages:true});doc.on("error",reject);output.on("error",reject);output.on("finish",resolve);doc.pipe(output);
    doc.registerFont("Report",font).font("Report");
    const logo=officialLogo();if(logo){try{doc.image(logo.bytes,left,42,{fit:[65,48]});}catch{/* Invalid image falls back to textual identification. */}}
    const titleX=logo?123:left;doc.fontSize(10).fillColor(color(COLORS.navy)).text(organizationName(),titleX,45,{width:right-titleX});
    doc.fontSize(8).fillColor(color(COLORS.muted)).text("RELATÓRIO ADMINISTRATIVO · FHDOD",titleX,61);
    doc.moveTo(left,98).lineTo(right,98).lineWidth(2).strokeColor(color(COLORS.teal)).stroke();
    doc.fontSize(19).fillColor(color(COLORS.navy)).text(model.title,left,112,{width:499});
    doc.fontSize(9).fillColor(color(COLORS.ink));
    doc.text(`Abrangência: ${model.filters.sectorName??"Todos os setores autorizados"}`,left,doc.y+9);
    doc.text(`Período analisado: ${period(model)}`);
    doc.text(`Gerado em: ${localDateTime(model.generatedAt)}`);
    doc.y+=12;
    const heading=(value:string)=>{if(doc.y+35>bottom)doc.addPage();doc.fontSize(13).fillColor(color(COLORS.navy)).text(value,left,doc.y+8);doc.moveTo(left,doc.y+4).lineTo(right,doc.y+4).lineWidth(.7).strokeColor(color(COLORS.line)).stroke();doc.y+=11;};
    heading("Indicadores");
    const indicators=Object.entries(model.indicators);for(let i=0;i<indicators.length;i+=2){if(doc.y+46>bottom)doc.addPage();const y=doc.y;for(let j=0;j<2;j++){const item=indicators[i+j];if(!item)continue;const x=left+j*255;doc.roundedRect(x,y,244,40,4).fill(color(COLORS.pale));doc.fontSize(8).fillColor(color(COLORS.muted)).text(label(item[0]),x+9,y+6,{width:225,ellipsis:true});doc.fontSize(12).fillColor(color(COLORS.navy)).text(formatted(item[0],item[1]),x+9,y+20,{width:225});}doc.y=y+47;}
    if(model.warnings.length){heading("Observações");for(const warning of model.warnings){if(doc.y+28>bottom)doc.addPage();doc.fontSize(9).fillColor(color(COLORS.ink)).text(`• ${warning}`,left,doc.y,{width:499});doc.y+=5;}}
    const charts=reportCharts(model);if(charts.length){heading("Gráficos");for(const chart of charts)drawChart(doc,chart);}
    for(const [name,rows] of Object.entries(model.tables)){
      heading(sectionLabel(name));if(!rows.length){doc.fontSize(9).fillColor(color(COLORS.muted)).text("Sem dados no período.");continue;}
      for(const row of rows){const entries=Object.entries(row);let height=14;for(let i=0;i<entries.length;i+=2)height+=entries[i]?.[0]==="text"||entries[i+1]?.[0]==="text"?40:25;if(doc.y+height>bottom)doc.addPage();const y=doc.y;
        doc.rect(left,y,499,height-4).lineWidth(.5).strokeColor(color(COLORS.line)).stroke();let offset=8;
        for(let i=0;i<entries.length;i+=2){for(let j=0;j<2;j++){const item=entries[i+j];if(!item)continue;const x=left+8+j*245;doc.fontSize(7).fillColor(color(COLORS.muted)).text(label(item[0]),x,y+offset,{width:228,ellipsis:true});doc.fontSize(8).fillColor(color(COLORS.ink)).text(formatted(item[0],item[1]),x,y+offset+10,{width:228,height:item[0]==="text"?28:14,ellipsis:true});}offset+=entries[i]?.[0]==="text"||entries[i+1]?.[0]==="text"?40:25;}
        doc.y=y+Math.max(height,offset+5);
      }
    }
    const total=doc.bufferedPageRange().count;for(let i=0;i<total;i++){doc.switchToPage(i);doc.moveTo(left,768).lineTo(right,768).lineWidth(.5).strokeColor(color(COLORS.line)).stroke();doc.fontSize(8).fillColor(color(COLORS.muted)).text(`FHDOD · ${model.title}`,left,775,{width:375});doc.text(`Página ${i+1} de ${total}`,425,775,{width:122,align:"right"});}
    doc.end();
  });
}
