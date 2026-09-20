import type { DatabaseCredentials, DatabaseKind } from "./databaseConfig";

/** Parse only connection coordinates; never forward arbitrary driver options. */
export function parseConnectionString(value: string, kind: DatabaseKind): DatabaseCredentials {
  const invalid = () => new Error("String inválida. Use protocolo://usuario:senha@host:porta/banco. Codifique caracteres especiais da senha com percent-encoding.");
  try {
    const raw = value.trim();
    if (/[\r\n\t]/.test(raw)) throw invalid();
    const url = new URL(raw);
    const protocols = { postgres: ["postgres:", "postgresql:"], mysql: ["mysql:"], mssql: ["mssql:", "sqlserver:"] };
    if (!protocols[kind].includes(url.protocol)) throw new Error("O protocolo da string não corresponde ao tipo de banco selecionado.");
    if (url.hash) throw invalid();
    // TLS is always enforced by the server. Accept common Supabase SSL hints,
    // but never accept credentials/options hidden in query parameters.
    for (const [key, option] of url.searchParams) {
      if (key !== "sslmode" || !["require", "verify-ca", "verify-full"].includes(option) || kind !== "postgres") {
        throw new Error("Parâmetro da string não suportado. Remova as opções extras; TLS com validação de certificado permanece obrigatório.");
      }
    }
    const host = url.hostname.toLowerCase();
    const port = Number(url.port || (kind === "postgres" ? 5432 : kind === "mysql" ? 3306 : 1433));
    const database = decodeURIComponent(url.pathname.slice(1));
    const username = decodeURIComponent(url.username);
    let password = decodeURIComponent(url.password);
    if (!/^[a-z0-9][a-z0-9.-]*$/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535 || !database || database.includes("/") || !username) throw invalid();
    if ([database, username, password].some(v => v.length > 512 || /[\x00-\x1f]/.test(v))) throw invalid();
    if (/^\[YOUR[-_]PASSWORD\]$/i.test(password)) password = "";
    return { kind, host, port, database, username, password };
  } catch (error) {
    if (error instanceof Error && /^(String inválida|O protocolo|Parâmetro da string)/.test(error.message)) throw error;
    // URL parser exceptions may contain the whole URI, including its password.
    throw invalid();
  }
}
