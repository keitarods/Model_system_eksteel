import type { Study } from './types';

/** The solver's part mode requires one solid. Promotion never implies bonding. */
export function meshStudyWithBodyCount(study: Study, count: number): Study {
  if (count <= 1 || study.geometryMode === 'assemblyBonded') return study;
  return {
    ...study,
    geometryMode: 'assemblyBonded',
    preparation: study.preparation ?? {heal:false,removeSmall:false,closeGaps:false,unite:false,tolerance:0.001},
  };
}
