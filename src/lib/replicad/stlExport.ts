import type { Shape3D } from "replicad";

/** Export the current solid in model units (mm). STL has no unit metadata.
 * Explicit tessellation tolerances keep curved-part file sizes predictable. */
export function exportSolidStl(solid: Shape3D): Blob {
  return solid.blobSTL({ binary: true, tolerance: 0.01, angularTolerance: 0.1 });
}
