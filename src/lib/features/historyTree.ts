import type { Feature, SketchFeature } from './types';
import { bindSketchDependencies } from './sketchDependencies';

export type HistorySketch = SketchFeature & Pick<Feature, 'visible' | 'suppressed' | 'bodyGroupId'>;
/** Presentation only: rebuild order and shared sketch identities stay unchanged. */
export function featureHistoryTree(features: Feature[]) {
  const linked = bindSketchDependencies(features);
  const consumed = new Set<string>();
  const nodes = linked.map((feature, index) => {
    const ids = new Set<string>();
    if (feature.sketchReference) ids.add(feature.sketchReference.sketchId);
    if (feature.type === 'sweep') ids.add(feature.pathFeatureId);
    if (feature.type === 'loft') feature.sectionIds.forEach(id => ids.add(id));
    const sketches = linked.filter((f): f is HistorySketch => f.type === 'sketch' && ids.has(f.id));
    sketches.forEach(sketch => consumed.add(sketch.id));
    return {feature, index, sketches};
  });
  return nodes.filter(({feature}) => feature.type !== 'sketch' || !consumed.has(feature.id));
}

/** Closing is hidden by default; viewing a saved sketch requires an explicit action. */
export function showSketchOverlay(editing: boolean, sketchId: string | null, features: Feature[]): boolean {
  return editing || !!sketchId && features.some(f => f.id === sketchId && f.type === 'sketch' && f.visible === true && !f.suppressed);
}

/** Roll back only the displayed model while editing a saved sketch. */
export function sketchEditingHistory(features: Feature[], editing: boolean, sketchId: string | null): Feature[] {
  if (!editing || !sketchId) return features;
  const index = features.findIndex(f => f.id === sketchId && f.type === 'sketch');
  return index < 0 ? features : features.slice(0, index);
}

/** The sheet rule has no profile; route its edit shortcut to its base Face. */
export function sheetBaseFace(features: Feature[], ruleId: string | null): Extract<Feature, {type:'face'}> | undefined {
  const index=features.findIndex(f=>f.id===ruleId && f.type==='sheetMetal');
  if(index<0)return;
  const rule=features[index];
  for(const feature of features.slice(index+1)) {
    if(feature.bodyGroupId!==rule.bodyGroupId)continue;
    if(feature.type==='sheetMetal')return;
    if(feature.type==='face' && !feature.cut)return feature;
  }
}

/** Display the history through the edited operation; never truncate the saved model. */
export function operationEditingHistory(features: Feature[], operationId: string | null, draft?: Feature | null): Feature[] {
  if (!operationId) return features;
  const index = features.findIndex(f => f.id === operationId);
  if (index < 0) return features;
  const prefix = features.slice(0, index + 1);
  const original = features[index];
  // The equal discriminants above the merge guarantee the same feature variant.
  if (draft?.id === operationId && draft.type === original.type) prefix[index] = { ...original, ...draft } as Feature;
  return prefix;
}
