/** Tessellation for display only. Exact BREP remains the source for CAD/export. */
export type ImportedDisplayQuality = 'fast' | 'balanced' | 'fine';
export const IMPORTED_DISPLAY_OPTIONS = {
  fast: { tolerance: 0.2, angularTolerance: 0.5 },
  balanced: { tolerance: 0.1, angularTolerance: 0.35 },
  fine: { tolerance: 0.05, angularTolerance: 0.2 },
} satisfies Record<ImportedDisplayQuality, { tolerance: number; angularTolerance: number }>;
