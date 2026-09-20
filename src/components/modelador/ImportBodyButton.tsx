"use client";
import { HeaderIcon } from "@/components/icons/HeaderIcon";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { loadOpenCascade } from "@/lib/replicad/opencascade";
import { automaticallyRecognizeBodies, type AutomaticRecognition } from "@/lib/replicad/automaticRecognition";
import { importBodies } from "@/lib/replicad/exchangeImport";
import { useFeatureStore } from "@/lib/features/store";
import type { Feature } from "@/lib/features/types";
import { createId } from "@/lib/sketch/render";
import { rebuildModel } from "@/lib/replicad/build-model";
import { serializeProject, NATIVE_MIME_TYPE } from "@/lib/project/nativeFormat";
import { downloadBlob } from "@/lib/project/folder";

type Conversion = { features: Feature[]; warnings: string[]; fileName: string; original: Feature[]; bodyCount: number; results: AutomaticRecognition[] };

export function ImportBodyButton({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = () => {
    dialog.current?.close();
    setOpen(false);
    trigger.current?.focus();
  };
  const titleId = useId();
  useEffect(() => {
    if (open) dialog.current?.showModal();
  }, [open]);
  const [automatic, setAutomatic] = useState(true);
  const [progress, setProgress] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [scale, setScale] = useState(1000);
  const [conversion, setConversion] = useState<Conversion | null>(null);
  const [notice, setNotice] = useState("");
  return <>
    <button ref={trigger} type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open}
      title="Importar STEP, STL ou GLB e converter para .eks3d"
      className="shrink-0 rounded-lg px-2 py-1.5 text-xs text-chrome-text-muted hover:bg-chrome-surface-alt">
      {compact ? <><HeaderIcon kind="import" /><span className="sr-only">Importar 3D</span></> : "Importar 3D"}
    </button>
    {open && createPortal(<dialog ref={dialog} aria-labelledby={titleId}
      onCancel={event => { event.preventDefault(); close(); }} onClose={() => setOpen(false)}
      onKeyDown={event => event.stopPropagation()}
      className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[min(32rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-chrome-border bg-chrome-surface p-0 text-chrome-text shadow-2xl backdrop:bg-black/50">
      <div className="sticky top-0 flex items-center justify-between gap-3 border-b border-chrome-border bg-chrome-surface px-5 py-3">
        <h2 id={titleId} className="text-sm font-semibold">Importar / converter 3D</h2>
        <button type="button" autoFocus onClick={close} aria-label="Fechar importação"
          className="rounded-lg px-2 py-1 text-sm text-chrome-text-muted hover:bg-chrome-surface-alt">Fechar</button>
      </div>
    <div className="space-y-3 p-5 text-sm [overflow-wrap:anywhere]">
      <p>Importe a geometria e tente reconstruir operações automaticamente. Corpos não reconhecidos permanecem como sólidos importados, sem perda da geometria.</p>
      <label className="flex items-center gap-2"><input type="checkbox" checked={automatic} disabled={busy} onChange={e => setAutomatic(e.target.checked)} />Tentar reconstruir operações do STEP</label>
      {busy && progress && <p role="status">{progress}</p>}
      <p>IPT/IAM: exporte para STEP no Inventor antes de importar.</p>
      <label className="flex items-center justify-between gap-2">Unidade do GLB
        <select value={scale} disabled={busy} onChange={event => setScale(Number(event.target.value))} className="rounded border border-chrome-border bg-chrome-surface-alt p-1">
          <option value={1000}>Metros (padrão GLB)</option>
          <option value={1}>Milímetros</option>
          <option value={10}>Centímetros</option>
        </select>
      </label>
      <label className="block">{busy ? "Convertendo…" : "Escolher arquivo"}
        <input type="file" accept=".step,.stp,.ste,.stl,.glb,.ipt,.iam" disabled={busy} className="mt-1 block w-full min-w-0 text-xs file:mr-2 file:rounded-lg file:border-0 file:bg-primary file:px-3 file:py-2 file:text-primary-foreground" onChange={async event => {
          const file = event.target.files?.[0]; event.target.value = "";
          if (!file) return;
          const original = useFeatureStore.getState().features;
          setBusy(true); setProgress("Lendo geometria…"); setError(""); setNotice(""); setConversion(null);
          try {
            // Explain unsupported Inventor formats before downloading/initializing the kernel.
            if (/\.(ipt|iam)$/i.test(file.name)) throw new Error("Abra no Inventor e exporte como STEP. Para IAM, as peças referenciadas devem estar disponíveis na exportação.");
            await loadOpenCascade();
            const result = await importBodies(file, file.name, createId, { glbScale: scale });
            const recognized = automatic ? await automaticallyRecognizeBodies(result.features, createId, (done, total) => setProgress(`Analisados ${done} de ${total} corpos…`)) : null;
            setConversion({ features: recognized?.features ?? result.features, warnings: automatic ? ["O reconhecimento tenta extrusão/furos e revolução. Não deduz parâmetros de fabricação de chapa.", ...result.warnings.slice(1)] : result.warnings, fileName: file.name, original, bodyCount: result.features.length, results: recognized?.results ?? [] });
          } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível converter o arquivo."); }
          finally { setBusy(false); }
        }} />
      </label>
      {conversion && <>
        <p role="status">{conversion.bodyCount} corpo(s) convertido(s). {conversion.results.filter(r => r.status === "reconstructed").length} reconstruído(s) em operações.</p>
        {conversion.results.map(result => <details key={result.source.id} className="rounded border border-chrome-border p-2">
          <summary>{result.source.label}: {result.status === "reconstructed" ? "operações reconstruídas" : "mantido como sólido"}</summary>
          {result.validation && <p>Diferença geométrica: {result.validation.differenceVolume.toExponential(2)} mm³.</p>}
          {result.attempts.map(attempt => <p key={attempt}>{attempt}</p>)}
        </details>)}
        <ul className="max-h-28 overflow-auto list-disc pl-4">{conversion.features.map(feature => <li key={feature.id}>{feature.label}</li>)}</ul>
        {conversion.warnings.map(warning => <p key={warning}>{warning}</p>)}
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} className="rounded-lg border border-chrome-border px-3 py-2 hover:bg-chrome-surface-alt disabled:opacity-50" onClick={() => {
            setError("");
            try {
              if (useFeatureStore.getState().features !== conversion.original) throw new Error("O documento mudou durante a conversão. Converta novamente para inserir, ou baixe o resultado separado.");
              const features = [...conversion.original, ...conversion.features];
              const model = rebuildModel(features);
              if (!model) throw new Error("Não foi possível reconstruir os corpos convertidos.");
              model.delete();
              // Publish all bodies together: one undo transaction, no partial document on failure.
              useFeatureStore.setState({ features });
              setNotice("Corpos inseridos. Use Salvar para gravar o projeto .eks3d."); setConversion(null);
            } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao inserir corpos."); }
          }}>Inserir no documento</button>
          <button type="button" className="rounded-lg border border-chrome-border px-3 py-2 hover:bg-chrome-surface-alt disabled:opacity-50" onClick={() => {
            const blob = new Blob([serializeProject(conversion.features)], { type: NATIVE_MIME_TYPE });
            downloadBlob(blob, conversion.fileName.replace(/\.[^.]+$/, "") + ".eks3d");
          }}>Baixar .eks3d</button>
          <button type="button" className="rounded-lg px-3 py-2 hover:bg-chrome-surface-alt" onClick={() => setConversion(null)}>Cancelar</button>
        </div>
      </>}
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert" className="text-red-400">{error}</p>}
    </div>
    </dialog>, document.body)}
  </>;
}
