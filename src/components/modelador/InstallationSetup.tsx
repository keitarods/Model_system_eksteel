"use client";
import { useState } from "react";

/** Used inside the cloud dialog; no nested form or navigation before saving. */
export function InstallationSetup({ suggestedUrl = "", suggestedKey = "", busy = false, run }: {
  suggestedUrl?: string; suggestedKey?: string; busy?: boolean;
  run: (action: () => Promise<void>) => Promise<void>;
}) {
  const [url, setUrl] = useState("");
  const [key, setKey] = useState("");
  const [token, setToken] = useState("");
  const [saved, setSaved] = useState(false);
  const field = "block w-full rounded border border-chrome-border bg-chrome-surface-alt p-2 text-sm";
  if (saved) return <div role="status" className="mb-4 rounded border border-chrome-border p-3 text-sm">
    Configuração salva. Entre no software para habilitar a preparação de bancos.
    <a className="ml-2 underline" href="/login">Ir para o login</a>
    <p className="mt-2">Salve a peça localmente antes de sair desta tela.</p>
  </div>;
  return <details className="mb-4 rounded border border-chrome-border p-3" open>
    <summary className="cursor-pointer text-sm font-semibold">Configurar acesso ao software — primeiro uso</summary>
    <p className="my-2 text-sm">Informe o Supabase que autentica esta instalação. O armazenamento do cliente é configurado abaixo e pode usar outro projeto.</p>
    <fieldset disabled={busy} className="space-y-3">
      <label className="block text-sm">URL do Supabase para login<input className={field} type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://projeto.supabase.co" /></label>
      <label className="block text-sm">Chave pública para login<input className={field} type="password" autoComplete="off" value={key} onChange={e => setKey(e.target.value)} /></label>
      {suggestedUrl && suggestedKey && <button type="button" className="text-sm underline" onClick={() => { setUrl(suggestedUrl); setKey(suggestedKey); }}>Usar URL e chave preenchidas no armazenamento</button>}
      <label className="block text-sm">Token da instalação (dispensado em desenvolvimento local)<input className={field} type="password" autoComplete="off" value={token} onChange={e => setToken(e.target.value)} /></label>
      <button type="button" disabled={!url.trim() || !key.trim()} className="rounded border border-chrome-border px-3 py-2 text-sm disabled:opacity-40" onClick={() => void run(async () => {
        try {
          const response = await fetch("/api/installation", { method: "POST", headers: { "Content-Type": "application/json", "X-Setup-Token": token }, body: JSON.stringify({ url, key }) });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || "Não foi possível configurar o acesso.");
          setSaved(true); setKey("");
        } finally { setToken(""); }
      })}>Salvar configuração de acesso</button>
    </fieldset>
  </details>;
}
