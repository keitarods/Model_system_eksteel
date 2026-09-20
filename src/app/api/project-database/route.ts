import { databaseErrorMessage } from "@/lib/project/server/databaseErrors";
import { allowedDestinationsFor } from "@/lib/project/server/destinations";
import { installation } from "@/lib/supabase/installation";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { databaseCredentials } from "@/lib/project/databaseConfig";
import { prepareSqlDatabase, prepareSupabaseDatabase } from "@/lib/project/server/prepareDatabase";
import { openDatabase } from "@/lib/project/server/databaseDriver";
import { databaseProjectAction, type DatabaseAction } from "@/lib/project/server/databaseProjects";
import { addDatabaseSession, getDatabaseSession, removeDatabaseSession } from "@/lib/project/server/databaseSessions";

export const runtime = "nodejs";
const response = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
async function readBody(request: NextRequest) {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new Error("Formato inválido.");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Corpo ausente.");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length;
      // JSON wrapper can expand escapes in a native JSON document.
      if (size > 22 * 1024 * 1024) { await reader.cancel(); throw new Error("Requisição acima do limite."); }
      chunks.push(value);
    }
    const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Requisição inválida.");
    return data;
  } finally { reader.releaseLock(); }
}

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return response({ error: "Origem inválida." }, 403);
  if (!(await installation())) return response({ error: "Configure o acesso ao software em /configurar, depois entre em /login." }, 503);
  const auth = await createClient();
  const { data, error } = await auth.auth.getUser();
  if (error || !data.user) return response({ error: "Faça login no software." }, 401);
  const owner = data.user.id;
  try {
    const input = await readBody(request);
    if (input.action === "prepare") {
      const credentials = databaseCredentials(input.credentials, await allowedDestinationsFor(input.credentials));
      if (input.supabase && credentials.kind !== "postgres") return response({ error: "Preparação: o Supabase requer conexão PostgreSQL." }, 400);
      const driver = await openDatabase(credentials);
      try {
        if (input.supabase) await prepareSupabaseDatabase(driver);
        else await prepareSqlDatabase(driver, credentials.kind);
      } finally { await driver.close(); }
      return response({ result: "Estrutura preparada. Conecte com as credenciais de uso diário." });
    }
    if (input.action === "connect") {
      const credentials = databaseCredentials(input.credentials, await allowedDestinationsFor(input.credentials));
      const driver = await openDatabase(credentials);
      try {
        // Connecting only checks the schema. Administrative setup is separate.
        await driver.query("SELECT name FROM eksteel_cad_folders WHERE owner_id = ? AND 1 = 0", [owner]);
        await driver.query("SELECT revision_token FROM eksteel_cad_current WHERE owner_id = ? AND 1 = 0", [owner]);
        await driver.query("SELECT version_id, body FROM eksteel_cad_versions WHERE owner_id = ? AND 1 = 0", [owner]);
      } finally { await driver.close(); }
      return response({ token: addDatabaseSession(owner, credentials), userId: owner });
    }
    const token = request.headers.get("x-cad-connection") ?? "";
    const session = getDatabaseSession(token, owner);
    if (input.action === "disconnect") { removeDatabaseSession(token, owner); return response({ result: null }); }
    if (session.busy) return response({ error: "A conexão está executando outra operação." }, 409);
    session.busy = true;
    try {
      // Recheck the administrator's allowlist on every request.
      const credentials = databaseCredentials(session.credentials, await allowedDestinationsFor(session.credentials));
      const driver = await openDatabase(credentials);
      try { return response({ result: await databaseProjectAction(driver, credentials.kind, owner, input as DatabaseAction) }); }
      finally { await driver.close(); }
    } finally { session.busy = false; }
  } catch (error) {
    // Driver errors can contain connection data and SQL. Never return/log raw errors.
    const safe = error instanceof Error && (
      /^(Certificado CA|Preparação:|Conflito:|Destino não autorizado|Conector não suportado|Campo inválido|Host ou porta inválidos|Configuração inválida|Conexão expirada|Limite de conexões|O limite para bancos|Versão não encontrada|Projeto acima|Página inválida|Operação não suportada|Versão inválida|Use de 1 a 80|Requisição acima)/.test(error.message)
    );
    return response({ error: safe ? error.message : databaseErrorMessage(error) }, error instanceof Error && error.message.startsWith("Conflito:") ? 409 : 400);
  }
}
