import { z } from "zod";

const id = z.number().int().positive().max(2147483647);
const dateInput = z.union([z.iso.date(), z.iso.datetime({ offset: true })]);
const base = z.strictObject({
  type: z.enum(["general", "sector", "questions", "ombudsman"]),
  from: dateInput.optional(),
  to: dateInput.optional(),
  sectorId: id.nullish(),
});
const localParts = new Intl.DateTimeFormat("en-US", {timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"});
function saoPauloParts(instant:Date) {
  const parts=Object.fromEntries(localParts.formatToParts(instant).map(part=>[part.type,part.value]));
  return {year:Number(parts.year),month:Number(parts.month),day:Number(parts.day),hour:Number(parts.hour),minute:Number(parts.minute),second:Number(parts.second)};
}
function dayString(instant:Date):string {
  const p=saoPauloParts(instant);
  return `${p.year}-${String(p.month).padStart(2,"0")}-${String(p.day).padStart(2,"0")}`;
}
function nextDay(day:string):string {
  const instant=new Date(`${day}T00:00:00Z`);
  instant.setUTCDate(instant.getUTCDate()+1);
  return instant.toISOString().slice(0,10);
}
function zonedStart(day:string):string {
  const target=Date.parse(`${day}T00:00:00Z`);
  let instant=target;
  for(let i=0;i<3;i++){
    const p=saoPauloParts(new Date(instant));
    const local=Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second);
    instant=target-(local-instant);
  }
  return new Date(instant).toISOString();
}
const dateOnly=(value:string)=>/^\d{4}-\d{2}-\d{2}$/.test(value);
function normalize<T extends {from?:string;to?:string}>(value:T):T & {from:string;to:string} {
  const today=dayString(new Date());
  const first=new Date(`${today}T00:00:00Z`);first.setUTCDate(first.getUTCDate()-29);
  const defaultFrom=first.toISOString().slice(0,10);
  const from=value.from??defaultFrom,to=value.to??today;
  return {...value,from:dateOnly(from)?zonedStart(from):from,to:dateOnly(to)?zonedStart(nextDay(to)):to};
}
function validate(value:{type:string;from?:string;to?:string;sectorId?:number|null},context:z.RefinementCtx) {
  if ((value.from===undefined)!==(value.to===undefined)) context.addIssue({code:"custom",path:[value.from===undefined?"from":"to"],message:"Informe as duas datas ou nenhuma."});
  if (value.type==="sector" && value.sectorId==null) context.addIssue({code:"custom",path:["sectorId"],message:"Informe o setor."});
  if (value.from!==undefined && value.to!==undefined) {
    const normalized=normalize(value);
    const duration=Date.parse(normalized.to)-Date.parse(normalized.from);
    const calendarDays=dateOnly(value.from)&&dateOnly(value.to)
      ? (Date.parse(`${value.to}T00:00:00Z`)-Date.parse(`${value.from}T00:00:00Z`))/86400000+1:null;
    if (duration<=0 || (calendarDays===null?duration>366*86400000:calendarDays>366))
      context.addIssue({code:"custom",path:["to"],message:"Informe um período crescente de no máximo 366 dias."});
  }
}
export const reportRequest=base.superRefine(validate).transform(normalize);
export const downloadRequest=base.safeExtend({format:z.enum(["pdf","xlsx"])}).superRefine(validate).transform(normalize);
export type ReportRequest=z.output<typeof reportRequest>;
