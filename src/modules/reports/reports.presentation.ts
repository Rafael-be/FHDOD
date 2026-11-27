import { existsSync, readFileSync } from "node:fs";
import { extname } from "node:path";
import type { ReportModel } from "./reports.service.js";

export const COLORS = {navy:"153963",blue:"28649A",teal:"178C88",gold:"C99237",ink:"243447",muted:"64748B",pale:"EAF1F6",line:"DCE5EB"};
const labels:Record<string,string> = {
  started:"Pesquisas iniciadas",completed:"Pesquisas concluídas",complete:"Pesquisas concluídas",incomplete:"Pesquisas incompletas",
  completionRate:"Taxa de conclusão",satisfactionMean:"Satisfação média",npsMean:"Nota média NPS",npsResponses:"Respostas NPS",
  positivePercentage:"Percentual de avaliações positivas",responses:"Respostas",score:"Nota",mean:"Média de satisfação",
  skipped:"Respostas ignoradas",day:"Dia",name:"Turno",sectorId:"Código do setor",sectorName:"Setor",
  questionId:"Código da pergunta",questionVersionId:"Versão da pergunta",text:"Pergunta",position:"Ordem",distribution:"Distribuição de notas",
  insufficientSample:"Amostra insuficiente",total:"Total de manifestações",resolved:"Manifestações resolvidas",pending:"Manifestações pendentes",
  resolutionPercentage:"Taxa de resolução",complaints:"Reclamações",compliments:"Elogios",suggestionsOther:"Sugestões e outros",
  ombudsmanTotal:"Manifestações da Ouvidoria",ticketType:"Tipo de manifestação",tickets:"Manifestações",status:"Situação",
  percentage:"Percentual",is_nps:"É NPS",isNps:"É NPS",sector_id:"Código do setor",question_id:"Código da pergunta",
  question_version_id:"Versão da pergunta",nps_responses:"Respostas NPS",nps:"Nota média NPS",
};
const sections:Record<string,string>={distribution:"Distribuição das avaliações",evolution:"Evolução no período",sectors:"Resultados por setor",shifts:"Pesquisas por turno",critical:"Perguntas com menor satisfação",questions:"Resultados por pergunta",ombudsman:"Ouvidoria",types:"Tipos de manifestação",status:"Situação das manifestações"};
const values:Record<string,string>={complaint:"Reclamação",compliment:"Elogio",suggestion_other:"Sugestão ou outro",resolved:"Resolvida",pending:"Pendente",open:"Aberta",in_contact_attempt:"Tentativa de contato",unresolved:"Não resolvida",read:"Lida",contact_attempt:"Contato tentado",contact_failed:"Contato sem sucesso"};
const nf=new Intl.NumberFormat("pt-BR",{maximumFractionDigits:0});
const decimal=new Intl.NumberFormat("pt-BR",{minimumFractionDigits:1,maximumFractionDigits:1});
const dateTime=new Intl.DateTimeFormat("pt-BR",{timeZone:"America/Sao_Paulo",day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"});
const date=new Intl.DateTimeFormat("pt-BR",{timeZone:"America/Sao_Paulo",day:"2-digit",month:"2-digit",year:"numeric"});
const parts=new Intl.DateTimeFormat("en-US",{timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"});
export const label=(key:string)=>labels[key]??key.replace(/([a-z])([A-Z])/g,"$1 $2").replace(/_/g," ");
export const sectionLabel=(key:string)=>sections[key]??label(key);
export const localDate=(value:string)=>date.format(new Date(value));
export const localDateTime=(value:string)=>dateTime.format(new Date(value));
function midnight(value:string):boolean {const p=Object.fromEntries(parts.formatToParts(new Date(value)).map(x=>[x.type,x.value]));return p.hour==="00"&&p.minute==="00"&&p.second==="00";}
export function period(model:ReportModel):string {
  const from=new Date(model.filters.from),to=new Date(model.filters.to);
  if(midnight(model.filters.from)&&midnight(model.filters.to)) {
    // The normalized end is an exclusive local midnight. Use the prior instant only in this case.
    return `${date.format(from)} a ${date.format(new Date(to.getTime()-1))}`;
  }
  return `${dateTime.format(from)} a ${dateTime.format(to)} (fim exclusivo)`;
}
export function formatted(key:string,value:unknown):string {
  if(value===null||value===undefined)return "Sem dados";
  if(typeof value==="boolean")return value?"Sim":"Não";
  if(Array.isArray(value))return value.map(item=>typeof item==="object"&&item!==null&&"score" in item&&"responses" in item?`${String(item.score)}: ${nf.format(Number(item.responses))}`:String(item)).join(" · ");
  if(typeof value==="number") {
    if(["completionRate","positivePercentage","resolutionPercentage","percentage"].includes(key))return `${decimal.format(value).replace(/,0$/,'')}%`;
    if(["satisfactionMean","mean"].includes(key))return `${decimal.format(value)} / 5`;
    if(["npsMean","nps"].includes(key))return `${decimal.format(value)} / 10`;
    return nf.format(value);
  }
  if(key==="day"&&/^\d{4}-\d{2}-\d{2}$/.test(value as string))return `${String(value).slice(8,10)}/${String(value).slice(5,7)}/${String(value).slice(0,4)}`;
  return values[String(value)]??String(value);
}
export function numericFormat(key:string):string {
  if(["completionRate","positivePercentage","resolutionPercentage","percentage"].includes(key))return '0.##"%"';
  if(["satisfactionMean","mean"].includes(key))return '0.0" / 5"';
  if(["npsMean","nps"].includes(key))return '0.0" / 10"';
  return "#,##0";
}
export function officialLogo():{bytes:Buffer;extension:"png"|"jpeg"}|null {
  const path=process.env.REPORT_LOGO_PATH;
  if(!path||!existsSync(path))return null;
  const extension=extname(path).toLowerCase();
  if(![".png",".jpg",".jpeg"].includes(extension))return null;
  const bytes=readFileSync(path);
  const png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const jpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
  if(!(png||jpeg))return null;
  return {bytes,extension:png?"png":"jpeg"};
}
export const organizationName=()=>process.env.REPORT_ORGANIZATION_NAME?.trim()||"FHDOD";
