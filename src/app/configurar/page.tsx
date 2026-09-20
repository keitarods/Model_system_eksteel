"use client";
import { useState } from "react";
import { useInstallation } from "@/lib/supabase/InstallationProvider";
import { InstallationSetup } from "@/components/modelador/InstallationSetup";

// Compatibility entry for existing login links; the same form lives in the cloud dialog.
export default function Configure() {
  const existing = useInstallation();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  if (existing) return <main className="m-auto p-8">Instalação já configurada. <a href="/login">Ir para o login</a></main>;
  return <main className="m-auto w-full max-w-lg p-6">
    <InstallationSetup busy={busy} run={async action => {
      setBusy(true); setMessage("");
      try { await action(); } catch (error) { setMessage(error instanceof Error ? error.message : "Falha ao configurar."); }
      finally { setBusy(false); }
    }} />
    <p role="alert">{message}</p>
    <a className="underline" href="/modelador">Voltar ao Modelador</a>
  </main>;
}
