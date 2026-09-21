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

const CONNECTION_KEY = 'eksteel.cloud.tab-connection.v1';
const AUTH_KEY = 'eksteel.cloud.tab-auth.v1';
const TAB_KEY = 'eksteel.cloud.tab-id.v1';
function authStorageKey(storage: Storage | undefined, create = false): string {
  let id = storage?.getItem(TAB_KEY);
  if (!id && create && storage) { id = crypto.randomUUID(); storage.setItem(TAB_KEY, id); }
  return id ? `${AUTH_KEY}.${id}` : AUTH_KEY;
}
function clearTabSession() {
  const storage = tabStorage();
  storage?.removeItem(CONNECTION_KEY);
  storage?.removeItem(authStorageKey(storage));
  storage?.removeItem(TAB_KEY);
}
let cachedSession: Promise<CloudSession | null> | null = null;

function tabStorage(): Storage | undefined {
  try { return typeof window === 'undefined' ? undefined : window.sessionStorage; }
  catch { return undefined; }
}
function customerClient(config: { url: string; key: string }) {
  const storage = tabStorage();
  return createClient(config.url, config.key, {
    auth: { persistSession: !!storage, storage, storageKey: authStorageKey(storage, true), detectSessionInUrl: false, autoRefreshToken: true },
  });
}
async function sessionFor(client: ReturnType<typeof customerClient>): Promise<CloudSession> {
  const provider = await connectCloud(client);
  provider.documents = createDocumentLibrary(client, provider.userId);
  return {
    provider,
    async disconnect() {
      cachedSession = null;
      client.auth.stopAutoRefresh();
      try { await client.auth.signOut({ scope: 'local' }); }
      finally {
        clearTabSession();
      }
    },
  };
}

/** Independent per-tab auth: survives refresh without touching application cookies. */
export async function connectCustomerSupabase(url: string, key: string, email: string, password: string): Promise<CloudSession> {
  const config = validateSupabaseCredentials(url, key);
  if (!email.trim() || !password) throw new Error("Informe o e-mail e a senha de um usuário do Supabase conectado.");
  await disconnectCustomerSupabase();
  const client = customerClient(config);
  try {
    const { error } = await client.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw new Error("Não foi possível autenticar no Supabase informado. Confira URL, chave pública e usuário/senha.");
    const session = await sessionFor(client);
    tabStorage()?.setItem(CONNECTION_KEY, JSON.stringify({ ...config, email: email.trim() }));
    cachedSession = Promise.resolve(session);
    return session;
  } catch (error) {
    client.auth.stopAutoRefresh();
    await client.auth.signOut({ scope: 'local' }).catch(() => undefined);
    clearTabSession();
    throw error;
  }
}

export function savedTabConnection(): { url: string; key: string; email: string } | null {
  try {
    const value = JSON.parse(tabStorage()?.getItem(CONNECTION_KEY) ?? 'null');
    if (!value || typeof value.email !== 'string') return null;
    return { ...validateSupabaseCredentials(value.url, value.key), email: value.email };
  } catch { return null; }
}

export function restoreCustomerSupabase(): Promise<CloudSession | null> {
  if (cachedSession) return cachedSession;
  const config = savedTabConnection();
  if (!config) return Promise.resolve(null);
  cachedSession = (async () => {
    const client = customerClient(config);
    try {
      const { data, error } = await client.auth.getSession();
      if (error || !data.session) {
        clearTabSession();
        client.auth.stopAutoRefresh();
        return null;
      }
      return await sessionFor(client);
    } catch (error) { client.auth.stopAutoRefresh(); throw error; }
  })();
  cachedSession.catch(() => { cachedSession = null; });
  return cachedSession;
}

/** Explicit logout, also used when leaving the application's authenticated session. */
export async function disconnectCustomerSupabase(): Promise<void> {
  const current = await cachedSession?.catch(() => null);
  if (current) { await current.disconnect(); return; }
  const config = savedTabConnection();
  cachedSession = null;
  try {
    if (config) {
      const client = customerClient(config);
      client.auth.stopAutoRefresh();
      await client.auth.signOut({ scope: 'local' });
    }
  } finally {
    clearTabSession();
  }
}
