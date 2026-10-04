import { fullContourLines } from "./roundedContour";
import type { DrawingAnnotation, DrawingDimension, DrawingView } from './types';
import { createId } from '@/lib/sketch/render';

export function labelBox(d: DrawingDimension) {
  const length=Math.hypot(d.x2-d.x1,d.y2-d.y1)||1;
  const x=(d.x1+d.x2)/2-(d.y2-d.y1)/length*d.offset;
  const y=(d.y1+d.y2)/2+(d.x2-d.x1)/length*d.offset;
  const w=Math.max(16,(d.value??length).toFixed(2).length*1.8+2);
  return {x:x-w/2,y:y-2.5,w,h:5};
}

/** Dimensions are measured in model millimetres; coordinates and spacing are paper mm. */
export function autoDimensions(view: DrawingView, details = true): DrawingDimension[] {
  if (view.orientation === 'iso' || !(view.scale > 0)) return [];
  const {minX, minY, width, height} = view.box;
  const result: DrawingDimension[] = [];
  const point = (x:number,y:number) => ({x:view.x+(x-minX-width/2)*view.scale,y:view.y+(y-minY-height/2)*view.scale});
  function add(x1:number,y1:number,x2:number,y2:number,offset:number) {
    const a=point(x1,y1), b=point(x2,y2), value=Math.hypot(x2-x1,y2-y1);
    if(value<1e-5) return;
    result.push({id:createId(),viewId:view.id,x1:a.x,y1:a.y,x2:b.x,y2:b.y,offset,value,automatic:true});
  }
  add(minX,minY,minX+width,minY,-16);
  add(minX,minY,minX,minY+height,16);
  // Extension lines start at actual projected geometry, not fictitious box corners.
  const references=(view.visibleLineEdges??view.lineEdges).flatMap(e=>[{x:e.x1,y:e.y1},{x:e.x2,y:e.y2}]);
  for(const c of view.circles??[]) references.push({x:c.x-c.radius,y:c.y},{x:c.x+c.radius,y:c.y},{x:c.x,y:c.y-c.radius},{x:c.x,y:c.y+c.radius});
  const extreme=(axis:'x'|'y',value:number)=>references.filter(p=>Math.abs(p[axis]-value)<1e-4).sort((a,b)=>axis==='x'?a.y-b.y:a.x-b.x)[0];
  const refs=[[extreme('x',minX),extreme('x',minX+width)],[extreme('y',minY),extreme('y',minY+height)]];
  result.forEach((d,i)=>{if(refs[i]?.[0]) d.reference1=point(refs[i][0]!.x,refs[i][0]!.y);if(refs[i]?.[1]) d.reference2=point(refs[i][1]!.x,refs[i][1]!.y);});
  if (!details) return result;
  // Dimension meaningful visible outline segments, not every projected vertex.
  // Inner/hidden edges and tiny thickness/sliver edges must not create chains.
  const edges=fullContourLines(view.visibleLineEdges ?? view.lineEdges,view.arcs??[]);
  const vertices=edges.flatMap(e=>[{x:e.x1,y:e.y1},{x:e.x2,y:e.y2}]);
  const candidates=edges.filter(e=>{
    const dx=e.x2-e.x1,dy=e.y2-e.y1,len=Math.hypot(dx,dy);
    if(len < Math.max(2,Math.max(width,height)*0.035) || len*view.scale<7) return false;
    const sides=vertices.map(p=>(dx*(p.y-e.y1)-dy*(p.x-e.x1))/len);
    // Supporting straight segments of the outline (includes inclined flanges).
    return view.flattened || sides.every(d=>d>=-0.05)||sides.every(d=>d<=0.05);
  }).sort((a,b)=>Math.hypot(b.x2-b.x1,b.y2-b.y1)-Math.hypot(a.x2-a.x1,a.y2-a.y1));
  const textBoxes=result.map(d=>labelBox(d));
  for(const e of candidates) {
    if(result.length>=12) break;
    const dx=e.x2-e.x1,dy=e.y2-e.y1,len=Math.hypot(dx,dy);
    if(result.some(d=>Math.abs((d.value??0)-len)<0.05&&Math.abs((d.x2-d.x1)*dy-(d.y2-d.y1)*dx)<0.05)) continue;
    const nx=-dy/len,ny=dx/len;
    const sign=nx*((e.x1+e.x2)/2-minX-width/2)+ny*((e.y1+e.y2)/2-minY-height/2)>=0?1:-1;
    const mid={x:(e.x1+e.x2)/2,y:(e.y1+e.y2)/2};
    const clearance=Math.max(...vertices.map(p=>sign*(nx*(p.x-mid.x)+ny*(p.y-mid.y))))*view.scale;
    for(let lane=0;lane<3;lane++) {
      add(e.x1,e.y1,e.x2,e.y2,sign*(Math.max(0,clearance)+8+lane*7));
      const d=result[result.length-1],box=labelBox(d);
      if(textBoxes.some(b=>box.x<b.x+b.w+2&&box.x+box.w+2>b.x&&box.y<b.y+b.h+2&&box.y+box.h+2>b.y)) {result.pop();continue;}
      textBoxes.push(box);break;
    }
  }
  return result;
}

/** One diameter callout per visible circular size; no inferred threads or fits. */
export function autoCircleNotes(view: DrawingView): DrawingAnnotation[] {
  if(view.orientation==='iso') return [];
  const groups=new Map<string, NonNullable<DrawingView['circles']>>();
  for(const c of view.circles??[]) {const key=c.radius.toFixed(4); groups.set(key,[...(groups.get(key)??[]),c]);}
  return [...groups.values()].slice(0,5).map((circles,i)=>{
    const c=circles[0];
    const x1=view.x+(c.x+c.radius-view.box.minX-view.box.width/2)*view.scale;
    const y1=view.y+(c.y-view.box.minY-view.box.height/2)*view.scale;
    return {id:createId(),viewId:view.id,kind:'leader',x1,y1,x2:view.x+view.box.width*view.scale/2+5,y2:view.y-view.box.height*view.scale/2+i*7,
      text:`${circles.length>1?circles.length+' × ':''}⌀ ${(c.radius*2).toLocaleString('pt-BR',{maximumFractionDigits:2})}`};
  });
}

export type DrawingBend = { id?:string; label:string; length:number; angle:number; innerRadius?:number };
/** Feature parameters, not angles guessed from foreshortened projected edges. */
export function bendSchedule(bends: DrawingBend[], x=235, y=150): DrawingAnnotation[] {
  const number=(n:number)=>n.toLocaleString('pt-BR',{maximumFractionDigits:2});
  return [
    {id:createId(),viewId:null,kind:'text',x,y,text:'DOBRAS — parâmetros do modelo'},
    {id:createId(),viewId:null,kind:'text',x,y:y+6,text:'Aba: comprimento antes de dobrar; giro: ângulo da operação'},
    ...bends.map((b,i):DrawingAnnotation=>({id:createId(),viewId:null,kind:'text',x,y:y+14+i*6,
      text:`${i+1}. ${b.label} | Aba ${number(b.length)} mm | Giro ${number(b.angle)}°${b.innerRadius!==undefined?' | Ri '+number(b.innerRadius)+' mm':''}`})),
  ];
}

/** One radius indication for each distinct visible circular-arc radius. */
export function autoRadiusNotes(view: DrawingView): DrawingAnnotation[] {
  if(view.orientation==='iso') return [];
  const groups=new Map<string,NonNullable<DrawingView['arcs']>>();
  for(const arc of view.arcs??[]) {const key=arc.radius.toFixed(4);groups.set(key,[...(groups.get(key)??[]),arc]);}
  return [...groups.values()].map((arcs,i)=>{
    const arc=arcs[0];
    const x1=view.x+(arc.mid.x-view.box.minX-view.box.width/2)*view.scale;
    const y1=view.y+(arc.mid.y-view.box.minY-view.box.height/2)*view.scale;
    return {id:'auto-radius-'+createId(),viewId:view.id,kind:'leader',x1,y1,
      x2:x1+(arc.mid.x-arc.x)/arc.radius*(12+i*7),y2:y1+(arc.mid.y-arc.y)/arc.radius*(12+i*7),
      text:`${arcs.length>1?arcs.length+' × ':''}R${arc.radius.toLocaleString('pt-BR',{maximumFractionDigits:2})}`};
  });
}
