import type { ReportModel } from "./reports.service.js";

export interface ReportChart {title:string;unit:string;kind:"bars"|"lines";categories:string[];series:{name:string;values:number[];color:string;dashed?:boolean}[];}
const number=(value:unknown)=>typeof value==="number"&&Number.isFinite(value)?value:0;
const rows=(model:ReportModel,key:string)=>model.tables[key]??[];
const truncate=(value:string,length=24)=>value.length>length?`${value.slice(0,length-1)}…`:value;
export function reportCharts(model:ReportModel):ReportChart[] {
  const charts:ReportChart[]=[];
  const addBars=(title:string,unit:string,categories:string[],values:number[],color="28649A")=>{
    if(categories.length&&values.some(value=>value>0))charts.push({title,unit,kind:"bars",categories,series:[{name:unit,values,color}]});
  };
  if(model.type==="ombudsman") {
    const types=rows(model,"types");addBars("Manifestações por tipo","Manifestações",types.map(row=>({complaint:"Reclamações",compliment:"Elogios",suggestion_other:"Sugestões e outros"} as Record<string,string>)[String(row.ticketType)]??String(row.ticketType)),types.map(row=>number(row.tickets)));
    const status=rows(model,"status");addBars("Manifestações por situação","Manifestações",status.map(row=>({resolved:"Resolvidas",pending:"Pendentes",open:"Abertas",in_contact_attempt:"Tentativa de contato",unresolved:"Não resolvidas",read:"Lidas",contact_attempt:"Contato tentado",contact_failed:"Contato sem sucesso"} as Record<string,string>)[String(row.status)]??String(row.status)),status.map(row=>number(row.tickets)),"178C88");
    const days=rows(model,"evolution");if(days.length&&days.some(row=>number(row.tickets)>0))charts.push({title:"Evolução das manifestações",unit:"Manifestações",kind:"lines",categories:days.map(row=>String(row.day).slice(5)),series:[{name:"Manifestações",values:days.map(row=>number(row.tickets)),color:"28649A"}]});
    return charts;
  }
  const started=number(model.indicators.started),completed=number(model.indicators.completed),incomplete=number(model.indicators.incomplete);
  addBars("Andamento das pesquisas","Pesquisas",["Iniciadas","Concluídas","Incompletas"],[started,completed,incomplete]);
  const days=rows(model,"evolution");if(days.length&&days.some(row=>number(row.started)>0))charts.push({title:"Evolução das pesquisas",unit:"Pesquisas",kind:"lines",categories:days.map(row=>String(row.day).slice(5)),series:[
    {name:"Iniciadas",values:days.map(row=>number(row.started)),color:"28649A",dashed:true},
    {name:"Concluídas",values:days.map(row=>number(row.complete??row.completed)),color:"178C88"},
  ]});
  const distribution=rows(model,"distribution");addBars("Distribuição das avaliações","Respostas",distribution.map(row=>`Nota ${row.score}`),distribution.map(row=>number(row.responses)),"178C88");
  if(number(model.indicators.npsResponses)>0&&typeof model.indicators.npsMean==="number")charts.push({title:"Nota média NPS",unit:"Nota média (0 a 10)",kind:"bars",categories:["NPS"],series:[{name:"Nota média NPS",values:[model.indicators.npsMean],color:"C99237"}]});
  const questions=rows(model,"questions");const ranked=questions.filter(row=>typeof row.mean==="number"&&number(row.responses)>=model.minimumResponses).slice(0,8);
  if((model.type==="questions"||model.type==="sector")&&ranked.length) addBars("Satisfação por pergunta","Nota média (1 a 5)",ranked.map(row=>truncate(String(row.text),18)),ranked.map(row=>number(row.mean)),"178C88");
  if(model.type==="general") {
    const sectors=rows(model,"sectors").filter(row=>number(row.started)>0).slice(0,8);
    addBars("Pesquisas por setor","Pesquisas iniciadas",sectors.map(row=>truncate(String(row.sectorName),18)),sectors.map(row=>number(row.started)));
    const shifts=rows(model,"shifts");addBars("Pesquisas por turno","Pesquisas concluídas",shifts.map(row=>truncate(String(row.name))),shifts.map(row=>number(row.completed)),"C99237");
  }
  return charts;
}
