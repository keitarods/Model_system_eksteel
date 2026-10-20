import type { Feature } from './types';
import { bindSketchDependencies } from './sketchDependencies';
import { featureHistoryTree } from './historyTree';

function references(f: Feature): string[] {
  return [...(f.sketchReference ? [f.sketchReference.sketchId] : []),
    ...(f.type === 'flange' ? [f.parentId] : []),
    ...(f.type === 'pattern' ? [f.sourceFeatureId] : []),
    ...(f.type === 'sweep' ? [f.pathFeatureId] : []),
    ...(f.type === 'loft' ? f.sectionIds : [])];
}

/** Reorder a visible operation with its exclusively owned sketches, without mutating history. */
export function moveOperation(features: Feature[], id: string, direction: -1 | 1): Feature[] {
  const roots = featureHistoryTree(features);
  const index = roots.findIndex(n => n.feature.id === id);
  const neighbor = roots[index + direction];
  return index < 0 || !neighbor ? features : moveOperationTo(features, id, neighbor.feature.id, direction === -1 ? 'before' : 'after');
}

/** A drop validates the final placement in one transaction, not intermediate positions. */
export function moveOperationTo(features: Feature[], id: string, targetId: string, placement: 'before' | 'after'): Feature[] {
  if (id === targetId) return features;
  const linked = bindSketchDependencies(features);
  const roots = featureHistoryTree(linked);
  const index = roots.findIndex(n => n.feature.id === id);
  const neighbor = roots.find(n => n.feature.id === targetId);
  if (index < 0 || !neighbor) return features;
  const owned = (node: typeof roots[number]) => new Set([node.feature.id, ...node.sketches
    .filter(s => !linked.some(f => f.id !== node.feature.id && references(f).includes(s.id)))
    .map(s => s.id)]);
  const moving = owned(roots[index]);
  const target = owned(neighbor);
  const remainder = linked.filter(f => !moving.has(f.id));
  const positions = remainder.flatMap((f, i) => target.has(f.id) ? [i] : []);
  const at = placement === 'before' ? Math.min(...positions) : Math.max(...positions) + 1;
  const proposed = [...remainder.slice(0, at), ...linked.filter(f => moving.has(f.id)), ...remainder.slice(at)];
  if (proposed.every((f, i) => f.id === features[i].id)) return features;
  const seen = new Set<string>();
  for (const f of proposed) {
    if (references(f).some(ref => !seen.has(ref))) throw new Error(`Não é possível mover: "${f.label}" precisa ficar depois das operações e esboços de origem.`);
    seen.add(f.id);
  }
  // A reorder must not silently switch a Face/Flange to a different sheet rule.
  const rules = (items: Feature[]) => {
    const current = new Map<string | undefined, string>();
    const result = new Map<string, string | undefined>();
    for (const f of items) {
      if (f.type === 'sheetMetal') current.set(f.bodyGroupId, f.id);
      if (f.type === 'face' || f.type === 'flange') result.set(f.id, current.get(f.bodyGroupId));
    }
    return result;
  };
  const before = rules(linked);
  for (const [key, rule] of rules(proposed)) {
    if (before.get(key) !== rule) throw new Error('Não é possível mover a operação para fora da sua regra de chapa.');
  }
  return proposed;
}
