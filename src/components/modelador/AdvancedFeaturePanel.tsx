"use client";
import { CadToolButton } from "@/components/ui/CadToolButton";
import { useEffect, useMemo, useState } from "react";
import type { Feature, LoftFeature, ShellFeature } from "@/lib/features/types";
import type { SketchPlane } from "@/lib/sketch/types";
import { useFeatureStore } from "@/lib/features/store";
import { createId } from "@/lib/sketch/render";
import { loadOpenCascade } from "@/lib/replicad/opencascade";
import { rebuildModel } from "@/lib/replicad/build-model";
function LoftIcon({ className }: { className?: string }) {
    return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}><ellipse cx="12" cy="5" rx="4" ry="2"/><path d="M8 5 3 19m13-14 5 14"/><ellipse cx="12" cy="19" rx="9" ry="3"/></svg>;
}
function ShellIcon({ className }: { className?: string }) {
    return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}><path d="m3 7 9-4 9 4v12l-9 3-9-3Z M3 7l9 4 9-4 M12 11v11 M7 7l5-2 5 2-5 2Z"/></svg>;
}
type AdvancedFeature = LoftFeature | ShellFeature;
export function AdvancedFeaturePanel({ activePlane, onPreview, editing, onClose }: {
    activePlane: SketchPlane;
    onPreview: (feature: AdvancedFeature | null) => void;
    editing: AdvancedFeature | null;
    onClose: () => void;
}) {
    const features = useFeatureStore(s => s.features);
    const [mode, setMode] = useState<'loft' | 'shell' | null>(editing?.type ?? null);
    const [ids, setIds] = useState<string[]>(editing?.type === 'loft' ? editing.sectionIds : []);
    const [ruled, setRuled] = useState(editing?.type === 'loft' ? editing.ruled : false);
    const [cut, setCut] = useState(editing?.type === 'loft' ? !!editing.cut : false);
    const [thickness, setThickness] = useState(editing?.type === 'shell' ? editing.thickness : 2);
    const [plane, setPlane] = useState<SketchPlane>(editing?.type === 'shell' ? editing.openingPlane : activePlane);
    const [error, setError] = useState(''), [busy, setBusy] = useState(false);
    const [id] = useState(() => editing?.id ?? createId());
    const candidate = useMemo<AdvancedFeature | null>(() => {
        if (mode === 'loft' && ids.length >= 2)
            return { id, type: 'loft', label: 'Loft', sectionIds: ids, ruled, cut };
        if (mode === 'shell' && Number.isFinite(thickness) && thickness > 0)
            return { id, type: 'shell', label: `Casca ${thickness} mm`, thickness, openingPlane: plane };
        return null;
    }, [mode, ids, ruled, cut, thickness, plane, id]);
    useEffect(() => { const timer = setTimeout(() => onPreview(candidate), 250); return () => { clearTimeout(timer); onPreview(null); }; }, [candidate, onPreview]);
    const before = editing ? features.slice(0, features.findIndex(f => f.id === editing.id)) : features;
    async function apply() {
        if (!candidate)
            return;
        setBusy(true);
        setError('');
        try {
            await loadOpenCascade();
            if (useFeatureStore.getState().features !== features)
                throw new Error("O modelo mudou durante a operação; confira a prévia e aplique novamente.");
            const next = editing ? features.map(f => f.id === editing.id ? candidate : f) : [...features, candidate];
            const result = rebuildModel(next);
            if (!result)
                throw new Error('A operação não gerou sólido.');
            result.delete();
            if (editing)
                useFeatureStore.getState().updateFeature(editing.id, candidate);
            else
                useFeatureStore.getState().addFeature(candidate);
            onPreview(null);
            setMode(null);
            onClose();
        }
        catch (e) {
            setError(e instanceof Error ? e.message : 'Falha geométrica; confira as seções/face e dimensões.');
        }
        finally {
            setBusy(false);
        }
    }
    return <div className="flex flex-wrap items-center gap-2 text-xs [&>button]:rounded-lg [&>button]:bg-white [&>button]:px-3 [&>button]:py-1.5 [&>button]:font-semibold [&>button]:text-primary-700 [&>button:hover]:bg-primary-100 [&>button:disabled]:opacity-50">
    {!mode && <><CadToolButton icon={LoftIcon} label="Loft" onClick={() => setMode('loft')} /><CadToolButton icon={ShellIcon} label="Casca (Shell)" onClick={() => { setPlane(activePlane); setMode('shell'); }} /></>}
    {mode === 'loft' && <>
      <span>Seções na ordem dos cliques:</span>
      {before.filter(f => f.type === 'sketch').map(f => <label key={f.id}><input type="checkbox" checked={ids.includes(f.id)} onChange={() => setIds(old => old.includes(f.id) ? old.filter(i => i !== f.id) : [...old, f.id])}/>{f.label}{ids.includes(f.id) ? ` (${ids.indexOf(f.id) + 1})` : ''}</label>)}
      <label><input type="checkbox" checked={ruled} onChange={e => setRuled(e.target.checked)}/>Superfícies regradas</label>
      <label><input type="checkbox" checked={cut} onChange={e => setCut(e.target.checked)}/>Corte</label>
    </>}
    {mode === 'shell' && <>
      <label>Espessura interna (mm) <input type="number" min="0.01" step="0.1" value={thickness} onChange={e => setThickness(Number(e.target.value))} className="w-16 border"/></label>
      <span>Remove a face no plano de trabalho ativo.</span>
      <button type="button" onClick={() => setPlane(activePlane)}>Usar plano ativo</button>
    </>}
    {mode && <><button type="button" disabled={!candidate || busy} onClick={apply}>{busy ? 'Validando…' : 'Aplicar'}</button><button type="button" disabled={busy} onClick={() => { setMode(null); onPreview(null); onClose(); }}>Cancelar</button></>}
    {error && <span role="alert" className="text-red-700">{error}</span>}
  </div>;
}
