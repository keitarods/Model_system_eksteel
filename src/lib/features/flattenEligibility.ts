import { activeFeatures } from './suppression';
import type { Feature } from './types';
export function flattenEligibility(features: Feature[]): 'native' | 'flat' | 'imported' | 'unsupported' {
  features = activeFeatures(features);
  // A sheetMetal marker alone does not turn an imported BREP into native bends.
  if (features.some(f => f.type === 'imported')) return 'imported';
  if (!features.some(f => f.type === 'sheetMetal')) return 'unsupported';
  if (features.some(f => f.type === 'flange')) return 'native';
  return features.some(f => f.type === 'face' && !f.cut) ? 'flat' : 'unsupported';
}
