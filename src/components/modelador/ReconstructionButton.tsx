"use client";
import { HeaderIcon } from "@/components/icons/HeaderIcon";
import { useEffect, useId, useRef, useState } from "react";
import type { ShapeMesh } from "replicad";
import dynamic from "next/dynamic";
import { rebuildModel } from "@/lib/replicad/build-model";
import { createPortal } from "react-dom";
import type { Feature, ImportedFeature } from "@/lib/features/types";
import { useFeatureStore } from "@/lib/features/store";
import { loadOpenCascade } from "@/lib/replicad/opencascade";
import { automaticallyRecognize } from "@/lib/replicad/automaticRecognition";
import { recognizeBentSheet, recognizeOperations, recognizeSheetRecipe, type Recognition, type RecognitionMode } from "@/lib/replicad/recognizeOperations";
import { createId } from "@/lib/sketch/render";
import { serializeProject, NATIVE_MIME_TYPE } from "@/lib/project/nativeFormat";
import { downloadBlob } from "@/lib/project/folder";
const Preview = dynamic(() => import("@/components/viewer/Viewer3D").then(m => m.Viewer3D), { ssr: false });
type Proposal = Recognition & {
    original: Feature[];
    source: ImportedFeature;
    mesh: ShapeMesh;
    keptSolid?: boolean;
};
export function ReconstructionButton({ compact = false, initialMode = "auto" }: { compact?: boolean; initialMode?: "auto" | "bentSheet" }) {
    const features = useFeatureStore(s => s.features);
    const sources = features.filter((f): f is ImportedFeature => f.type === 'imported' && f.format === 'step');
    const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
    const [sourceId, setSourceId] = useState(''), [mode, setMode] = useState<RecognitionMode | "auto" | "bentSheet">(initialMode);
    const [estimateK, setEstimateK] = useState(false);
    const [bendK, setBendK] = useState("");
    const [recipe, setRecipe] = useState<string | null>(null), [proposal, setProposal] = useState<Proposal | null>(null);
    const dialog = useRef<HTMLDialogElement>(null), trigger = useRef<HTMLButtonElement>(null), title = useId();
    useEffect(() => { if (open)
        dialog.current?.showModal(); }, [open]);
    function close() { dialog.current?.close(); setOpen(false); trigger.current?.focus(); }
    const source = sources.find(f => f.id === sourceId) ?? sources[0];
    async function analyze() {
        if (!source)
            return;
        setBusy(true);
        setError('');
        setProposal(null);
        const original = features;
        try {
            await loadOpenCascade();
            await new Promise(resolve => setTimeout(resolve, 0));
            const automatic = mode === 'auto' ? automaticallyRecognize(source, createId) : null;
            const keptSolid = automatic?.status === 'solid';
            const result = mode === 'bentSheet' ? recognizeBentSheet(source, estimateK ? 0.5 : bendK.trim() ? Number(bendK) : NaN, createId) : automatic ? { features: automatic.features, differenceVolume: automatic.validation?.differenceVolume ?? 0, toleranceVolume: automatic.validation?.toleranceVolume ?? 0, notes: keptSolid ? ['Não foi possível reconstruir este corpo. O sólido original foi mantido sem alterações.', ...automatic.attempts] : ['Operações reconhecidas automaticamente e verificadas contra o STEP.'] } : mode === 'sheetMetal'  && recipe ? recognizeSheetRecipe(source, recipe, createId) : recognizeOperations(source, mode === "auto" ? "extrude" : mode, createId);
            if (mode === 'bentSheet') {
                result.features = result.features.map(f => f.type === 'flange' ? { ...f, kFactorSource: estimateK ? 'estimated' as const : 'user' as const, label: estimateK ? `${f.label} · K estimado` : f.label } : f);
                if (estimateK) result.notes = result.notes.filter(n => !n.includes('informado pelo usuário')).concat('K = 0,5 é uma hipótese de linha neutra no meio da espessura, não um valor identificado no STEP. Desenvolvimento estimado: ajuste pela regra de fabricação.');
            }
            const model = rebuildModel(result.features);
            if (!model)
                throw new Error("Reconstrução sem geometria de prévia.");
            try {
                setProposal({ ...result, original, source, keptSolid, mesh: model.mesh() });
            }
            finally {
                model.delete();
            }
        }
        catch (e) {
            setError(e instanceof Error ? e.message : 'Falha do kernel ao reconhecer operações. Nenhuma alteração aplicada.');
        }
        finally {
            setBusy(false);
        }
    }
    return <>
    <button ref={trigger} type="button" disabled={!sources.length} onClick={() => setOpen(true)} className="shrink-0 rounded-lg px-2 py-1.5 text-xs text-chrome-text-muted hover:bg-chrome-surface-alt disabled:opacity-40" title="Reconstruir operações de um corpo STEP">{compact ? <><HeaderIcon kind="reconstruct" /><span className="sr-only">Reconstruir STEP</span></> : initialMode === "bentSheet" ? "Reconhecer dobras STEP" : "Reconstruir STEP"}</button>
    {open && createPortal(<dialog ref={dialog} aria-labelledby={title} onCancel={e => { e.preventDefault(); close(); }} onClose={() => setOpen(false)} onKeyDown={e => e.stopPropagation()} className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[min(38rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-chrome-border bg-chrome-surface p-5 text-sm text-chrome-text shadow-xl backdrop:bg-black/50">
      <div className="flex items-center justify-between gap-3"><h2 id={title} className="font-semibold">Reconstruir operações do STEP</h2><button autoFocus onClick={close} className="rounded border px-3 py-1">Fechar</button></div>
      <div className="mt-4 space-y-3 [&_select]:w-full [&_select]:rounded [&_select]:border [&_select]:border-chrome-border [&_select]:bg-chrome-surface [&_select]:p-2">
        <p>Gera uma nova sequência e verifica o volume da diferença geométrica contra o corpo original. O histórico original não é recuperado.</p>
        <label className="block">Corpo<select disabled={busy} value={source?.id ?? ''} onChange={e => { setSourceId(e.target.value); setProposal(null); }}>{sources.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}</select></label>
        <label className="block">Reconhecimento<select disabled={busy} value={mode} onChange={e => { setMode(e.target.value as RecognitionMode | "auto" | "bentSheet"); setProposal(null); setError(''); }}><option value="auto">Automático — manter sólido se não reconhecer</option><option value="extrude">Extrusão, recortes e furos cilíndricos</option><option value="revolve">Revolução de 360°</option><option value="bentSheet">Chapa dobrada — reconhecer uma dobra simples</option><option value="sheetMetal">Chapa — dados estritos</option></select></label>
        {mode === 'bentSheet' && <>
          <p>Detecta uma dobra cilíndrica simples de espessura constante, sem furos ou alívios. A proposta só é aceita se reproduzir o sólido. Múltiplas dobras ainda não são suportadas.</p>
          <label className="block"><input type="checkbox" disabled={busy} checked={estimateK} onChange={e=>{setEstimateK(e.target.checked);setProposal(null);}} /> Usar K = 0,5 estimado (não identificado pela espessura)</label>
          <label>Fator K de fabricação <input disabled={busy || estimateK} type="number" min="0" max="1" step="0.01" value={bendK} onChange={e=>{setBendK(e.target.value);setProposal(null);}} className="w-20 rounded border bg-chrome-surface p-1" /></label>
          <p>O fator K não pode ser obtido somente pela geometria do STEP. Informe o valor da sua regra de dobra.</p>
        </>}
        {mode === 'sheetMetal' && <>
          <p>Sem dados complementares, somente chapa plana de espessura constante. Chapa dobrada exige operações, raios e fator K explícitos. Dados ausentes ou divergentes geram erro.</p>
          <label className="block">Dados de fabricação opcionais (.json)<input disabled={busy} type="file" accept=".json" className="mt-1 block w-full" onChange={async (e) => { const file = e.target.files?.[0]; setProposal(null); setRecipe(null); if (!file)
                return; if (file.size > 2000000) {
                setError('Dados limitados a 2 MB.');
                return;
            } setRecipe(await file.text()); setError(''); }}/></label>
          {recipe && <button onClick={() => { setRecipe(null); setProposal(null); }}>Remover dados complementares</button>}
        </>}
        <button disabled={busy || !source} onClick={analyze} className="rounded-lg bg-primary px-3 py-2 text-primary-foreground disabled:opacity-40">{busy ? 'Analisando e comparando…' : 'Analisar operações'}</button>
        {error && <p role="alert" className="text-red-400">{error}</p>}
        {proposal && <div className="space-y-3 border-t border-chrome-border pt-3">
          <div className="h-64 overflow-hidden rounded border border-chrome-border"><Preview mesh={proposal.mesh}/></div>
          <p role="status">{proposal.keptSolid ? "Corpo original preservado. Nenhuma reconstrução aplicada." : <>Geometria validada. Diferença: {proposal.differenceVolume.toExponential(3)} mm³; limite: {proposal.toleranceVolume.toExponential(3)} mm³.</>}</p>
          <ol className="max-h-48 list-decimal overflow-auto pl-5">{proposal.features.map(f => <li key={f.id}>{f.label} ({f.type})</li>)}</ol>
          {proposal.notes.map(note => <p key={note}>{note}</p>)}
          <p>Os esboços são editáveis, mas editar um esboço salvo não recalcula automaticamente o perfil já copiado para a operação. Profundidade, ângulo e parâmetros de furo/dobra são editados na árvore.</p>
          <div className="flex flex-wrap gap-2">
            <button className="rounded border px-3 py-2" onClick={() => downloadBlob(new Blob([serializeProject(proposal.features)], { type: NATIVE_MIME_TYPE }), proposal.source.label.replace(/[^\p{L}\p{N}._-]+/gu, '_') + '-reconstruido.eks3d')}>Baixar reconstrução .eks3d</button>
            <button disabled={proposal.keptSolid || proposal.original.length !== 1} title="Substituição disponível apenas em documento com um único corpo importado, sem operações posteriores." className="rounded border px-3 py-2 disabled:opacity-40" onClick={() => {
                    if (useFeatureStore.getState().features !== proposal.original) {
                        setError('O documento mudou; analise novamente.');
                        return;
                    }
                    if (proposal.original.length !== 1 || proposal.original[0].id !== proposal.source.id) {
                        setError('Baixe a reconstrução separada para preservar os demais corpos e dependências.');
                        return;
                    }
                    useFeatureStore.setState({ features: proposal.features });
                    setProposal(null);
                    close();
                }}>Substituir corpo por operações</button>
          </div>
          <p>Baixar mantém o original aberto. Substituir é reversível por Ctrl+Z; em documentos com vários corpos ou operações posteriores, use o arquivo separado.</p>
        </div>}
      </div>
    </dialog>, document.body)}
  </>;
}
