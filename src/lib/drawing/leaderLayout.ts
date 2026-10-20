import type {DrawingDimension,DrawingSheet} from './types';
import {sheetDimensionsMm} from './types';
import {labelBox} from './autoDimensions';
type Box={x:number;y:number;w:number;h:number};
const overlaps=(a:Box,b:Box)=>a.x<b.x+b.w+2&&a.x+a.w+2>b.x&&a.y<b.y+b.h+2&&a.y+a.h+2>b.y;
function crosses(a:{x:number;y:number},b:{x:number;y:number},box:Box){
 let lo=0,hi=1;
 for(const [origin,delta,min,max] of [[a.x,b.x-a.x,box.x-1,box.x+box.w+1],[a.y,b.y-a.y,box.y-1,box.y+box.h+1]]){
  if(Math.abs(delta)<1e-9){if(origin<min||origin>max)return false;continue;}
  const t1=(min-origin)/delta,t2=(max-origin)/delta;lo=Math.max(lo,Math.min(t1,t2));hi=Math.min(hi,Math.max(t1,t2));if(lo>hi)return false;
 }
 return true;
}
type Segment={a:{x:number;y:number};b:{x:number;y:number}};
function dimensionLine(d:DrawingDimension):Segment|null {
 if(d.angular)return null;
 const length=Math.hypot(d.x2-d.x1,d.y2-d.y1);
 if(length<1e-8)return null;
 const nx=-(d.y2-d.y1)/length,ny=(d.x2-d.x1)/length;
 return {a:{x:d.x1+nx*d.offset,y:d.y1+ny*d.offset},b:{x:d.x2+nx*d.offset,y:d.y2+ny*d.offset}};
}
function sameLane(a:Segment,b:Segment){
 const dx=a.b.x-a.a.x,dy=a.b.y-a.a.y,length=Math.hypot(dx,dy),ux=dx/length,uy=dy/length;
 const otherLength=Math.hypot(b.b.x-b.a.x,b.b.y-b.a.y);
 if(Math.abs(ux*(b.b.y-b.a.y)-uy*(b.b.x-b.a.x))>otherLength*.001)return false;
 const distance=Math.abs(ux*(b.a.y-a.a.y)-uy*(b.a.x-a.a.x));
 const t1=ux*(b.a.x-a.a.x)+uy*(b.a.y-a.a.y),t2=ux*(b.b.x-a.a.x)+uy*(b.b.y-a.a.y);
 return distance<7-1e-6 && Math.max(t1,t2)>-3 && Math.min(t1,t2)<length+3;
}
/** Place text outside geometry and existing labels; the geometry anchor never changes. */
export function layoutLeaders(sheet:DrawingSheet):DrawingSheet {
 const {width,height}=sheetDimensionsMm(sheet);
 const viewBoxes:Box[]=sheet.views.map(v=>({x:v.x-v.box.width*v.scale/2,y:v.y-v.box.height*v.scale/2,w:v.box.width*v.scale,h:v.box.height*v.scale}));
 const fixedBoxes:Box[]=sheet.annotations.filter(a=>'x' in a).map(a=>{const text=a as {x:number;y:number;text:string};return {x:text.x,y:text.y-4,w:Math.max(10,text.text.length*1.8),h:6};});
 const placed:Box[]=sheet.dimensions.filter(d=>!d.automatic).map(labelBox);
 const lines=sheet.dimensions.filter(d=>!d.automatic).map(dimensionLine).filter((l):l is Segment=>!!l);
 // Short local dimensions go nearest the part; overall dimensions occupy outer lanes.
 const ordered=[...sheet.dimensions].sort((a,b)=>Math.hypot(a.x2-a.x1,a.y2-a.y1)-Math.hypot(b.x2-b.x1,b.y2-b.y1));
 const arranged=new Map<string,DrawingDimension>();
 for(const d of ordered){
  const place=()=>{
  if(!d.automatic)return d;
  const offsets:number[]=[];
  for(let lane=0;lane<24;lane++) {
   const offset=8+lane*7;
   offsets.push(d.angular?offset:(Math.sign(d.offset)||1)*offset);

  }
  if(!d.angular)offsets.push(...offsets.map(v=>-v));
  for(const offset of offsets){
   const candidate={...d,offset},box=labelBox(candidate);
   if(box.x<9||box.y<9||box.x+box.w>width-9||box.y+box.h>height-44)continue;
   if([...placed,...viewBoxes,...fixedBoxes].some(b=>overlaps(box,b)))continue;
   const line=dimensionLine(candidate);
   if(line && (lines.some(other=>sameLane(line,other)) || placed.some(b=>crosses(line.a,line.b,b))))continue;
   if(lines.some(l=>crosses(l.a,l.b,box)))continue;
   if(line)lines.push(line);
   placed.push(box);return candidate;
  }
  const fallback=dimensionLine(d);if(fallback)lines.push(fallback);
  placed.push(labelBox(d));return d;
  };
  arranged.set(d.id,place());
 }
 const dimensions=sheet.dimensions.map(d=>arranged.get(d.id)!);
 sheet={...sheet,dimensions};
 const occupied:Box[]=dimensions.map(labelBox);
 for(const v of sheet.views)occupied.push({x:v.x-v.box.width*v.scale/2,y:v.y-v.box.height*v.scale/2,w:v.box.width*v.scale,h:v.box.height*v.scale});
 for(const a of sheet.annotations)if('x' in a)occupied.push({x:a.x,y:a.y-4,w:Math.max(10,a.text.length*1.8),h:6});
 const labelObstacles=occupied.filter(b=>!sheet.views.some(v=>b.x===v.x-v.box.width*v.scale/2&&b.y===v.y-v.box.height*v.scale/2));
 const annotations=sheet.annotations.map(a=>{
  if(a.kind!=='leader')return a;
  const w=Math.max(12,a.text.length*1.9),h=6;
  const positions=[{x:a.x2,y:a.y2}];
  for(let radius=12;radius<=84;radius+=8)for(let i=0;i<16;i++){const angle=i*Math.PI/8;positions.push({x:a.x1+radius*Math.cos(angle),y:a.y1+radius*Math.sin(angle)});}
  for(const p of positions){const box={x:p.x+1,y:p.y-5,w,h};
   if(box.x<9||box.y<9||box.x+w>width-9||box.y+h>height-44||occupied.some(b=>overlaps(box,b))||labelObstacles.some(b=>crosses({x:a.x1,y:a.y1},p,b))||lines.some(l=>crosses(l.a,l.b,box)))continue;
   occupied.push(box);labelObstacles.push(box);return {...a,x2:p.x,y2:p.y};
  }
  occupied.push({x:a.x2+1,y:a.y2-5,w,h});return a;
 });
 return {...sheet,annotations};
}
export function leaderDragPatch(a:{x1:number;y1:number;x2:number;y2:number},dx:number,dy:number){return {x1:a.x1,y1:a.y1,x2:a.x2+dx,y2:a.y2+dy};}
