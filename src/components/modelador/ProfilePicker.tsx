import { useMemo } from 'react';
import { profileToDrawing, type ProfileSource } from '@/lib/replicad/geometry';

type Profile = NonNullable<ProfileSource>;
function ProfileThumbnail({ profile }: { profile: Profile }) {
  const svg = useMemo(() => {
    try {
      const drawing = profileToDrawing(profile);
      return drawing ? { viewBox: drawing.toSVGViewBox(2), paths: drawing.toSVGPaths().flat() } : null;
    } catch { return null; }
  }, [profile]);
  return svg ? <svg aria-hidden="true" viewBox={svg.viewBox} className="h-10 w-14" fill="currentColor" fillOpacity={0.15} stroke="currentColor" strokeWidth={1}>
    <path d={svg.paths.join(' ')} fillRule="evenodd" vectorEffect="non-scaling-stroke" />
  </svg> : null;
}
export function ProfilePicker({ profiles, selected, onChange }: {
  profiles: Profile[]; selected: number[] | null; onChange: (indices: number[] | null) => void;
}) {
  const names = { rect: 'Retângulo', circle: 'Círculo', slot: 'Rasgo', loop: 'Contorno fechado', region: 'Região com vazios' };
  return <fieldset className="flex max-h-40 max-w-full overflow-auto flex-wrap items-center gap-2 rounded border border-primary-200 bg-white p-2 text-xs">
    <legend className="px-1 font-semibold">Perfis do esboço</legend>
    <button type="button" onClick={() => onChange(null)} aria-pressed={selected === null}>Seleção anterior</button>
    <button type="button" onClick={() => onChange(profiles.map((_, i) => i))}>Todos</button>
    <button type="button" onClick={() => onChange([])}>Nenhum</button>
    {profiles.map((profile, i) => <label key={i} className="flex items-center gap-1 rounded bg-primary-50 px-2 py-1">
      <input type="checkbox" checked={selected?.includes(i) ?? false}
        onChange={() => onChange(selected?.includes(i) ? selected.filter(n => n !== i) : [...(selected ?? []), i])} />
      <ProfileThumbnail profile={profile} />
      {i + 1}: {names[profile.kind]}
      {profile.kind === 'circle' && ` (R ${profile.r.toFixed(2)}, X ${profile.cx.toFixed(2)}, Y ${profile.cy.toFixed(2)})`}
      {profile.kind === 'rect' && ` (${Math.abs(profile.x2-profile.x1).toFixed(2)} × ${Math.abs(profile.y2-profile.y1).toFixed(2)})`}
    </label>)}
    {selected?.length === 0 && <span role="status">Selecione pelo menos um perfil fechado.</span>}
    {selected === null && <span>Usando a seleção anterior do esboço (ou seu último perfil).</span>}
    <span>Perfis marcados são unidos. Confira a pré-visualização antes de confirmar.</span>
  </fieldset>;
}
