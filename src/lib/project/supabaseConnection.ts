import { createDocumentLibrary } from "./cloudDocuments";
import { createClient } from "@supabase/supabase-js";
import { connectCloud } from "./cloudStorage";
import type { CloudSession } from "./cloudProvider";

export function validateSupabaseCredentials(url: string, key: string) {
  let parsed: URL;
  try { parsed = new URL(url.trim()); } catch { throw new Error("Informe uma URL válida do projeto Supabase."); }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== "/") {
    throw new Error("Use a URL HTTPS do projeto, sem senha, caminho ou parâmetros.");
  }
  const publicKey = key.trim();
  if (!publicKey.startsWith("sb_publishable_")) {
    // Legacy anon keys are JWTs. This only prevents accidentally submitting a
    // privileged key; signature/authorization remain the Supabase server's job.
    let role: unknown;
    try {
      const payload = publicKey.split(".")[1];
      role = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))).role;
    } catch { /* Handled by the public-key error below. */ }
    if (role !== "anon") throw new Error("Use somente a chave pública anon/publishable. Chaves secret/service_role não são aceitas.");
  }
  return { url: parsed.origin, key: publicKey };
}

/** Separate in-memory session: cannot overwrite the application's login cookies. */
export async function connectCustomerSupabase(url: string, key: string, email: string, password: string): Promise<CloudSession> {
  const config = validateSupabaseCredentials(url, key);
  if (!email.trim() || !password) throw new Error("Informe o e-mail e a senha de um usuário do Supabase conectado.");
  const client = createClient(config.url, config.key, {
    auth: { persistSession: false, detectSessionInUrl: false, autoRefreshToken: true },
  });
  try {
    const { error } = await client.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw new Error("Não foi possível autenticar no Supabase informado. Confira URL, chave pública e usuário/senha.");
    const provider = await connectCloud(client);
    provider.documents = createDocumentLibrary(client, provider.userId);
    return {
      provider,
      async disconnect() {
        client.auth.stopAutoRefresh();
        await client.auth.signOut({ scope: "local" });
      },
    };
  } catch (error) {
    client.auth.stopAutoRefresh();
    await client.auth.signOut({ scope: "local" }).catch(() => undefined);
    throw error;
  }
}
