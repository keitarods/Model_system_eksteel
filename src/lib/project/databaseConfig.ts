export type DatabaseKind = "postgres" | "mysql" | "mssql";
export type DatabaseCredentials = { kind: DatabaseKind; host: string; port: number; database: string; username: string; password: string };
export function databaseCredentials(value: unknown, allowedHosts: string): DatabaseCredentials {
  if (!value || typeof value !== "object") throw new Error("Configuração inválida.");
  const v = value as Record<string, unknown>;
  if (!["postgres", "mysql", "mssql"].includes(String(v.kind))) throw new Error("Conector não suportado.");
  for (const key of ["host", "database", "username", "password"] as const) {
    if (typeof v[key] !== "string" || !v[key] || v[key].length > 512 || /[\x00-\x1f]/.test(v[key])) throw new Error(`Campo inválido: ${key}.`);
  }
  const host = String(v.host).toLowerCase();
  if (!/^[a-z0-9][a-z0-9.-]*$/.test(host) || !Number.isInteger(v.port) || Number(v.port) < 1 || Number(v.port) > 65535) throw new Error("Host ou porta inválidos.");
  const destination = `${host}:${v.port}`;
  if (!allowedHosts.split(",").map(s => s.trim().toLowerCase()).includes(destination)) {
    throw new Error("Destino não autorizado. Solicite ao administrador a liberação deste host e porta no servidor (CAD_DATABASE_ALLOWED_HOSTS).");
  }
  return { kind: v.kind as DatabaseKind, host, port: Number(v.port), database: String(v.database), username: String(v.username), password: String(v.password) };
}
