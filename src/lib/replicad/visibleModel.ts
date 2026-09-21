import type { Feature } from '@/lib/features/types';
import { rebuildModel } from './build-model';

/** Display-only reconstruction. Hidden source bodies and their dependent
 * modifiers are omitted; independent later operations remain visible.
 * Never use this result for export, physical properties or persistence. */
export function hasHiddenImportedBodies(features: Feature[]): boolean {
  return features.some(f => f.type === 'imported' && f.visible === false && !f.suppressed);
}
export function rebuildVisibleModel(features: Feature[], options: { flatten?: boolean } = {}) {
  return rebuildModel(features.map(f => f.type === 'imported' && f.visible === false ? { ...f, suppressed: true } : f), options);
}
