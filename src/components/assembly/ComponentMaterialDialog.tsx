"use client";

import { useMemo, useState } from "react";
import { MaterialEditor, useMaterialLibrary } from "@/components/materials/MaterialEditor";
import { byName } from "@/lib/materials/defaults";
import { DEFAULT_APPEARANCE } from "@/lib/materials/library";
import type { ComponentInstance } from "@/lib/assembly/types";
import type { PartProperties } from "@/lib/project/partProperties";

type Override = NonNullable<ComponentInstance["appearanceOverride"]>;
export type ComponentMaterialChange = {
  /** null = material da peça não mudou (nada a gravar no arquivo da peça). */
  properties: PartProperties | null;
  /** null = sem substituição (usa a aparência do material da peça). */
  appearanceOverride: Override | null;
};

// Ao estilo Inventor: o MATERIAL é da peça (altera o arquivo e todas as
// ocorrências); a APARÊNCIA pode ser substituída só nesta ocorrência da
// montagem, sem tocar na peça, e "Limpar" volta à aparência do material.
export function ComponentMaterialDialog({
  instance,
  properties,
  occurrences,
  onClose,
  onSave,
}: {
  instance: ComponentInstance;
  properties: PartProperties;
  occurrences: number;
  onClose: () => void;
  onSave: (change: ComponentMaterialChange) => Promise<void>;
}) {
  const { library } = useMaterialLibrary();
  const sorted = useMemo(() => [...library].sort(byName), [library]);
  const [draft, setDraft] = useState(properties);
  const [override, setOverride] = useState<Override | null>(instance.appearanceOverride ?? null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const partAppearance = draft.materialDefinition?.appearance ?? DEFAULT_APPEARANCE;
  const effective = override ?? partAppearance;
  const materialChanged = JSON.stringify(draft) !== JSON.stringify(properties);
  const presetValue = override ? sorted.find((m) => m.name === override.name)?.id ?? "custom" : "";

  function editOverride(patch: Partial<Override>) {
    setOverride({ ...effective, ...patch, name: undefined });
  }

  async function handleOk() {
    setSaving(true);
    setError(null);
    try {
      await onSave({ properties: materialChanged ? draft : null, appearanceOverride: override });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível aplicar o material.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={saving ? undefined : onClose} />
      <div role="dialog" aria-modal="true" aria-labelledby="component-material-title"
        className="fixed left-1/2 top-1/2 z-50 max-h-[88vh] w-[40rem] max-w-[94vw] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-primary-100 bg-white p-5 text-sm shadow-2xl">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 id="component-material-title" className="text-base font-semibold text-primary-900">Material e aparência — {instance.label}</h3>
          <button type="button" onClick={onClose} disabled={saving} aria-label="Fechar" className="rounded-lg px-2 py-1 text-primary-500 hover:bg-primary-50">✕</button>
        </div>

        <h4 className="font-semibold text-primary-900">Material da peça</h4>
        <p className="mb-2 text-xs text-primary-600">
          Altera o arquivo da peça{instance.embeddedPart !== undefined ? " (cópia incorporada nesta montagem)" : ` "${instance.sourceFileName}"`}
          {occurrences > 1 ? ` e as ${occurrences} ocorrências dela nesta montagem` : ""}, como no Inventor. Massa e Lista de Peças usam este material.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <MaterialEditor properties={draft} onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))} />
        </div>

        <h4 className="mt-4 font-semibold text-primary-900">Aparência nesta montagem</h4>
        <p className="mb-2 text-xs text-primary-600">Substituição só desta ocorrência; não altera a peça nem o material.</p>
        <div className="grid grid-cols-2 gap-3">
          <label className="col-span-2 block">Aparência
            <select className="mt-1 w-full rounded border border-slate-300 bg-white p-1.5 text-sm" value={presetValue}
              onChange={(e) => {
                const m = sorted.find((v) => v.id === e.target.value);
                if (!e.target.value) setOverride(null);
                else if (m) setOverride({ ...m.appearance, name: m.name });
              }}>
              <option value="">Do material da peça</option>
              {presetValue === "custom" && <option value="custom">Personalizada</option>}
              {sorted.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
          <label>Cor<input type="color" className="mt-1 h-9 w-full rounded border border-slate-300" value={effective.color} onChange={(e) => editOverride({ color: e.target.value })} /></label>
          {([["metalness", "Metalização"], ["roughness", "Rugosidade"], ["opacity", "Opacidade"]] as const).map(([k, label]) => (
            <label key={k}>{label}<input aria-label={label} className="w-full" type="range" min={0} max={1} step={0.01} value={effective[k]} onChange={(e) => editOverride({ [k]: Number(e.target.value) })} /></label>
          ))}
          <div className="col-span-2">
            <button type="button" disabled={!override} onClick={() => setOverride(null)} className="rounded border border-slate-300 px-2 py-1.5 text-xs hover:bg-slate-100 disabled:opacity-40">Limpar substituição de aparência</button>
          </div>
        </div>

        {error && <p role="alert" className="mt-3 text-xs text-error">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={saving} className="rounded-lg px-3 py-1.5 text-primary-700 hover:bg-primary-50">Cancelar</button>
          <button type="button" onClick={handleOk} disabled={saving} className="rounded-lg bg-primary px-4 py-1.5 font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50">
            {saving ? "Gravando…" : "OK"}
          </button>
        </div>
      </div>
    </>
  );
}
