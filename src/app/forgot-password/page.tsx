"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useInstallation } from "@/lib/supabase/InstallationProvider";
import { AppBackground } from "@/components/auth/AppBackground";
import { EmekaBrand } from "@/components/auth/EmekaBrand";

export default function ForgotPassword() {
  const config = useInstallation();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  return <main className="relative flex min-h-screen items-center justify-center bg-[#111b22] p-6">
    <AppBackground />
    <section className="relative z-10 w-full max-w-md space-y-8">
      <EmekaBrand />
      <form className="space-y-5 rounded-3xl bg-white p-8 text-slate-900" onSubmit={async e => {
        e.preventDefault(); setBusy(true); setMessage("");
        try {
          if (!config) throw new Error("Configure o acesso em /configurar.");
          const { error } = await createClient().auth.resetPasswordForEmail(email.trim().toLowerCase(), {
            redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
          });
          if (error) throw new Error("Não foi possível enviar o link. Tente novamente em alguns instantes.");
          setMessage("Se houver uma conta para esse e-mail, você receberá um link para redefinir a senha.");
        } catch (error) { setMessage(error instanceof Error ? error.message : "Falha de conexão. Tente novamente."); }
        finally { setBusy(false); }
      }}>
        <h1 className="text-xl font-bold">Recuperar acesso</h1>
        <p className="text-sm text-slate-600">Informe seu e-mail corporativo para receber o link.</p>
        <label className="block">E-mail<input required type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} className="mt-2 w-full rounded-xl border p-3" /></label>
        <p role="status" className="text-sm">{message}</p>
        <button disabled={busy || !config} className="w-full rounded-xl bg-[#546E7A] p-3 text-white disabled:opacity-50">{busy ? "Enviando..." : "Enviar link"}</button>
        <a href="/login" className="block text-center text-sm underline">Voltar ao login</a>
      </form>
    </section>
  </main>;
}
