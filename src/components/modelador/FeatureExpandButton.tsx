"use client";
export function FeatureExpandButton({ label, expanded, controls, onToggle }: {
  label: string; expanded: boolean; controls: string; onToggle: () => void;
}) {
  return <button type="button" aria-label={`${expanded ? 'Recolher' : 'Expandir'} esboços de ${label}`}
    aria-expanded={expanded} aria-controls={controls} onClick={onToggle}
    className="flex h-4 w-4 shrink-0 items-center justify-center rounded border border-primary-300 bg-white text-xs leading-none hover:bg-primary-100">
    {expanded ? '−' : '+'}
  </button>;
}
