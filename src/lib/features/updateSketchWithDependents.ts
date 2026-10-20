import { activeFeatures } from './suppression';
import type { Feature, SketchFeature } from './types';
import type { Point } from '@/lib/sketch/types';
import type { ProfileSource } from '@/lib/replicad/geometry';
import { localToWorldPoint, worldToLocalPoint } from '@/lib/replicad/plane';
import { attachFlangeReferences } from '@/lib/replicad/build-model';
import { bindSketchDependencies, resolveSketchDependencies } from './sketchDependencies';
type Vec3 = [number, number, number];
type Segment = {key: string; a: Point; b: Point};

function segments(profile: NonNullable<ProfileSource>, key: string): Segment[] {
  if (profile.kind === 'region') return [...segments(profile.outer, `${key}/outer`), ...profile.holes.flatMap((p,i)=>segments(p,`${key}/hole${i}`))];
  const points = profile.kind === 'rect' ? [{x:profile.x1,y:profile.y1},{x:profile.x2,y:profile.y1},{x:profile.x2,y:profile.y2},{x:profile.x1,y:profile.y2}]
    : profile.kind === 'loop' ? profile.points : [];
  return points.flatMap((a,i) => profile.kind === 'loop' && (profile.arcCenters?.[i] || profile.splineControls?.[i]) ? []
    : [{key:`${key}/${i}`,a,b:points[(i+1)%points.length]}]);
}
function fraction(point: Point, edge: Segment): number | null {
  const dx=edge.b.x-edge.a.x, dy=edge.b.y-edge.a.y, length=dx*dx+dy*dy;
  if (length<1e-12) return null;
  const t=((point.x-edge.a.x)*dx+(point.y-edge.a.y)*dy)/length;
  return t >= -1e-6 && t <= 1+1e-6 && Math.hypot(point.x-edge.a.x-t*dx,point.y-edge.a.y-t*dy)<1e-5 ? t : null;
}

/** Carry bend attachments along unchanged sketch entities before validating the new solid. */
export function updateSketchWithDependents(features: Feature[], replacement: SketchFeature): Feature[] {
  const linked=bindSketchDependencies(features);
  const attached=attachFlangeReferences(linked);
  const previous=resolveSketchDependencies(activeFeatures(attached));
  const proposed=attached.map(f=>f.id===replacement.id?{...f,...replacement}:f);
  const resolved=resolveSketchDependencies(activeFeatures(proposed));
  const oldSketch=attached.find(f=>f.id===replacement.id && f.type==='sketch');
  const topologyStable=oldSketch?.type==='sketch' && oldSketch.shapes.length===replacement.shapes.length
    && oldSketch.shapes.every(s=>replacement.shapes.some(n=>n.id===s.id && n.type===s.type
      && (!('p1' in s) || 'p1' in n && s.p1===n.p1 && s.p2===n.p2)));
  return proposed.map(feature=>{
    if(feature.type!=='flange')return feature;
    const before=previous.find(f=>f.id===feature.parentId);
    const after=resolved.find(f=>f.id===feature.parentId);
    if(before?.type!=='face' || after?.type!=='face' || before.sketchReference?.sketchId!==replacement.id)return feature;
    if(JSON.stringify([before.profile,before.plane])===JSON.stringify([after.profile,after.plane]))return feature;
    const fail=():never=>{throw new Error(`Flange "${feature.label}": a aresta de origem mudou de topologia. Corrija o contorno antes de concluir o esboço.`);};
    if(!topologyStable)return fail();
    const edges=(profile:typeof before.profile)=>(Array.isArray(profile)?profile:[profile]).flatMap((p,i)=>segments(p,String(i)));
    const oldEdges=edges(before.profile),newEdges=edges(after.profile);
    const start=worldToLocalPoint(before.plane,feature.edgeStart),end=worldToLocalPoint(before.plane,feature.edgeEnd);
    const matches=oldEdges.flatMap(edge=>{
      const a=fraction(start,edge),b=fraction(end,edge);
      return a!==null && b!==null ? [{edge,a,b}]:[];
    });
    if(matches.length!==1)return fail();
    const match=matches[0],edge=newEdges.find(e=>e.key===match.edge.key);
    if(!edge)return fail();
    const place=(point:Vec3,t:number):Vec3=>{
      const oldNormal=before.plane.normal,oldLength=Math.hypot(...oldNormal);
      const offset=point.reduce((sum,v,i)=>sum+(v-before.plane.origin[i])*oldNormal[i]/oldLength,0);
      const world=localToWorldPoint(after.plane,{x:edge.a.x+t*(edge.b.x-edge.a.x),y:edge.a.y+t*(edge.b.y-edge.a.y)});
      const length=Math.hypot(...after.plane.normal);
      return world.map((v,i)=>v+offset*after.plane.normal[i]/length) as Vec3;
    };
    return {...feature,edgeStart:place(feature.edgeStart,match.a),edgeEnd:place(feature.edgeEnd,match.b)};
  });
}
