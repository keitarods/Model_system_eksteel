import { CLOUD_CONFLICT } from "../cloudProvider";
import { cloudName, cloudVersionName, validateCloudProject } from "../cloudStorage";
import type { DatabaseKind } from "../databaseConfig";
import type { DatabaseDriver } from "./databaseDriver";

export const DATABASE_PROJECT_LIMIT = 10 * 1024 * 1024;
export type DatabaseAction = { action: string; folder?: string; project?: string; version?: string; json?: string; offset?: number; expected?: string | null };

/** All predicates include the authenticated application user, never a body-supplied owner. */
export async function databaseProjectAction(driver: DatabaseDriver, kind: DatabaseKind, owner: string, input: DatabaseAction): Promise<unknown> {
  const folder = () => cloudName(input.folder ?? "");
  const project = () => cloudName(input.project ?? "");
  const offset = input.offset ?? 0;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1000000) throw new Error("Página inválida.");
  const page = kind === "mssql" ? ` OFFSET ${offset} ROWS FETCH NEXT 100 ROWS ONLY` : ` LIMIT 100 OFFSET ${offset}`;
  const names = async (sql: string, values: string[]) => (await driver.query(sql + page, values)).map(row => String(row.name));
  switch (input.action) {
    case "folders": return names("SELECT name FROM eksteel_cad_folders WHERE owner_id = ? ORDER BY name", [owner]);
    case "projects": return names("SELECT project_name AS name FROM eksteel_cad_versions WHERE owner_id = ? AND folder_name = ? UNION SELECT project_name AS name FROM eksteel_cad_current WHERE owner_id = ? AND folder_name = ? ORDER BY name", [owner, folder(), owner, folder()]);
    case "versions": return names("SELECT version_id AS name FROM eksteel_cad_versions WHERE owner_id = ? AND folder_name = ? AND project_name = ? ORDER BY name DESC", [owner, folder(), project()]);
    case "createFolder":
      await driver.query("INSERT INTO eksteel_cad_folders (owner_id, name) VALUES (?, ?)", [owner, folder()]); return null;
    case "current": {
      const rows = await driver.query("SELECT body, revision_token FROM eksteel_cad_current WHERE owner_id = ? AND folder_name = ? AND project_name = ?", [owner, folder(), project()]);
      if (!rows.length) return null;
      validateCloudProject(String(rows[0].body));
      return { json: rows[0].body, token: rows[0].revision_token };
    }
    case "saveCurrent": {
      if (typeof input.json !== "string" || Buffer.byteLength(input.json, "utf8") > DATABASE_PROJECT_LIMIT) throw new Error("O limite para bancos SQL é 10 MiB por versão.");
      validateCloudProject(input.json);
      const token = crypto.randomUUID();
      if (input.expected === null) {
        try {
          await driver.query("INSERT INTO eksteel_cad_current (owner_id, folder_name, project_name, revision_token, body) VALUES (?, ?, ?, ?, ?)", [owner, folder(), project(), token, input.json]);
        } catch (error) {
          const e = error as { code?: string; number?: number };
          if (e.code === "23505" || e.code === "ER_DUP_ENTRY" || e.number === 2627 || e.number === 2601) throw new Error(CLOUD_CONFLICT);
          throw error;
        }
      } else {
        if (typeof input.expected !== "string" || !/^[0-9a-f-]{36}$/.test(input.expected)) throw new Error("Versão inválida.");
        const rows = await driver.query("UPDATE eksteel_cad_current SET body = ?, revision_token = ? WHERE owner_id = ? AND folder_name = ? AND project_name = ? AND revision_token = ?", [input.json, token, owner, folder(), project(), input.expected]);
        if (rows[0]?.affected !== 1) throw new Error(CLOUD_CONFLICT);
      }
      return token;
    }
    case "save": {
      if (typeof input.json !== "string" || Buffer.byteLength(input.json, "utf8") > DATABASE_PROJECT_LIMIT) throw new Error("O limite para bancos SQL é 10 MiB por versão.");
      validateCloudProject(input.json);
      const version = cloudVersionName();
      await driver.query("INSERT INTO eksteel_cad_versions (owner_id, folder_name, project_name, version_id, body) VALUES (?, ?, ?, ?, ?)", [owner, folder(), project(), version, input.json]);
      return version;
    }
    case "open": {
      if (typeof input.version !== "string" || !/^[0-9TZ_.a-f-]{1,100}\.eks3d$/.test(input.version)) throw new Error("Versão inválida.");
      const rows = await driver.query("SELECT body FROM eksteel_cad_versions WHERE owner_id = ? AND folder_name = ? AND project_name = ? AND version_id = ?", [owner, folder(), project(), input.version]);
      if (!rows.length || typeof rows[0].body !== "string") throw new Error("Versão não encontrada.");
      if (Buffer.byteLength(rows[0].body, "utf8") > DATABASE_PROJECT_LIMIT) throw new Error("Projeto acima do limite de 10 MiB.");
      validateCloudProject(rows[0].body); return rows[0].body;
    }
    default: throw new Error("Operação não suportada.");
  }
}
