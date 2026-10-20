/** Origin-plane overlays must not steal clicks from an actual model surface. */
export function hitsSketchSupport(intersections: ReadonlyArray<{ object: { userData: Record<string, unknown> } }>): boolean {
  return intersections.some(hit => hit.object.userData.sketchSupport === true);
}
