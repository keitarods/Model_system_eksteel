"use client";
import { useState } from "react";
import type { DatabaseCredentials, DatabaseKind } from "@/lib/project/databaseConfig";
import { parseConnectionString } from "@/lib/project/connectionString";

export function ConnectionStringInput({ kind, disabled, onApply }: {
  kind: DatabaseKind; disabled?: boolean; onApply: (credentials: DatabaseCredentials) => void;
}) {
  const [value, setValue] = useState("");
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  return <div className="space-y-2 rounded border border-chrome-border p-3">
    <label className="block text-sm">String de conexão (opcional)
      <input type="password" autoComplete="off" spellCheck={false} disabled={disabled} value={value}
        placeholder={`${kind === "postgres" ? "postgresql" : kind}://usuario:senha@host:porta/banco`}
        className="w-full rounded border border-chrome-border bg-chrome-surface-alt p-2 text-sm"
        onChange={event => { setValue(event.target.value); setMessage(""); }} />
    </label>
    <button type="button" disabled={disabled || !value.trim()} className="rounded border border-chrome-border px-3 py-2 text-sm disabled:opacity-40"
      onClick={() => {
        try {
          const credentials = parseConnectionString(value, kind);
          onApply(credentials); setValue(""); setFailed(false);
          setMessage(credentials.password ? "Campos preenchidos. Confira os dados e conecte." : "Campos preenchidos. Informe a senha do banco no campo abaixo.");
        } catch (error) { setFailed(true); setMessage(error instanceof Error ? error.message : "String inválida."); }
      }}>Preencher pela string</button>
    {message && <p role={failed ? "alert" : "status"} className={`text-xs ${failed ? "text-red-600" : "text-chrome-text-muted"}`}>{message}</p>}
    <p className="text-xs text-chrome-text-muted">A string não é salva. Aplicar preenche os campos abaixo, sem iniciar uma conexão. No Supabase, copie Connect → Session pooler.</p>
  </div>;
}
