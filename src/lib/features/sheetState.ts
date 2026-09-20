import type { Feature } from './types';

/** Whole-sheet state transitions. Editing geometry while unfolded requires a
 * bidirectional bend mapping and is rejected until the kernel supports it. */
export function sheetIsUnfolded(features: Feature[]): boolean {
  let unfolded = false;
  let nativeBend = false;
  let sheet = false;
  for (const feature of features) {
    if (feature.type === 'unfold') {
      if (!sheet || !nativeBend || unfolded || feature.bodyGroupId) throw new Error('Desdobrar requer uma chapa dobrada com flanges nativas.');
      unfolded = true;
    } else if (feature.type === 'refold') {
      if (!unfolded) throw new Error('Redobrar requer uma operação Desdobrar anterior.');
      unfolded = false;
    } else {
      if (unfolded) throw new Error('Redobre a chapa antes de adicionar operações. Edição sobre dobras abertas ainda não é suportada.');
      if (feature.type === 'sheetMetal') sheet = true;
      if (feature.type === 'flange') nativeBend = true;
    }
  }
  return unfolded;
}
