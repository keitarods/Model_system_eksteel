import { iterTopo, type AnyShape } from 'replicad';
import type { Study } from './types';

/** Body count suggests document type; it cannot recover assembly hierarchy or contacts. */
export function classifyStepBodies(shape: AnyShape): Pick<Study, 'geometryMode' | 'components' | 'preparation'> {
  const solids = Array.from(iterTopo(shape.wrapped, 'solid'));
  try {
    if (!solids.length) throw new Error('O STEP não contém sólidos fechados para simulação.');
    if (solids.length > 128) throw new Error('Esta versão permite até 128 corpos por estudo.');
    return {
      geometryMode: solids.length > 1 ? 'assemblyBonded' : 'part',
      components: solids.map((_, index) => ({ id: `step-body-${index+1}`, label: `Corpo ${index+1}` })),
      // Multiple bodies do not imply bonded, welded or touching parts.
      preparation: {heal:false,removeSmall:false,closeGaps:false,unite:false,tolerance:0.001},
    };
  } finally { solids.forEach(solid => solid.delete()); }
}
