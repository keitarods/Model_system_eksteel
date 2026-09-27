"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { IconLogout } from "@/components/icons/ToolIcons";
import { createClient } from "@/lib/supabase/client";
import { disconnectCustomerSupabase } from "@/lib/project/supabaseConnection";

// Cabeçalho comum dos ambientes (Modelador, Montagem, Simulação): mesmo seletor
// de ambiente, mesma seção "Ambientes" no menu do logo e mesmo bloco de conta.

export type WorkspaceKind = "modelador" | "montagem" | "simulacao";

export const WORKSPACES: { kind: WorkspaceKind; label: string; href: string; title: string }[] = [
  { kind: "modelador", label: "Modelador", href: "/modelador", title: "Modelagem de peças, chapas e desenhos" },
  { kind: "montagem", label: "Montagem", href: "/montagem", title: "Montagem de peças vinculadas" },
  { kind: "simulacao", label: "Simulação", href: "/simulacao", title: "Análise estrutural por elementos finitos" },
];

/** Alternância entre ambientes, igual em todas as telas; o ambiente atual fica destacado. */
export function WorkspaceSwitcher({ current, disabled }: { current: WorkspaceKind; disabled?: boolean }) {
  const router = useRouter();
  return (
    <nav aria-label="Ambientes" className="flex shrink-0 items-center gap-0.5 rounded-lg bg-chrome-surface-alt p-0.5">
      {WORKSPACES.map((w) => (
        <button key={w.kind} type="button" title={w.title} aria-current={w.kind === current ? "page" : undefined}
          disabled={disabled && w.kind !== current}
          onClick={() => { if (w.kind !== current) router.push(w.href); }}
          className={`rounded-md px-2.5 py-1 text-xs font-semibold disabled:opacity-40 ${w.kind === current ? "bg-primary text-primary-foreground" : "text-chrome-text-muted hover:bg-chrome-border"}`}>
          {w.label}
        </button>
      ))}
    </nav>
  );
}

/** Seção fixa no fim do menu do logo, a mesma em todos os ambientes. */
export function WorkspaceMenuSection({ current }: { current: WorkspaceKind }) {
  const router = useRouter();
  return (
    <>
      <div aria-hidden="true" className="my-1 h-px w-full bg-chrome-border" />
      <p className="px-3 pt-1 text-[11px] font-semibold uppercase tracking-wide text-chrome-text-subtle">Ambientes</p>
      {WORKSPACES.map((w) => (
        <button key={w.kind} type="button" title={w.title} disabled={w.kind === current}
          onClick={() => router.push(w.href)}
          className="rounded-lg text-chrome-text-muted hover:bg-chrome-surface-alt disabled:cursor-default disabled:font-semibold disabled:text-chrome-text">
          <span aria-hidden="true" className="w-4 text-center">{w.kind === current ? "●" : "○"}</span>
          {w.label}{w.kind === current ? " (atual)" : ""}
        </button>
      ))}
    </>
  );
}

/** Divisória entre grupos do menu do logo. */
export function MenuDivider() {
  return <div aria-hidden="true" className="my-1 h-px w-full bg-chrome-border" />;
}

/** E-mail da conta e "Sair", iguais em todos os ambientes. */
export function AccountBadge({ userEmail }: { userEmail: string }) {
  const router = useRouter();
  const logout = useCallback(async () => {
    const supabase = createClient();
    await disconnectCustomerSupabase().catch(() => undefined);
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }, [router]);
  if (!userEmail) return null;
  return (
    <div className="flex shrink-0 items-center gap-2 rounded-xl border border-chrome-border bg-chrome-surface-alt px-2 py-1">
      <div className="hidden flex-col whitespace-nowrap text-xs leading-tight xl:flex">
        <span className="text-chrome-text-subtle">Conectado como</span>
        <span className="max-w-48 truncate font-semibold text-chrome-text" title={userEmail}>{userEmail}</span>
      </div>
      <button type="button" onClick={logout} title={`Sair da conta (${userEmail})`}
        className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold text-chrome-text-muted hover:bg-chrome-border">
        <IconLogout />
        <span>Sair</span>
      </button>
    </div>
  );
}
