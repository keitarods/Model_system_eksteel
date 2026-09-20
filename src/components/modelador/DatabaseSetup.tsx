"use client";
import { DestinationSetup } from "./DestinationSetup";
import { ConnectionStringInput } from "./ConnectionStringInput";
import { useState } from "react";
import type { DatabaseKind } from "@/lib/project/databaseConfig";
import { prepareCustomerDatabase } from "@/lib/project/databaseConnection";

type Props = { kind: DatabaseKind | "supabase"; busy: boolean; run: (action: () => Promise<void>) => Promise<void>; onPrepared: () => void };

/** Separate credentials: the administrative password never enters the normal connection session. */
export function DatabaseSetup({ kind, busy, run, onPrepared }: Props) {
  const [host, setHost] = useState("");
  const [port, setPort] = useState("");
  const [database, setDatabase] = useState(kind === "supabase" ? "postgres" : "");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const field = "w-full rounded border border-chrome-border bg-chrome-surface-alt p-2 text-sm";
  const defaultPort = kind === "mysql" ? "3306" : kind === "mssql" ? "1433" : "5432";
  return <details className="rounded border border-chrome-border p-3">
    <summary className="cursor-pointer text-sm font-semibold">Preparar banco automaticamente (primeiro acesso)</summary>
    <p className="my-2 text-xs text-chrome-text-muted">{kind === "supabase"
      ? "Use os dados PostgreSQL da opção Connect do Supabase de destino, incluindo a senha do banco. Confira se o host pertence ao mesmo projeto da URL acima. A preparação instala o bucket privado, as tabelas e as políticas de acesso."
      : "Se o usuário de uso diário não pode criar tabelas, use uma conexão administrativa aqui para preparar o mesmo banco. Tabelas existentes e projetos são preservados."}</p>
    <div className="space-y-2">
      <ConnectionStringInput kind={kind === "supabase" ? "postgres" : kind} disabled={busy} onApply={c => {
        setHost(c.host); setPort(String(c.port)); setDatabase(c.database); setUsername(c.username); setPassword(c.password);
      }} />
      <label className="block text-sm">Host administrativo<input disabled={busy} className={field} value={host} onChange={e => setHost(e.target.value)} /></label>
      <label className="block text-sm">Porta<input disabled={busy} type="number" min="1" max="65535" className={field} value={port || defaultPort} onChange={e => setPort(e.target.value)} /></label>
      <DestinationSetup host={host} port={Number(port || defaultPort)} busy={busy} run={run} />
      <label className="block text-sm">Banco<input disabled={busy} className={field} value={database} onChange={e => setDatabase(e.target.value)} /></label>
      <label className="block text-sm">Usuário administrativo<input disabled={busy} autoComplete="off" className={field} value={username} onChange={e => setUsername(e.target.value)} /></label>
      <label className="block text-sm">Senha administrativa<input disabled={busy} type="password" autoComplete="off" className={field} value={password} onChange={e => setPassword(e.target.value)} /></label>
      <p className="text-xs text-chrome-text-muted">A senha é usada somente nesta preparação e limpa ao terminar. O servidor precisa ter este destino autorizado. Depois, conecte com o usuário de uso diário; o programa não cria usuários nem distribui permissões SQL automaticamente.</p>
      <button type="button" disabled={busy || !host || !database || !username || !password}
        className="rounded border border-chrome-border px-3 py-2 text-sm disabled:opacity-40" onClick={() => void run(async () => {
          try {
            await prepareCustomerDatabase({ kind: kind === "supabase" ? "postgres" : kind, host, port: Number(port || defaultPort), database, username, password }, kind === "supabase");
            onPrepared();
          } finally { setPassword(""); }
        })}>Preparar banco</button>
    </div>
  </details>;
}
