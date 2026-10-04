import type {DrawingSheet} from './types';
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
/** Place text outside geometry and existing labels; the geometry anchor never changes. */
export function layoutLeaders(sheet:DrawingSheet):DrawingSheet {
 const {width,height}=sheetDimensionsMm(sheet);
 const occupied:Box[]=sheet.dimensions.map(d=>d.angular?{x:d.x1-Math.abs(d.offset)-6,y:d.y1-Math.abs(d.offset)-6,w:2*Math.abs(d.offset)+12,h:2*Math.abs(d.offset)+12}:labelBox(d));
 for(const v of sheet.views)occupied.push({x:v.x-v.box.width*v.scale/2,y:v.y-v.box.height*v.scale/2,w:v.box.width*v.scale,h:v.box.height*v.scale});
 for(const a of sheet.annotations)if('x' in a)occupied.push({x:a.x,y:a.y-4,w:Math.max(10,a.text.length*1.8),h:6});
 const labelObstacles=occupied.filter(b=>!sheet.views.some(v=>b.x===v.x-v.box.width*v.scale/2&&b.y===v.y-v.box.height*v.scale/2));
 const annotations=sheet.annotations.map(a=>{
  if(a.kind!=='leader')return a;
  const w=Math.max(12,a.text.length*1.9),h=6;
  const positions=[{x:a.x2,y:a.y2}];
  for(let radius=12;radius<=84;radius+=8)for(let i=0;i<16;i++){const angle=i*Math.PI/8;positions.push({x:a.x1+radius*Math.cos(angle),y:a.y1+radius*Math.sin(angle)});}
  for(const p of positions){const box={x:p.x+1,y:p.y-5,w,h};
   if(box.x<9||box.y<9||box.x+w>width-9||box.y+h>height-44||occupied.some(b=>overlaps(box,b))||labelObstacles.some(b=>crosses({x:a.x1,y:a.y1},p,b)))continue;
   occupied.push(box);labelObstacles.push(box);return {...a,x2:p.x,y2:p.y};
  }
  occupied.push({x:a.x2+1,y:a.y2-5,w,h});return a;
 });
 return {...sheet,annotations};
}
export function leaderDragPatch(a:{x1:number;y1:number;x2:number;y2:number},dx:number,dy:number){return {x1:a.x1,y1:a.y1,x2:a.x2+dx,y2:a.y2+dy};}
