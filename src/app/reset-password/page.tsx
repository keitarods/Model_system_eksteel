"use client";

import { AppBackground } from "@/components/auth/AppBackground";
import { EmekaBrand } from "@/components/auth/EmekaBrand";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useInstallation } from "@/lib/supabase/InstallationProvider";
import { createClient } from "@/lib/supabase/client";

const REGEX_SENHA_FORTE = /^(?=.*[A-Z])(?=.*[^A-Za-z0-9]).{8,}$/;

export default function ResetPasswordPage() {
  const router = useRouter();
  const config = useInstallation();
  const [senha, setSenha] = useState("");
  const [confirmarSenha, setConfirmarSenha] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");
  const [sucesso, setSucesso] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro("");

    if (!REGEX_SENHA_FORTE.test(senha)) {
      setErro("A senha deve ter no mínimo 8 caracteres, 1 letra maiúscula e 1 caractere especial.");
      return;
    }

    if (senha !== confirmarSenha) {
      setErro("As senhas não conferem.");
      return;
    }

    if (!config) { setErro("Configure o acesso da emeka_system antes de redefinir a senha."); return; }
    setCarregando(true);
    const supabase = createClient();
    const { data, error: sessionError } = await supabase.auth.getUser().catch(() => ({ data: { user: null }, error: true }));
    if (sessionError || !data.user) { setCarregando(false); setErro("Link inválido ou expirado. Solicite um novo link em Esqueci minha senha."); return; }
    const { error } = await supabase.auth.updateUser({ password: senha }).catch(() => ({ error: { message: "Falha de conexão. Tente novamente." } }));
    setCarregando(false);

    if (error) {
      setErro(error.message);
      return;
    }

    setSucesso(true);
    setTimeout(() => {
      router.push("/ferramentas");
      router.refresh();
    }, 1500);
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#1e1e1e] text-white">
      <AppBackground />

      <section className="relative z-10 mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-4">
        <div className="mb-8"><EmekaBrand /></div>

        <div className="w-full rounded-[28px] border border-[#90A4AE] bg-white/90 p-6 text-[#1e1e1e] shadow-xl shadow-black/5 backdrop-blur-md">
          <h1 className="text-lg font-bold">Defina sua nova senha</h1>
          <a href="/forgot-password" className="mt-2 block text-sm underline">Solicitar novo link de acesso</a>

          {sucesso ? (
            <div className="mt-5 rounded-2xl border border-[#90A4AE] bg-[#ECEFF1] px-4 py-3 text-sm text-[#546E7A]">
              Senha atualizada. Redirecionando...
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              {erro ? (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {erro}
                </div>
              ) : null}

              <div>
                <label className="mb-1 block text-sm font-medium">Nova senha</label>
                <input
                  type="password"
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
                  placeholder="Digite a nova senha"
                  autoComplete="new-password"
                  className="w-full rounded-2xl border border-[#90A4AE] bg-white px-4 py-3 text-[#0d1b2a] outline-none transition placeholder:text-[#9E9E9E] focus:border-[#546E7A] focus:ring-2 focus:ring-[#ECEFF1]"
                />
                <p className="mt-2 text-xs leading-5 text-[#607D8B]">
                  Mínimo 8 caracteres, 1 maiúscula e 1 caractere especial.
                </p>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium">Confirmar senha</label>
                <input
                  type="password"
                  value={confirmarSenha}
                  onChange={(e) => setConfirmarSenha(e.target.value)}
                  placeholder="Repita a nova senha"
                  autoComplete="new-password"
                  className="w-full rounded-2xl border border-[#90A4AE] bg-white px-4 py-3 text-[#0d1b2a] outline-none transition placeholder:text-[#9E9E9E] focus:border-[#546E7A] focus:ring-2 focus:ring-[#ECEFF1]"
                />
              </div>

              <button
                type="submit"
                disabled={carregando || !config}
                className="w-full rounded-2xl bg-[#546E7A] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#37474F] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {carregando ? "Salvando..." : "Salvar nova senha"}
              </button>
            </form>
          )}
        </div>
      </section>
    </main>
  );
}
