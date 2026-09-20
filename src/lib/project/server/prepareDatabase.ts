import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { DatabaseKind } from "../databaseConfig";
import type { DatabaseDriver } from "./databaseDriver";

// Only bundled scripts, never SQL supplied by the browser. These scripts contain
// simple statements (no procedural bodies or semicolons inside string literals).
export function setupStatements(sql: string): string[] {
  return sql.replace(/--[^\n]*/g, "").split(";").map(s => s.trim()).filter(Boolean);
}
async function script(relative: string) {
  try { return await readFile(join(process.cwd(), relative), "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      throw new Error("Os scripts privados de provisionamento não acompanham esta publicação. Solicite ao administrador a preparação do banco antes de conectar.");
    throw error;
  }
}
function code(error: unknown, strings: string[], numbers: number[] = []) {
  const e = error as { code?: string; number?: number };
  return strings.includes(e?.code ?? "") || numbers.includes(e?.number ?? -1);
}

/** Resumable: creates missing tables only. Existing rows/tables are never replaced. */
export async function prepareSqlDatabase(driver: DatabaseDriver, kind: DatabaseKind) {
  const statements = setupStatements(await script(`database/${kind}.sql`))
    .concat(setupStatements(await script(`database/${kind}-current.sql`)));
  const columns: Record<string, string> = {
    eksteel_cad_folders: "owner_id, name",
    eksteel_cad_versions: "owner_id, folder_name, project_name, version_id, body",
    eksteel_cad_current: "owner_id, folder_name, project_name, revision_token, body",
  };
  for (const statement of statements) {
    const table = /^CREATE TABLE (eksteel_cad_\w+)\s*\(/i.exec(statement)?.[1];
    if (!table || !columns[table]) throw new Error("Preparação: script interno inesperado.");
    const probe = `SELECT ${columns[table]} FROM ${table} WHERE 1 = 0`;
    try { await driver.query(probe, []); continue; }
    catch (error) {
      if (!code(error, ["42P01", "ER_NO_SUCH_TABLE"], [208])) {
        throw new Error("Preparação: estrutura existente incompatível ou sem permissão de leitura. Nenhum dado foi substituído.");
      }
    }
    try { await driver.query(statement, []); }
    catch (error) {
      // Another session may have created the same table after our probe.
      if (!code(error, ["42P07", "ER_TABLE_EXISTS_ERROR"], [2714])) {
        throw new Error("Preparação: não foi possível criar as tabelas. Informe um usuário com permissão CREATE TABLE e acesso ao esquema. A preparação pode ser repetida sem apagar os dados.");
      }
    }
    await driver.query(probe, []);
  }
}

/** PostgreSQL administrative connection to the customer's Supabase, no retained session. */
export async function prepareSupabaseDatabase(driver: DatabaseDriver) {
  await driver.query("BEGIN", []);
  try {
    await driver.query("SELECT pg_advisory_xact_lock(184739261)", []);
    // Fail before changing anything if this is an ordinary PostgreSQL database.
    await driver.query("SELECT id FROM auth.users WHERE 1 = 0", []);
    await driver.query("SELECT id FROM storage.buckets WHERE 1 = 0", []);
    const unexpected = await driver.query("SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'eksteel_cad_current' AND policyname <> 'cad_current_owner'", []);
    if (unexpected.length) throw new Error("Preparação: a tabela da peça atual contém políticas personalizadas; solicite revisão ao administrador.");
    const source = await script("supabase/migrations/202609180001_cad_project_storage.sql");
    const current = await script("supabase/migrations/202609190002_cad_current.sql");
    for (let statement of [...setupStatements(source), ...setupStatements(current)]) {
      if (/^(begin|commit)$/i.test(statement)) continue;
      statement = statement.replace(/^create table public\.eksteel_cad_current/i, "create table if not exists public.eksteel_cad_current");
      const policy = /^create policy "([a-z_]+)" on ([a-z_.]+)/i.exec(statement);
      if (policy) await driver.query(`DROP POLICY IF EXISTS "${policy[1]}" ON ${policy[2]}`, []);
      await driver.query(statement, []);
    }
    await driver.query("SELECT owner_id, folder_name, project_name, revision_token, body FROM public.eksteel_cad_current WHERE 1 = 0", []);
    await driver.query("NOTIFY pgrst, 'reload schema'", []);
    await driver.query("COMMIT", []);
  } catch (error) {
    await driver.query("ROLLBACK", []).catch(() => undefined);
    if (error instanceof Error && error.message.startsWith("Preparação:")) throw error;
    throw new Error("Preparação: confira se este é o PostgreSQL do Supabase escolhido e se o usuário pode criar tabelas e configurar as políticas do Storage. Não foi possível confirmar a preparação. Você pode tentar novamente sem substituir os projetos existentes.");
  }
}
