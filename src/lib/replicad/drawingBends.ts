import {lookFromPlane} from 'replicad';
import type {FlattenLink} from './sheetMetal';
import type {ViewOrientation} from '@/lib/drawing/types';
export type NativeDrawingBend={id:string;label:string;link:FlattenLink};
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
