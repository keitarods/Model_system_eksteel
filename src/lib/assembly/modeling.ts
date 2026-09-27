import type { Feature, SketchFeature } from '@/lib/features/types';
import type { SketchPlane } from '@/lib/sketch/types';
import { findProfileSource } from '@/lib/replicad/geometry';

export type ProfileParameters = {
  shape: 'rectangle' | 'circle' | 'triangle';
  plane: 'XY' | 'XZ' | 'YZ';
  x: number; y: number; offset: number; width: number; height: number;
};
export function createAssemblySketch(p: ProfileParameters, id: string): SketchFeature {
  if (![p.x,p.y,p.offset,p.width,p.height].every(Number.isFinite) || p.width <= 0 || p.height <= 0) throw new Error('Informe dimensões positivas e coordenadas válidas.');
  const plane: SketchPlane = p.plane === 'XY'
    ? {origin:[0,0,p.offset],normal:[0,0,1],xDir:[1,0,0]}
    : p.plane === 'XZ' ? {origin:[0,p.offset,0],normal:[0,-1,0],xDir:[1,0,0]}
    : {origin:[p.offset,0,0],normal:[1,0,0],xDir:[0,1,0]};
  const points = { a:{id:'a',x:p.x,y:p.y}, b:{id:'b',x:p.x+p.width,y:p.y+p.height}, c:{id:'c',x:p.x+p.width,y:p.y} };
  return {id,type:'sketch',label:`Sketch ${p.plane}`,plane,points,dimensions:[],shapes:
    p.shape === 'circle' ? [{id:'profile',type:'circle',center:'a',radius:p.width/2}]
    : p.shape === 'rectangle' ? [{id:'profile',type:'rect',p1:'a',p2:'b'}]
    : [{id:'ab',type:'line',p1:'a',p2:'c'},{id:'bc',type:'line',p1:'c',p2:'b'},{id:'ca',type:'line',p1:'b',p2:'a'}]};
}
export function createAssemblyOperation(sketch: SketchFeature, kind: 'extrude'|'revolve', value: number, cut: boolean, reversed: boolean, axis: 'X'|'Y', id: string): Feature {
  if (!Number.isFinite(value) || value <= 0 || (kind === 'revolve' && value > 360)) throw new Error(kind === 'revolve' ? 'Informe um ângulo entre 0 e 360°.' : 'Informe uma distância positiva.');
  const profile = findProfileSource(sketch.shapes,sketch.points);
  if (!profile) throw new Error('O sketch precisa de um perfil fechado.');
  const common = {id,label:`${cut ? 'Corte por ' : ''}${kind === 'extrude' ? 'Extrusão' : 'Revolução'}`,plane:sketch.plane,profile,cut};
  return kind === 'extrude' ? {...common,type:'extrude',depth:value,direction:reversed?'flipped':'normal'}
    : {...common,type:'revolve',angle:value,reversed,axisOrigin:{x:0,y:0},axisDirection:axis==='X'?{x:1,y:0}:{x:0,y:1}};
}
