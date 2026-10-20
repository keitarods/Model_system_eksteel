import type { Feature } from './types';
import { bindSketchDependencies } from './sketchDependencies';

export function availableSketches(features: Feature[], selectedId: string | null = null) {
  const linked = bindSketchDependencies(features);
  const consumed = new Set(linked.flatMap(f => [
    ...(f.sketchReference ? [f.sketchReference.sketchId] : []),
    ...(f.type === 'sweep' ? [f.pathFeatureId] : []),
    ...(f.type === 'loft' ? f.sectionIds : []),
  ]));
  return features.filter((f): f is Extract<Feature, {type:'sketch'}> =>
    f.type === 'sketch' && !f.suppressed && (!consumed.has(f.id) || f.id === selectedId));
}
