import { deflateSync } from "node:zlib";
import type { ReportChart } from "./reports.charts.js";

const width=600,height=225;
const rgb=(hex:string)=>[0,2,4].map(i=>Number.parseInt(hex.slice(i,i+2),16));
const crcTable=Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
function chunk(name:string,data:Buffer):Buffer {const tag=Buffer.from(name),length=Buffer.alloc(4),crc=Buffer.alloc(4);length.writeUInt32BE(data.length);let value=0xffffffff;for(const byte of Buffer.concat([tag,data]))value=crcTable[(value^byte)&255]!^(value>>>8);crc.writeUInt32BE((value^0xffffffff)>>>0);return Buffer.concat([length,tag,data,crc]);}
export function chartImage(chart:ReportChart):Buffer {
  const pixels=Buffer.alloc(width*height*4,255);
  const dot=(x:number,y:number,color:string)=>{x=Math.round(x);y=Math.round(y);if(x<0||x>=width||y<0||y>=height)return;const at=(y*width+x)*4;const c=rgb(color);pixels[at]=c[0]!;pixels[at+1]=c[1]!;pixels[at+2]=c[2]!;};
  const line=(x1:number,y1:number,x2:number,y2:number,color:string,dashed=false)=>{const steps=Math.max(1,Math.ceil(Math.hypot(x2-x1,y2-y1)));for(let i=0;i<=steps;i++){if(dashed&&Math.floor(i/7)%2)continue;const t=i/steps;for(let off=-1;off<=1;off++)dot(x1+(x2-x1)*t,y1+(y2-y1)*t+off,color);}};
  const rect=(x:number,y:number,w:number,h:number,color:string)=>{for(let py=Math.max(0,Math.floor(y));py<Math.min(height,y+h);py++)for(let px=Math.max(0,Math.floor(x));px<Math.min(width,x+w);px++)dot(px,py,color);};
  const x0=42,y0=14,pw=535,ph=178;
  for(let i=0;i<=4;i++)line(x0,y0+ph*i/4,x0+pw,y0+ph*i/4,"DCE5EB");
  const max=Math.max(1,...chart.series.flatMap(series=>series.values));const ceiling=chart.unit.includes("1 a 5")?5:chart.unit.includes("0 a 10")?10:Math.ceil(max*1.12);
  const count=chart.categories.length;
  if(chart.kind==="bars")chart.series[0]?.values.forEach((value,i)=>{const gap=pw/count,w=Math.min(42,gap*.6),h=value/ceiling*ph,barColor=chart.title==="Andamento das pesquisas"?["28649A","178C88","C99237"][i]!:chart.series[0]!.color;rect(x0+i*gap+(gap-w)/2,y0+ph-h,w,h,barColor);});
  else for(const series of chart.series){series.values.forEach((value,i)=>{if(!i)return;const previous=series.values[i-1]!;line(x0+(i-1)*pw/Math.max(1,count-1),y0+ph-previous/ceiling*ph,x0+i*pw/Math.max(1,count-1),y0+ph-value/ceiling*ph,series.color,series.dashed);});}
  let legendX=42;for(const series of chart.series){line(legendX,211,legendX+28,211,series.color,series.dashed);legendX+=155;}
  const raw=Buffer.alloc(height*(1+width*4));for(let y=0;y<height;y++)pixels.copy(raw,y*(1+width*4)+1,y*width*4,(y+1)*width*4);
  const header=Buffer.alloc(13);header.writeUInt32BE(width,0);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",header),chunk("IDAT",deflateSync(raw)),chunk("IEND",Buffer.alloc(0))]);
}
