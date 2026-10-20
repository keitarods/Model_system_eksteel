import type { Feature, SketchFeature } from './types';
import { findProfileSources, findCenterLine, reconstructedSketchProfile, type ProfileSource } from '@/lib/replicad/geometry';

// References retain entity identity, never the position in a list of profiles.
export type SketchReference = { sketchId: string; profileShapeIds: string[]; profileBoundaries?: string[][][]; region?: boolean; axisShapeId?: string };
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function validProfile(profile: ProfileSource): boolean {
  if (!profile) return false;
  const finite = (...values: number[]) => values.every(Number.isFinite);
  switch (profile.kind) {
    case 'region': return validProfile(profile.outer) && profile.holes.every(validProfile);
    case 'circle': return finite(profile.cx, profile.cy, profile.r) && profile.r > 0;
    case 'rect': return finite(profile.x1, profile.y1, profile.x2, profile.y2) && profile.x1 !== profile.x2 && profile.y1 !== profile.y2;
    case 'slot': return finite(profile.c1.x, profile.c1.y, profile.c2.x, profile.c2.y, profile.r) && profile.r > 0;
    case 'loop': return profile.points.length >= 2 && profile.points.every(p => finite(p.x, p.y));
  }
}

/** Conservative migration: only attach a snapshot to one unambiguous earlier sketch. */
export function bindSketchDependencies(features: Feature[]): Feature[] {
  return features.map((feature, index) => {
    if (feature.sketchReference || !('profile' in feature || feature.type === 'hole')) return feature;
    const profiles = 'profile' in feature ? (Array.isArray(feature.profile) ? feature.profile : [feature.profile])
      : [ { kind: 'circle', cx: feature.center.x, cy: feature.center.y, r: feature.radius },
          ...(feature.extraHoles ?? []).map(h => ({kind:'circle',cx:h.center.x,cy:h.center.y,r:h.radius})) ];
    const candidates: SketchReference[] = [];
    for (const sketch of features.slice(0, index)) {
      if (sketch.type !== 'sketch' || sketch.bodyGroupId !== feature.bodyGroupId || !same(sketch.plane, feature.plane)) continue;
      let ids: string[] = [];
      const region = profiles.length === 1 && profiles[0].kind === 'region';
      if (region) {
        if (!same(reconstructedSketchProfile(sketch.shapes, sketch.points, sketch.profileWires), profiles[0])) continue;
        ids = sketch.profileWires?.flat() ?? [];
      } else {
        for (const profile of profiles) {
          const matches = sketch.shapes.filter(shape => same(findProfileSources(sketch.shapes, sketch.points, [shape.id])[0], profile));
          // Multiple edges of the same loop are equivalent anchors.
          if (!matches.length || (profile.kind !== 'loop' && matches.length !== 1)) { ids = []; break; }
          ids.push(matches[0].id);
        }
      }
      if (!ids.length) continue;
      let axisShapeId: string | undefined;
      if (feature.type === 'revolve' || feature.type === 'helix') {
        const axes = sketch.shapes.filter(shape => {
          const axis = findCenterLine([shape], sketch.points);
          return axis && same(axis.origin, feature.axisOrigin) && same(axis.direction, feature.axisDirection);
        });
        if (axes.length !== 1) continue;
        axisShapeId = axes[0].id;
      }
      candidates.push({ sketchId: sketch.id, profileShapeIds: ids, ...(region ? {region:true} : {}), ...(axisShapeId ? {axisShapeId} : {}) });
    }
    return candidates.length === 1 ? { ...feature, sketchReference: candidates[0] } : feature;
  });
}

export function resolveSketchDependencies(features: Feature[]): Feature[] {
  return features.map((feature, index) => {
    const ref = feature.sketchReference;
    if (!ref) return feature;
    const fail = (reason: string): never => { throw new Error(`Operação "${feature.label}": ${reason} Edite o esboço de origem para corrigir a referência.`); };
    const sketch = features.slice(0, index).find(f => f.id === ref.sketchId && f.type === 'sketch') as SketchFeature | undefined;
    if (!sketch) return fail('Esboço de origem ausente ou fora de ordem.');
    if (ref.profileShapeIds.some(id => !sketch.shapes.some(s => s.id === id))) return fail('O perfil utilizado foi removido.');
    const profiles = ref.profileBoundaries ? ref.profileBoundaries.map(wires => reconstructedSketchProfile(sketch.shapes, sketch.points, wires)) : ref.region ? [reconstructedSketchProfile(sketch.shapes, sketch.points, sketch.profileWires)]
      : ref.profileShapeIds.map(id => findProfileSources(sketch.shapes, sketch.points, [id])[0]);
    if (!profiles.length || profiles.some(p => !validProfile(p ?? null))) return fail('O perfil está aberto ou inválido.');
    const valid = profiles.filter(p => p != null);
    let result: Feature = feature;
    if ('profile' in feature) result = { ...feature, plane: sketch.plane, profile: Array.isArray(feature.profile) ? valid : valid[0] };
    if (feature.type === 'hole') {
      const circles = valid.map(p => p.kind === 'circle' ? {center:{x:p.cx,y:p.cy},radius:p.r} : fail('O furo requer um círculo.'));
      result = {...feature,plane:sketch.plane,...circles[0],extraHoles:circles.slice(1)};
    }
    if (result.type === 'revolve' || result.type === 'helix') {
      const axis = findCenterLine(sketch.shapes.filter(s => s.id === ref.axisShapeId), sketch.points);
      if (!axis) return fail('O eixo foi removido ou tem comprimento zero.');
      result = {...result,axisOrigin:axis.origin,axisDirection:axis.direction};
    }
    return result;
  });
}
