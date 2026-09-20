import { destinationCa } from "./destinations";
import type { DatabaseCredentials } from "../databaseConfig";
export type DatabaseRow = Record<string, unknown>;
export interface DatabaseDriver {
  query(sql: string, values: string[]): Promise<DatabaseRow[]>;
  close(): Promise<void>;
}
/** Only internally authored statements use '?' placeholders. User values are always bound. */
export async function openDatabase(config: DatabaseCredentials): Promise<DatabaseDriver> {
  const ca = await destinationCa(config.host, config.port) || process.env.CAD_DATABASE_CA_PEM || undefined;
  if (config.kind === "postgres") {
    const { Client } = await import("pg");
    const client = new Client({ host: config.host, port: config.port, database: config.database,
      user: config.username, password: config.password, ssl: { rejectUnauthorized: true, ca },
      connectionTimeoutMillis: 10000, statement_timeout: 15000, query_timeout: 20000 });
    // Socket errors between requests must not become uncaught process errors.
    client.on("error", () => undefined);
    try { await client.connect(); } catch (error) { await client.end().catch(() => undefined); throw error; }
    return { async query(sql, values) { let i = 0; const result = await client.query(sql.replace(/\?/g, () => `$${++i}`), values); return result.command === "UPDATE" || result.command === "INSERT" ? [{ affected: result.rowCount ?? 0 }] : result.rows; }, close: () => client.end() };
  }
  if (config.kind === "mysql") {
    const { createConnection } = await import("mysql2/promise");
    const client = await createConnection({ host: config.host, port: config.port, database: config.database,
      user: config.username, password: config.password, ssl: { rejectUnauthorized: true, ca },
      connectTimeout: 10000, multipleStatements: false, charset: "utf8mb4" });
    client.on("error", () => undefined);
    return { async query(sql, values) {
      const [rows] = await client.execute({ sql, timeout: 15000 }, values);
      return Array.isArray(rows) ? rows as DatabaseRow[] : [{ affected: "affectedRows" in rows ? rows.affectedRows : 0 }];
    }, close: () => client.end() };
  }
  const { default: mssql } = await import("mssql");
  const pool = new mssql.ConnectionPool({ server: config.host, port: config.port, database: config.database,
    user: config.username, password: config.password, connectionTimeout: 10000, requestTimeout: 15000,
    pool: { max: 1, min: 0, idleTimeoutMillis: 1000 },
    options: { encrypt: true, trustServerCertificate: false, cryptoCredentialsDetails: ca ? { ca } : undefined } });
  pool.on("error", () => undefined);
  try { await pool.connect(); } catch (error) { await pool.close().catch(() => undefined); throw error; }
  return { async query(sql, values) {
    const request = pool.request();
    values.forEach((value, i) => request.input(`p${i + 1}`, mssql.NVarChar(mssql.MAX), value));
    let i = 0;
    const result = await request.query(sql.replace(/\?/g, () => `@p${++i}`));
    return result.recordset ?? [{ affected: result.rowsAffected[0] ?? 0 }];
  }, close: () => pool.close() };
}
