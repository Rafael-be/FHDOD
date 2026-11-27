import ExcelJS from "exceljs";
import type { ReportModel } from "./reports.service.js";
import { COLORS, formatted, label, localDateTime, numericFormat, officialLogo, organizationName, period, sectionLabel } from "./reports.presentation.js";
import { reportCharts } from "./reports.charts.js";
import { chartImage } from "./reports.chart-image.js";

function literal(value:unknown,key=""):string|number|boolean|null {
  if(value===null||value===undefined)return null;
  if(typeof value==="number"||typeof value==="boolean")return value;
  const text=formatted(key,value);
  return /^[=+@\-\t\r]/.test(text)?`'${text}`:text;
}
const fill=(argb:string):ExcelJS.Fill=>({type:"pattern",pattern:"solid",fgColor:{argb:`FF${argb}`}});
const banner=(sheet:ExcelJS.Worksheet,title:string)=>{sheet.mergeCells("A1:H2");const cell=sheet.getCell("A1");cell.value=title;cell.font={name:"Aptos Display",size:17,bold:true,color:{argb:"FFFFFFFF"}};cell.fill=fill(COLORS.navy);cell.alignment={vertical:"middle",indent:1};sheet.getRow(1).height=23;sheet.getRow(2).height=19;};
const header=(row:ExcelJS.Row)=>{row.height=25;row.eachCell(cell=>{cell.fill=fill(COLORS.blue);cell.font={name:"Aptos",size:10,bold:true,color:{argb:"FFFFFFFF"}};cell.alignment={vertical:"middle",wrapText:true};cell.border={bottom:{style:"thin",color:{argb:`FF${COLORS.line}`}}};});};
export async function renderReportXlsx(model:ReportModel):Promise<Buffer> {
  const book=new ExcelJS.Workbook();book.creator="FHDOD";book.created=new Date(model.generatedAt);
  const summary=book.addWorksheet("Resumo");banner(summary,`${organizationName()} | ${model.title}`);
  summary.getCell("A4").value="Período analisado";summary.getCell("B4").value=period(model);
  summary.getCell("A5").value="Abrangência";summary.getCell("B5").value=literal(model.filters.sectorName??"Todos os setores autorizados");
  summary.getCell("A6").value="Gerado em";summary.getCell("B6").value=localDateTime(model.generatedAt);
  summary.getCell("A7").value="Documento";summary.getCell("B7").value="Relatório administrativo FHDOD";
  const logo=officialLogo();if(logo){const image=book.addImage({base64:logo.bytes.toString("base64"),extension:logo.extension});summary.addImage(image,"G4:H6");}
  const indicators=book.addWorksheet("Indicadores");banner(indicators,"Indicadores | "+model.title);header(indicators.addRow(["Indicador","Valor"]));
  for(const [key,value] of Object.entries(model.indicators)){const row=indicators.addRow([label(key),value]);row.getCell(2).numFmt=numericFormat(key);}
  if(model.warnings.length){const start=indicators.rowCount+2;indicators.getCell(`A${start}`).value="Observações";indicators.getCell(`A${start}`).font={bold:true,color:{argb:`FF${COLORS.navy}`}};for(const warning of model.warnings)indicators.addRow([literal(warning)]);}
  const charts=reportCharts(model);if(charts.length){const chartSheet=book.addWorksheet("Gráficos");banner(chartSheet,"Gráficos | "+model.title);let row=4;for(const chart of charts){chartSheet.mergeCells(row,1,row,8);chartSheet.getCell(row,1).value=`${chart.title} · ${chart.unit}`;chartSheet.getCell(row,1).font={bold:true,size:12,color:{argb:`FF${COLORS.navy}`}};const id=book.addImage({base64:chartImage(chart).toString("base64"),extension:"png"});chartSheet.addImage(id,{tl:{col:0,row},ext:{width:600,height:225},editAs:"oneCell"});row+=15;const labels=["Categoria",...chart.series.map(series=>series.name)];const headerRow=chartSheet.getRow(row);headerRow.values=labels;header(headerRow);for(let i=0;i<chart.categories.length;i++){const dataRow=chartSheet.getRow(++row);dataRow.values=[literal(chart.categories[i]),...chart.series.map(series=>series.values[i])];}row+=3;}
  }
  for(const [name,rows] of Object.entries(model.tables)) {
    const sheet=book.addWorksheet(sectionLabel(name).slice(0,31));banner(sheet,sectionLabel(name));
    if(!rows.length){sheet.getCell("A4").value="Sem dados no período";continue;}
    const columns=[...new Set(rows.flatMap(row=>Object.keys(row)))];header(sheet.addRow(columns.map(label)));
    for(const record of rows){const row=sheet.addRow(columns.map(key=>literal(record[key],key)));columns.forEach((key,index)=>{if(typeof record[key]==="number")row.getCell(index+1).numFmt=numericFormat(key);});}
    sheet.autoFilter={from:{row:3,column:1},to:{row:rows.length+3,column:columns.length}};
  }
  for(const sheet of book.worksheets){sheet.views=[{state:"frozen",ySplit:sheet.name==="Resumo"?2:3}];sheet.pageSetup={fitToPage:true,fitToWidth:1,fitToHeight:0,orientation:"landscape"};sheet.columns.forEach((column,index)=>{column.width=index===0?32:24;});sheet.eachRow((row,index)=>{if(index<=3)return;row.eachCell(cell=>{if(!cell.font?.bold)cell.font={name:"Aptos",size:10,color:{argb:`FF${COLORS.ink}`}};cell.alignment={vertical:"middle",wrapText:true};if(index%2===0&&cell.fill?.type!=="pattern")cell.fill=fill("F5F8FA");});});}
  const bytes=await book.xlsx.writeBuffer();if(bytes.byteLength>8*1024*1024)throw new Error("XLSX excede 8 MB.");return Buffer.from(bytes);
}
