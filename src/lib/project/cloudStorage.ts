import { CLOUD_CONFLICT, type ProjectCloudProvider } from "./cloudProvider";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseProject } from "./nativeFormat";

export const CLOUD_BUCKET = "cad-projects";
export const MAX_PROJECT_BYTES = 50 * 1024 * 1024;

/** Names are path segments, never arbitrary Storage paths supplied by a caller. */
export function cloudName(value: string): string {
  const name = value.trim().normalize("NFC");
  if (!name || name.length > 80 || !/^[\p{L}\p{N}][\p{L}\p{N} _().-]*$/u.test(name) || name.endsWith(".")) {
    throw new Error("Use de 1 a 80 letras, números, espaços, hífen, ponto ou parênteses; comece com letra ou número.");
  }
  return name;
}

/** Preserve existing ASCII paths; reserved prefix cannot be a legacy cloudName.
 * UTF-8 hex is reversible and uses only Storage-safe ASCII characters.
 */
export function storageSegment(value: string): string {
  const name = cloudName(value);
  if (/^[\x20-\x7e]+$/.test(name)) return name;
  return "_u_" + Array.from(new TextEncoder().encode(name), byte => byte.toString(16).padStart(2, "0")).join("");
}
export function storageDisplayName(segment: string): string {
  if (!/^_u_(?:[0-9a-f]{2})+$/.test(segment)) return segment;
  try {
    const bytes = Uint8Array.from(segment.slice(3).match(/../g)!, pair => parseInt(pair, 16));
    const name = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return storageSegment(name) === segment ? name : segment;
  } catch { return segment; }
}

export function validateCloudProject(json: string): void {
  if (new Blob([json]).size > MAX_PROJECT_BYTES) throw new Error("O projeto excede o limite de 50 MiB.");
  parseProject(json);
}

export function cloudVersionName(now = new Date(), id = crypto.randomUUID()): string {
  return `${now.toISOString().replace(/:/g, "-")}_${id}.eks3d`;
}

/** Uses the signed-in user's JWT and RLS; never a service-role key. Current records use CAS; explicit revisions are immutable. */
export async function connectCloud(client: SupabaseClient): Promise<ProjectCloudProvider> {
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new Error("Entre na sua conta para acessar os projetos na nuvem.");
  const root = data.user.id;
  const bucket = client.storage.from(CLOUD_BUCKET);
  const path = (...segments: string[]) => [root, ...segments.map(storageSegment)].join("/");
  const check = (error: { message: string } | null) => {
    if (error) throw new Error(`Falha no Storage: ${error.message}. Confira as permissões e a configuração do armazenamento.`);
  };
  async function list(prefix: string, directories: boolean): Promise<string[]> {
    const names: string[] = [];
    const limit = 100;
    for (let offset = 0; ; offset += limit) {
      const { data, error } = await bucket.list(prefix, { limit, offset, sortBy: { column: "name", order: "asc" } });
      check(error);
      if (!data) throw new Error("O Storage não retornou a listagem.");
      for (const item of data) {
        if (directories ? item.id === null : !!item.id && item.name.endsWith(".eks3d")) names.push(directories ? storageDisplayName(item.name) : item.name);
      }
      if (data.length < limit) break;
    }
    return names;
  }
  return {
    userId: root,
    async folders() {
      // Check the current-piece table even for an empty account. Otherwise a
      // missing migration is hidden until the first folder/project is saved.
      const { error } = await client.from("eksteel_cad_current").select("project_name, revision_token")
        .eq("owner_id", root).range(0, 0);
      check(error);
      return list(root, true);
    },
    async projects(folder: string) {
      const names = await list(path(folder), true);
      for (let offset = 0; ; offset += 100) {
        const { data, error } = await client.from("eksteel_cad_current").select("project_name")
          .eq("owner_id", root).eq("folder_name", cloudName(folder)).order("project_name").range(offset, offset + 99);
        check(error);
        for (const row of data ?? []) names.push(row.project_name);
        if (!data || data.length < 100) break;
      }
      return [...new Set(names)].sort();
    },
    async current(folder, project) {
      const { data, error } = await client.from("eksteel_cad_current").select("body, revision_token")
        .eq("owner_id", root).eq("folder_name", cloudName(folder)).eq("project_name", cloudName(project)).maybeSingle();
      check(error);
      if (!data) return null;
      validateCloudProject(data.body);
      return { json: data.body, token: data.revision_token };
    },
    async saveCurrent(folder, project, json, expected) {
      validateCloudProject(json);
      const token = crypto.randomUUID();
      const row = { owner_id: root, folder_name: cloudName(folder), project_name: cloudName(project), body: json, revision_token: token };
      if (expected === null) {
        const { error } = await client.from("eksteel_cad_current").insert(row);
        if (error?.code === "23505") throw new Error(CLOUD_CONFLICT);
        check(error);
      } else {
        const { data, error } = await client.from("eksteel_cad_current").update({ body: json, revision_token: token })
          .eq("owner_id", root).eq("folder_name", row.folder_name).eq("project_name", row.project_name)
          .eq("revision_token", expected).select("revision_token");
        check(error);
        if (!data?.length) throw new Error(CLOUD_CONFLICT);
      }
      return token;
    },
    versions: async (folder: string, project: string) => (await list(path(folder, project), false)).reverse(),
    async createFolder(folder: string) {
      const { error } = await bucket.upload(`${path(folder)}/.folder.json`, new Blob(["{}"], { type: "application/json" }), { upsert: false, contentType: "application/json" });
      check(error);
    },
    async save(folder: string, project: string, json: string) {
      validateCloudProject(json);
      const version = cloudVersionName();
      const { error } = await bucket.upload(`${path(folder, project)}/${version}`, new Blob([json], { type: "application/json" }), { upsert: false, contentType: "application/json" });
      check(error);
      return version;
    },
    async open(folder: string, project: string, version: string) {
      if (!/^\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d\.\d{3}Z_[0-9a-f-]{36}\.eks3d$/.test(version)) throw new Error("Versão inválida.");
      const { data, error } = await bucket.download(`${path(folder, project)}/${version}`);
      check(error);
      if (!data) throw new Error("Projeto não encontrado.");
      if (data.size > MAX_PROJECT_BYTES) throw new Error("O projeto excede o limite de 50 MiB.");
      const json = await data.text();
      validateCloudProject(json);
      return json;
    },
  };
}
export type CloudConnection = Awaited<ReturnType<typeof connectCloud>>;
