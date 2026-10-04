import type {DrawingDimension,DrawingView} from './types';
import {createId} from '@/lib/sketch/render';
/** A circular bend is true-size only in its profile projection. Ellipses are excluded. */
export function bendAngles(view:DrawingView,angles:number[]):DrawingDimension[] {
 if(view.flattened||view.orientation==='iso'||!view.bendProfiles?.length) return [];
 const out:DrawingDimension[]=[];
 for(const arc of view.arcs??[]) {
  const u={x:arc.start.x-arc.x,y:arc.start.y-arc.y},v={x:arc.end.x-arc.x,y:arc.end.y-arc.y};
  const sweep=Math.acos(Math.max(-1,Math.min(1,(u.x*v.x+u.y*v.y)/(arc.radius**2))))*180/Math.PI;
  const bend=view.bendProfiles.find(b=>Math.hypot(b.x-arc.x,b.y-arc.y)<0.05 && (Math.abs(b.radius-arc.radius)<0.01||Math.abs(b.outerRadius-arc.radius)<0.01) && Math.abs(Math.abs(b.angle)-sweep)<0.05);
  if(sweep<1||sweep>179||!bend||!angles.some(a=>Math.abs(Math.abs(a)-sweep)<0.05)) continue;
  const lines=view.visibleLineEdges??view.lineEdges;
  const at=(p:{x:number;y:number})=>lines.filter(e=>{
    const dx=e.x2-e.x1,dy=e.y2-e.y1,l2=dx*dx+dy*dy;if(l2<1e-10)return false;
    const t=Math.max(0,Math.min(1,((p.x-e.x1)*dx+(p.y-e.y1)*dy)/l2));
    return Math.hypot(e.x1+t*dx-p.x,e.y1+t*dy-p.y)<0.01 && Math.abs((p.x-arc.x)*dx+(p.y-arc.y)*dy)/(arc.radius*Math.sqrt(l2))<1e-4;
  }).sort((a,b)=>Math.hypot(b.x2-b.x1,b.y2-b.y1)-Math.hypot(a.x2-a.x1,a.y2-a.y1))[0];
  const a=at(arc.start),b=at(arc.end);if(!a||!b||a===b) continue;
  const dx=a.x2-a.x1,dy=a.y2-a.y1,ex=b.x2-b.x1,ey=b.y2-b.y1,det=dx*ey-dy*ex;
  if(Math.abs(det)<1e-8) continue;
  if(Math.abs(u.x*dx+u.y*dy)/(arc.radius*Math.hypot(dx,dy))>1e-4||Math.abs(v.x*ex+v.y*ey)/(arc.radius*Math.hypot(ex,ey))>1e-4) continue;
  const t=((b.x1-a.x1)*ey-(b.y1-a.y1)*ex)/det;
  const center={x:a.x1+t*dx,y:a.y1+t*dy};
  const start=Math.atan2(arc.start.y-center.y,arc.start.x-center.x);
  let delta=Math.atan2(arc.end.y-center.y,arc.end.x-center.x)-start;
  while(delta>Math.PI)delta-=2*Math.PI;while(delta< -Math.PI)delta+=2*Math.PI;
  const value=Math.abs(delta)*180/Math.PI;
  if(out.some(d=>d.bendId===bend.id))continue;
  const x=view.x+(center.x-view.box.minX-view.box.width/2)*view.scale,y=view.y+(center.y-view.box.minY-view.box.height/2)*view.scale;
  out.push({id:createId(),bendId:bend.id,viewId:view.id,x1:x,y1:y,x2:x+1,y2:y,offset:14,value,automatic:true,angular:{start,delta}});
 }
 return out;
}
export function dimensionText(d:Pick<DrawingDimension,'value'|'precision'|'prefix'|'suffix'|'toleranceUpper'|'toleranceLower'|'angular'|'fitClass'|'tolerancePrecision'>,fallback=0){
 const n=(v:number)=>v.toLocaleString('pt-BR',{minimumFractionDigits:d.precision??0,maximumFractionDigits:d.precision??2});
 const tn=(v:number)=>v.toLocaleString('pt-BR',{minimumFractionDigits:d.tolerancePrecision??4,maximumFractionDigits:d.fitClass?Math.max(d.tolerancePrecision??4,(Number(v.toFixed(6)).toString().split('.')[1]??'').length):d.tolerancePrecision??4});
 const tolerance=d.toleranceUpper!==undefined||d.toleranceLower!==undefined?` ${ (d.toleranceUpper??0)>=0?'+':''}${tn(d.toleranceUpper??0)}/${(d.toleranceLower??0)>0?'−':(d.toleranceLower??0)<0?'+':''}${tn(Math.abs(d.toleranceLower??0))}`:'';
 return `${d.prefix??''}${n(d.value??fallback)}${d.angular?'°':''}${d.fitClass?' '+d.fitClass:''}${tolerance}${d.suffix??''}`;
}

export function angleBetweenLines(viewId:string,a:{x1:number;y1:number;x2:number;y2:number},b:{x1:number;y1:number;x2:number;y2:number}):DrawingDimension|null {
 const dx=a.x2-a.x1,dy=a.y2-a.y1,ex=b.x2-b.x1,ey=b.y2-b.y1,det=dx*ey-dy*ex;
 if(Math.abs(det)<1e-8) return null;
 const t=((b.x1-a.x1)*ey-(b.y1-a.y1)*ex)/det;
 const x=a.x1+t*dx,y=a.y1+t*dy;
 const direction=(e:typeof a)=>{
  const p=Math.hypot(e.x1-x,e.y1-y)>Math.hypot(e.x2-x,e.y2-y)?{x:e.x1,y:e.y1}:{x:e.x2,y:e.y2};
  return Math.atan2(p.y-y,p.x-x);
 };
 const start=direction(a);let delta=direction(b)-start;
 while(delta>Math.PI)delta-=2*Math.PI;while(delta< -Math.PI)delta+=2*Math.PI;
 if(Math.abs(delta)<1e-6)return null;
 return {id:createId(),viewId,x1:x,y1:y,x2:x+1,y2:y,offset:14,value:Math.abs(delta)*180/Math.PI,angular:{start,delta}};
}
