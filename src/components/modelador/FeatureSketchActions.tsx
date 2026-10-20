"use client";
import { sheetBaseFace } from '@/lib/features/historyTree';
import type { HistorySketch } from '@/lib/features/historyTree';
import type { Feature } from '@/lib/features/types';
import { ReconstructionButton } from './ReconstructionButton';

/** Keep sketch actions on their own row, even in a narrow history panel. */
export function FeatureSketchActions({ feature, features, busy, onEdit, sketches = [], onOpenSketch, onVisibility, onRedefineSketch }: {
  feature: Feature;
  features: Feature[];
  busy: boolean;
  onEdit: (feature: Feature) => void;
  sketches?: HistorySketch[];
  onOpenSketch?: (sketch: HistorySketch) => void;
  onVisibility?: (sketch: HistorySketch) => void;
  onRedefineSketch?: (sketch: HistorySketch) => void;
}) {
  if (feature.type === 'sheetMetal') {
    const base = sheetBaseFace(features, feature.id);
    return base ? <div className="mt-1 border-l border-primary-200 pl-2">
      <button type="button" disabled={busy} onClick={() => onEdit(base)}
        aria-label={`Editar esboço da Face base de ${feature.label}`}
        className="w-full whitespace-normal rounded border border-primary-200 px-2 py-1 text-left text-xs hover:bg-primary-50 disabled:opacity-40">Editar esboço da Face base</button>
    </div> : null;
  }
  if (feature.type === 'imported') return <div className="mt-1 border-t border-primary-100 pt-1 text-xs text-primary-500">
    <p>Corpo importado sem esboço de origem.</p>
    {feature.format === 'step' && <ReconstructionButton sourceFeatureId={feature.id} disabled={busy} />}
  </div>;

  if (sketches.length) return <ul aria-label={`Esboços de ${feature.label}`} className="mt-1 space-y-1 border-l border-primary-200 pl-2">
    {sketches.map(sketch => <li key={sketch.id} className="rounded bg-primary-50 p-1">
      <button type="button" disabled={busy} aria-label={`Editar ${sketch.label} de ${feature.label}`}
        onClick={() => onOpenSketch?.(sketch)} className="block w-full whitespace-normal text-left text-xs hover:underline disabled:opacity-40">
        <span className="mr-1 font-semibold text-primary-500">SK</span>{sketch.label}
      </button>
      <div className="mt-1 flex flex-wrap gap-1">
        <button type="button" disabled={busy} onClick={() => onOpenSketch?.(sketch)} className="rounded border px-1 text-xs">Editar esboço</button>
        <button type="button" disabled={busy} aria-label={`${sketch.visible === true ? 'Ocultar' : 'Mostrar'} ${sketch.label}`}
          aria-pressed={sketch.visible === true} onClick={() => onVisibility?.(sketch)} className="rounded border px-1 text-xs">{sketch.visible === true ? 'Ocultar' : 'Mostrar'}</button>
        <button type="button" disabled={busy} onClick={() => onRedefineSketch?.(sketch)} className="rounded border px-1 text-xs">Redefinir esboço</button>
      </div>
    </li>)}
  </ul>;
  if (!['face', 'extrude', 'revolve', 'sweep', 'helix', 'hole', 'loft'].includes(feature.type)) return null;
  return <div className="mt-1 border-t border-primary-100 pt-1">
    <button type="button" disabled={busy} aria-label={`Editar esboço de ${feature.label}`}
      onClick={() => onEdit(feature)}
      className="w-full whitespace-normal rounded border border-primary-200 px-2 py-1 text-left text-xs text-primary-700 hover:bg-primary-50 disabled:opacity-40">Editar esboço</button>
  </div>;
}
