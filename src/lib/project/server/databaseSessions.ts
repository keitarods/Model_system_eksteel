import { randomBytes } from "node:crypto";
import type { DatabaseCredentials } from "../databaseConfig";

type Session = { owner: string; credentials: DatabaseCredentials; expires: number; busy: boolean };
// Process-local, bounded, short-lived: credentials are never sent back or persisted.
// A multi-replica deployment requires sticky routing or a shared encrypted vault.
const state = globalThis as typeof globalThis & { cadDatabaseSessions?: Map<string, Session> };
const sessions = state.cadDatabaseSessions ??= new Map<string, Session>();
function cleanup() { for (const [id, session] of sessions) if (session.expires < Date.now()) sessions.delete(id); }
export function addDatabaseSession(owner: string, credentials: DatabaseCredentials) {
  cleanup();
  if (sessions.size >= 100 || [...sessions.values()].filter(s => s.owner === owner).length >= 5) throw new Error("Limite de conexões atingido. Desconecte uma sessão ou aguarde sua expiração.");
  const token = randomBytes(32).toString("hex");
  const expires = Date.now() + 60 * 60 * 1000;
  sessions.set(token, { owner, credentials, expires, busy: false });
  const timer = setTimeout(() => sessions.delete(token), 60 * 60 * 1000);
  timer.unref();
  return token;
}
export function getDatabaseSession(token: string, owner: string) {
  cleanup();
  const session = sessions.get(token);
  if (!session || session.owner !== owner) throw new Error("Conexão expirada. Conecte o banco novamente.");
  return session;
}
export function removeDatabaseSession(token: string, owner: string) { getDatabaseSession(token, owner); sessions.delete(token); }
