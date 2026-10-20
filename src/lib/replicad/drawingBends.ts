import {lookFromPlane} from 'replicad';
import {pointOnFlange,undoFlattenChain,undoFlattenChainDir,type FlattenLink} from './sheetMetal';
import type {ViewOrientation} from '@/lib/drawing/types';
export type NativeDrawingBend={id:string;label:string;link:FlattenLink;chain?:FlattenLink[]};
export type BendProfile={id:string;label:string;x:number;y:number;radius:number;outerRadius:number;angle:number};
/** Match in camera coordinates, only when the bend axis is normal to the view. */
export function projectBends(bends:NativeDrawingBend[],orientation:ViewOrientation):BendProfile[]{
 if(orientation==='iso')return [];
 const camera=lookFromPlane(orientation),dir=camera.direction,x=camera.xAxis,y=camera.yAxis,origin=camera.position;
 try {
  return bends.flatMap(({id,label,link:b})=>{
   const alignment=Math.abs(b.axisDir[0]*dir.x+b.axisDir[1]*dir.y+b.axisDir[2]*dir.z);
   if(alignment<1-1e-6)return [];
   const c=b.axisPoint.map((v,i)=>v+b.yDir[i]*b.radius*b.vSign);
   const v=[c[0]-origin.x,c[1]-origin.y,c[2]-origin.z];
   return [{id,label,x:v[0]*x.x+v[1]*x.y+v[2]*x.z,y:-(v[0]*y.x+v[1]*y.y+v[2]*y.z),radius:b.radius,outerRadius:b.radius+b.thickness,angle:b.angleDeg}];
  });
 }finally{dir.delete();x.delete();y.delete();origin.delete();camera.delete();}
}

export type FlatBendGeometry = {id:string;label:string;angle?:number;measurePanel?:boolean;measureWidth?:boolean;line:{x1:number;y1:number;x2:number;y2:number};panel:{x1:number;y1:number;x2:number;y2:number};width:{x1:number;y1:number;x2:number;y2:number}};
/** Native panel references, including true-length profile projections. */
export function projectFlatBends(bends:NativeDrawingBend[],orientation:ViewOrientation, flattened = true):FlatBendGeometry[] {
 if(orientation==='iso')return [];
 const camera=lookFromPlane(orientation),dir=camera.direction,x=camera.xAxis,y=camera.yAxis,origin=camera.position;
 const point=(p:number[])=>({x:(p[0]-origin.x)*x.x+(p[1]-origin.y)*x.y+(p[2]-origin.z)*x.z,y:-((p[0]-origin.x)*y.x+(p[1]-origin.y)*y.y+(p[2]-origin.z)*y.z)});
 const segment=(a:number[],b:number[])=>{const p=point(a),q=point(b);return {x1:p.x,y1:p.y,x2:q.x,y2:q.y};};
 try{return bends.flatMap(b=>{
  const link=b.link,parent=b.chain?.slice(0,-1)??[];
  const top=pointOnFlange(link,[0,0,0]),bottom=pointOnFlange(link,[0,0,-1]);
  const normal=flattened ? undoFlattenChainDir(parent,link.n) : bottom.map((v,i)=>(v-top[i])/link.thickness);
  if(flattened && Math.abs(normal[0]*dir.x+normal[1]*dir.y+normal[2]*dir.z)<1-1e-6)return [];
  const start=undoFlattenChain(parent,link.axisPoint);
  const along=undoFlattenChainDir(parent,link.axisDir),out=undoFlattenChainDir(parent,link.outDir);
  const at=(u:number,v:number)=>flattened ? start.map((p,i)=>p+along[i]*u+out[i]*v) : pointOnFlange(link,[u/link.edgeLength,(v-link.allowance)/link.length,0]);
  const end=link.allowance+link.length;
  // In development the reference is the bend centre, not the tangent line.
  // In the folded view use the complete straight panel at its boundary.
  const panel=segment(at(0,flattened ? link.allowance/2 : link.allowance),at(0,end));
  const width=segment(at(0,end),at(link.edgeLength,end));
  const length=(s:typeof panel)=>Math.hypot(s.x2-s.x1,s.y2-s.y1);
  const measurePanel=Math.abs(length(panel)-(flattened ? link.length+link.allowance/2 : link.length))<1e-5;
  const faceOn=Math.abs(normal[0]*dir.x+normal[1]*dir.y+normal[2]*dir.z)>1-1e-6;
  const measureWidth=faceOn && Math.abs(length(width)-link.edgeLength)<1e-5;
  if(!measurePanel&&!measureWidth)return [];
  // A web shared by successive bends does not have one unambiguous bend angle.
  const shared=bends.some(other=>other.id!==b.id && other.chain?.slice(0,-1).includes(link));
  return [{id:b.id,label:b.label,angle:!flattened && shared ? undefined : link.angleDeg,measurePanel,measureWidth,
    line:segment(at(0,link.allowance/2),at(link.edgeLength,link.allowance/2)),panel,width}];
 });}finally{dir.delete();x.delete();y.delete();origin.delete();camera.delete();}
}
