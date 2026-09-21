import type { Feature } from './types';
/** Named dependencies propagate suppression without deleting stored operations. */
export function activeFeatures(features: Feature[]): Feature[] {
  const blocked = new Set(features.filter(f => f.suppressed).map(f => f.id));
  let changed = true;
  while (changed) {
    changed = false;
    let openUnfold: string | undefined;
    let rule: string | undefined;
    let previousSolid: string | undefined;
    const bends: string[] = [];
    for (const f of features) {
      const dependencies: string[] = [];
      if (f.type === 'sheetMetal') rule = f.id;
      if ((f.type === 'face' || f.type === 'flange') && rule) dependencies.push(rule);
      if (previousSolid && (['hole','fillet','chamfer','shell','split','pattern'].includes(f.type) || ('cut' in f && f.cut))) dependencies.push(previousSolid);
      if (f.type === 'unfold') dependencies.push(...bends);
      if (f.type === 'flange') bends.push(f.id);
      if (!['sketch','plane','axis','sheetMetal','unfold','refold'].includes(f.type)) previousSolid = f.id;
      if (f.type === 'flange') dependencies.push(f.parentId);
      if (f.type === 'loft') dependencies.push(...f.sectionIds);
      if (f.type === 'sweep') dependencies.push(f.pathFeatureId);
      if (f.type === 'unfold') openUnfold = f.id;
      if (f.type === 'refold' && openUnfold) { dependencies.push(openUnfold); openUnfold = undefined; }
      if (!blocked.has(f.id) && dependencies.some(id => blocked.has(id))) { blocked.add(f.id); changed = true; }
    }
  }
  return features.filter(f => !blocked.has(f.id));
}
