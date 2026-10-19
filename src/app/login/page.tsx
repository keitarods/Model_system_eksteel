"use client";

import { useInstallation } from "@/lib/supabase/InstallationProvider";
import { AppBackground } from "@/components/auth/AppBackground";
import { EmekaBrand } from "@/components/auth/EmekaBrand";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const MAX_TENTATIVAS_LOGIN = 5;
const TEMPO_BLOQUEIO_MS = 5 * 60 * 1000;

function normalizarEmail(email: string) {
  return email.trim().toLowerCase();
}

function gerarChaveTentativas(email: string) {
  return `emeka_login_tentativas_${normalizarEmail(email)}`;
}

function gerarChaveBloqueio(email: string) {
  return `emeka_login_bloqueio_${normalizarEmail(email)}`;
}

function obterTempoRestanteBloqueio(email: string) {
  if (typeof window === "undefined") return 0;

  const bloqueadoAte = Number(
    localStorage.getItem(gerarChaveBloqueio(email)) || 0
  );
  const restante = bloqueadoAte - Date.now();

  return restante > 0 ? restante : 0;
}

function formatarTempoBloqueio(ms: number) {
  const totalSegundos = Math.ceil(ms / 1000);
  const minutos = Math.floor(totalSegundos / 60);
  const segundos = totalSegundos % 60;

  if (minutos <= 0) {
    return `${segundos}s`;
  }

  return `${minutos}min ${String(segundos).padStart(2, "0")}s`;
}

function registrarTentativaErrada(email: string) {
  if (typeof window === "undefined") return 0;

  const chaveTentativas = gerarChaveTentativas(email);
  const tentativasAtuais = Number(localStorage.getItem(chaveTentativas) || 0);
  const novasTentativas = tentativasAtuais + 1;

  localStorage.setItem(chaveTentativas, String(novasTentativas));

  if (novasTentativas >= MAX_TENTATIVAS_LOGIN) {
    localStorage.setItem(
      gerarChaveBloqueio(email),
      String(Date.now() + TEMPO_BLOQUEIO_MS)
    );
    localStorage.setItem(chaveTentativas, "0");
  }

  return novasTentativas;
}

function limparTentativasLogin(email: string) {
  if (typeof window === "undefined") return;

  localStorage.removeItem(gerarChaveTentativas(email));
  localStorage.removeItem(gerarChaveBloqueio(email));
}

export default function LoginPage() {
  const router = useRouter();

  const [emailLogin, setEmailLogin] = useState(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem("emeka_email_login") ?? "";
  });
  const [senhaLogin, setSenhaLogin] = useState("");
  const config = useInstallation();
  const [manterConectado, setManterConectado] = useState(() => {
    if (typeof window === "undefined") return true;
    const manterSalvo = localStorage.getItem("emeka_manter_conectado");
    return manterSalvo === null ? true : manterSalvo === "true";
  });

  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("error") === "auth_callback") setErro("Link inválido ou expirado. Solicite um novo link de acesso.");
    if (!config) return;

    let montado = true;
    const supabase = createClient();

    supabase.auth.getUser().then(({ data }) => {
      if (!montado) return;
      if (data.user) {
        router.replace("/ferramentas");
      }
    });

    return () => {
      montado = false;
    };
  }, [router, config]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setErro("");

    if (!config) {
      setErro(
        "Abra /configurar para informar a URL e a chave pública pelo software."
      );
      return;
    }

    const email = normalizarEmail(emailLogin);

    if (!email || !senhaLogin.trim()) {
      setErro("Preencha e-mail e senha.");
      return;
    }

    setCarregando(true);

    const tempoRestante = obterTempoRestanteBloqueio(email);

    if (tempoRestante > 0) {
      setCarregando(false);
      setErro(
        `Muitas tentativas incorretas. Tente novamente em ${formatarTempoBloqueio(
          tempoRestante
        )}.`
      );
      return;
    }

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password: senhaLogin,
    }).catch(() => ({ error: { code: "network_error" } }));

    setCarregando(false);

    if (error) {
      if (error.code !== "invalid_credentials") {
        setErro("Não foi possível entrar. Confira o e-mail e a senha.");
        return;
      }

      const tentativas = registrarTentativaErrada(email);
      const tentativasRestantes = MAX_TENTATIVAS_LOGIN - tentativas;

      if (tentativas >= MAX_TENTATIVAS_LOGIN) {
        setErro(
          "Muitas tentativas incorretas. Seu login foi bloqueado por 5 minutos."
        );
        return;
      }

      setErro(
        tentativasRestantes > 0
          ? `E-mail ou senha incorretos, tente novamente. Você ainda tem ${tentativasRestantes} tentativa${
              tentativasRestantes === 1 ? "" : "s"
            } antes do bloqueio.`
          : "E-mail ou senha incorretos, tente novamente."
      );
      return;
    }

    limparTentativasLogin(email);

    if (manterConectado) {
      localStorage.setItem("emeka_email_login", email);
      localStorage.setItem("emeka_manter_conectado", "true");
    } else {
      localStorage.removeItem("emeka_email_login");
      localStorage.setItem("emeka_manter_conectado", "false");
    }

    router.push("/ferramentas");
    router.refresh();
  }

  if (!config) return <main className="m-auto p-8"><h1>Configuração inicial necessária</h1><a className="underline" href="/configurar">Configurar acesso ao software</a></main>;
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#1e1e1e] text-white">
      <AppBackground />

      <section className="relative z-10 mx-auto flex min-h-screen max-w-6xl items-center justify-center px-4 py-8 sm:px-6 sm:py-12 lg:justify-end">
          <div className="w-full max-w-[400px] rounded-[28px] border border-white/60 bg-white/95 p-6 text-[#1e1e1e] shadow-xl shadow-black/15 backdrop-blur-md sm:p-8">
            <div className="flex justify-center">
              <EmekaBrand />
            </div>
            <h1 className="sr-only">Entrar na Emeka Engenharia</h1>

            {erro ? (
              <div role="alert" className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {erro}
              </div>
            ) : null}

            <form onSubmit={handleLogin} className="mt-6 space-y-4">
              <InputField
                label="E-mail"
                type="email"
                value={emailLogin}
                onChange={setEmailLogin}
                placeholder="seuemail@exemplo.com"
                autoComplete="email"
              />
              <InputField
                label="Senha"
                type="password"
                value={senhaLogin}
                onChange={setSenhaLogin}
                placeholder="Digite sua senha"
                autoComplete="current-password"
              />

              <div className="py-1">
                <label className="flex cursor-pointer items-start gap-3 text-sm">
                  <input
                    type="checkbox"
                    checked={manterConectado}
                    onChange={(e) => setManterConectado(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-[#90A4AE] accent-[#546E7A]"
                  />
                  <span>
                    <span className="block font-semibold">
                      Lembrar meu e-mail
                    </span>

                  </span>
                </label>
              </div>

              <SubmitButton loading={carregando} idleText="Entrar" />
            </form>
            <a href="/forgot-password" className="mt-5 block text-center text-sm underline">Esqueci minha senha</a>
          </div>
      </section>
    </main>
  );
}

function EyeIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

type InputFieldProps = {
  label: string;
  type: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  autoComplete: string;
  help?: string;
};

function InputField({
  label,
  type: tipoProp,
  value,
  onChange,
  placeholder,
  autoComplete,
  help,
}: InputFieldProps) {
  const [mostrar, setMostrar] = useState(false);
  const ehSenha = tipoProp === "password";
  const tipo = ehSenha && mostrar ? "text" : tipoProp;

  return (
    <div>
      <label htmlFor={autoComplete} className="mb-1 block text-sm font-medium">{label}</label>
      <div className="relative">
        <input
          id={autoComplete}
          required
          type={tipo}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-2xl border border-[#90A4AE] bg-white px-4 py-3 text-[#0d1b2a] outline-none transition placeholder:text-[#9E9E9E] focus:border-[#546E7A] focus:ring-2 focus:ring-[#ECEFF1]"
          style={ehSenha ? { paddingRight: "2.75rem" } : undefined}
          placeholder={placeholder}
          autoComplete={autoComplete}
        />
        {ehSenha && (
          <button
            type="button"
            aria-label={mostrar ? "Ocultar senha" : "Mostrar senha"}
            onClick={() => setMostrar((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[#9E9E9E] hover:text-[#546E7A] transition"
          >
            {mostrar ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        )}
      </div>
      {help ? (
        <p className="mt-2 text-xs leading-5 text-[#607D8B]">{help}</p>
      ) : null}
    </div>
  );
}

function SubmitButton({
  loading,
  idleText,
}: {
  loading: boolean;
  idleText: string;
}) {
  return (
    <button
      type="submit"
      disabled={loading}
      className="w-full rounded-2xl bg-[#546E7A] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#37474F] disabled:cursor-not-allowed disabled:opacity-60"
    >
      {loading ? "Processando..." : idleText}
    </button>
  );
}
