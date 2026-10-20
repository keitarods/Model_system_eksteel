import type { Feature, SketchFeature } from './types';
import type { Point } from '@/lib/sketch/types';
import type { ProfileSource } from '@/lib/replicad/geometry';
import { bindSketchDependencies } from './sketchDependencies';

/** Recover the original stored profile, not a face of the final boolean result. */
export function editOperationSketch(features: Feature[], featureId: string, newId: () => string): { features: Feature[]; sketch: SketchFeature } {
  const linked = bindSketchDependencies(features);
  const index = linked.findIndex(f => f.id === featureId);
  const feature = linked[index];
  if (!feature) throw new Error('Operação não encontrada.');
  const sourceId = feature.sketchReference?.sketchId ?? (feature.type === 'loft' ? feature.sectionIds[0] : undefined);
  if (sourceId) {
    const source = linked.find(f => f.id === sourceId);
    if (source?.type !== 'sketch') throw new Error('O esboço de origem foi removido. Desfaça a remoção para recuperá-lo.');
    return {features: linked, sketch: source};
  }
  if (!('profile' in feature) && feature.type !== 'hole') throw new Error('Esta operação não utiliza um perfil de esboço.');
  const sketch: SketchFeature & { bodyGroupId?: string } = {
    id: newId(), type: 'sketch', label: `Esboço de ${feature.label}`, plane: feature.plane,
    shapes: [], points: {}, dimensions: [], constraints: [], fixedPointIds: [],
    ...(feature.bodyGroupId ? {bodyGroupId: feature.bodyGroupId} : {}),
  };
  function point(p: Point) { const id = newId(); sketch.points[id] = {id, x:p.x, y:p.y}; return id; }
  function boundary(profile: NonNullable<ProfileSource>): string[][] {
    if (profile.kind === 'region') {
      if ([profile.outer, ...profile.holes].some(p => p.kind === 'region')) throw new Error('Perfil com regiões aninhadas: recuperação automática de esboço não suportada.');
      return [profile.outer, ...profile.holes].flatMap(boundary);
    }
    const start = sketch.shapes.length;
    const id = newId();
    if (profile.kind === 'circle') sketch.shapes.push({id,type:'circle',center:point({x:profile.cx,y:profile.cy}),radius:profile.r});
    else if (profile.kind === 'rect') sketch.shapes.push({id,type:'rect',p1:point({x:profile.x1,y:profile.y1}),p2:point({x:profile.x2,y:profile.y2})});
    else if (profile.kind === 'slot') sketch.shapes.push({id,type:'slot',center1:point(profile.c1),center2:point(profile.c2),radius:profile.r});
    else {
      if (profile.points.length < 2) throw new Error('O perfil salvo não contém um contorno válido.');
      const vertices = profile.points.map(point);
      profile.points.forEach((_, i) => {
        const edge = {id:newId(),p1:vertices[i],p2:vertices[(i+1)%vertices.length]};
        const controls = profile.splineControls?.[i];
        const center = profile.arcCenters?.[i];
        if (controls) sketch.shapes.push({...edge,type:'spline',control1:point(controls[0]),control2:point(controls[1])});
        else if (center) sketch.shapes.push({...edge,type:'arc',center:point(center)});
        else sketch.shapes.push({...edge,type:'line'});
      });
    }
    return [sketch.shapes.slice(start).map(s => s.id)];
  }
  const profiles: NonNullable<ProfileSource>[] = 'profile' in feature ? (Array.isArray(feature.profile) ? feature.profile : [feature.profile])
    : [{kind:'circle',cx:feature.center.x,cy:feature.center.y,r:feature.radius},...(feature.extraHoles??[]).map(h => ({kind:'circle' as const,cx:h.center.x,cy:h.center.y,r:h.radius}))];
  const profileBoundaries = profiles.map(boundary);
  if (profiles.length === 1) sketch.profileWires = profileBoundaries[0];
  const profileShapeIds = profileBoundaries.flat(2);
  let axisShapeId: string | undefined;
  if (feature.type === 'revolve' || feature.type === 'helix') {
    axisShapeId = newId();
    sketch.shapes.push({id:axisShapeId,type:'line',isCenterLine:true,p1:point(feature.axisOrigin),p2:point({x:feature.axisOrigin.x+feature.axisDirection.x*100,y:feature.axisOrigin.y+feature.axisDirection.y*100})});
  }
  const operation = {...feature,sketchReference:{sketchId:sketch.id,profileShapeIds,profileBoundaries,axisShapeId}};
  return {features:[...linked.slice(0,index),sketch,operation,...linked.slice(index+1)],sketch};
}
