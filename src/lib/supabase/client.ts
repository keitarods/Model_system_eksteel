import { createBrowserClient } from "@supabase/ssr";

// Em produção, NEXT_PUBLIC_COOKIE_DOMAIN = ".eksteelsolucoes.com.br" faz o
// cookie de sessão ser lido também pelo gestão (mesmo domínio pai). Em
// desenvolvimento local fica vazio de propósito: o browser rejeita um
// cookie com Domain que não corresponde ao host atual (localhost).
const cookieDomain = process.env.NEXT_PUBLIC_COOKIE_DOMAIN || undefined;

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    cookieDomain ? { cookieOptions: { domain: cookieDomain } } : undefined
  );
}
