import type { ShapeMesh } from 'replicad';
import { IMPORTED_DISPLAY_OPTIONS } from '@/lib/replicad/displayQuality';

/** Lightweight CAD preview, never used as input for meshing or solving. */
export function simulationGeometryPreview(shape: { mesh(options: { tolerance: number; angularTolerance: number }): ShapeMesh }): ShapeMesh {
  return shape.mesh(IMPORTED_DISPLAY_OPTIONS.fast);
}

/** Paint the current stage before entering a synchronous native CAD operation. */
export async function geometryStage(onProgress: ((message: string) => void) | undefined, message: string) {
  onProgress?.(message);
  if (onProgress) await new Promise(resolve => setTimeout(resolve, 32));
}
