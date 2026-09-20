import type { DatabaseCredentials } from "./databaseConfig";
import type { CloudSession, CurrentProject } from "./cloudProvider";
import { validateCloudProject } from "./cloudStorage";

export async function connectCustomerDatabase(credentials: DatabaseCredentials): Promise<CloudSession> {
  if (typeof window !== "undefined" && window.location.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname)) {
    throw new Error("Acesse o software por HTTPS antes de enviar credenciais do banco.");
  }
  let token = "";
  async function call(action: string, args: Record<string, unknown> = {}): Promise<unknown> {
    const response = await fetch("/api/project-database", { method: "POST", cache: "no-store",
      headers: { "Content-Type": "application/json", "X-Cad-Connection": token },
      body: JSON.stringify({ action, ...args }) });
    if (response.redirected || !response.headers.get("content-type")?.includes("application/json")) throw new Error("Faça login no software e conecte novamente.");
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Falha na conexão com o banco.");
    return action === "connect" ? body : body.result;
  }
  const info = await call("connect", { credentials }) as { token: string; userId: string };
  token = info.token;
  async function list(action: string, args = {}): Promise<string[]> {
    const all: string[] = [];
    for (let offset = 0; ; offset += 100) {
      const page = await call(action, { ...args, offset }) as string[];
      all.push(...page); if (page.length < 100) return all;
    }
  }
  return {
    provider: {
      userId: info.userId,
      folders: () => list("folders"),
      projects: folder => list("projects", { folder }),
      versions: (folder, project) => list("versions", { folder, project }),
      async createFolder(folder) { await call("createFolder", { folder }); },
      async current(folder, project) {
        return await call("current", { folder, project }) as CurrentProject | null;
      },
      async saveCurrent(folder, project, json, expected) {
        validateCloudProject(json);
        if (new Blob([json]).size > 10 * 1024 * 1024) throw new Error("O limite para bancos SQL é 10 MiB por versão.");
        return await call("saveCurrent", { folder, project, json, expected }) as string;
      },
      async save(folder, project, json) {
        validateCloudProject(json);
        if (new Blob([json]).size > 10 * 1024 * 1024) throw new Error("O limite para bancos SQL é 10 MiB por versão.");
        return await call("save", { folder, project, json }) as string;
      },
      async open(folder, project, version) {
        const json = await call("open", { folder, project, version }) as string;
        validateCloudProject(json); return json;
      },
    },
    async disconnect() { try { await call("disconnect"); } finally { token = ""; } },
  };
}

/** Administrative setup is a one-shot request; no server credential session is created. */
export async function prepareCustomerDatabase(credentials: DatabaseCredentials, supabase: boolean): Promise<void> {
  if (window.location.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname)) throw new Error("Acesse o software por HTTPS antes de enviar credenciais.");
  const response = await fetch("/api/project-database", { method: "POST", cache: "no-store",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "prepare", credentials, supabase }) });
  if (response.redirected || !response.headers.get("content-type")?.includes("application/json")) throw new Error("Faça login no software para preparar o banco.");
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Não foi possível preparar o banco.");
}
