// Run: node --env-file=.env.local scripts/setup-emeka.cjs
const { Client } = require('pg');
const { readFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { X509Certificate } = require('node:crypto');
async function main() {
  const connectionString = process.env.EMEKA_DATABASE_URL;
  if (!connectionString) throw new Error('Defina EMEKA_DATABASE_URL com a conexão PostgreSQL do NOVO projeto Supabase.');
  const url = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('Use uma conexão PostgreSQL.');
  // Prevent connection-string options from overriding certificate validation.
  for (const name of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert']) url.searchParams.delete(name);
  const caPath = process.env.EMEKA_DATABASE_CA_FILE;
  const ca = caPath ? readFileSync(resolve(caPath), 'utf8') : undefined;
  if (ca) {
    const certificate = new X509Certificate(ca);
    if (!certificate.ca || Date.parse(certificate.validTo) < Date.now()) throw new Error('Certificado CA inválido ou expirado.');
  }
  const client = new Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: true, ...(ca ? { ca } : {}) }, connectionTimeoutMillis: 15000, query_timeout: 20000 });
  try {
    await client.connect();
    if (process.argv.includes('--check')) {
      console.log('PostgreSQL conectado; certificado TLS e credenciais válidos.');
      const { rows } = await client.query("select to_regclass('public.emeka_audits') is not null as auditorias, to_regclass('public.eksteel_cad_current') is not null as pecas, to_regclass('public.eksteel_cad_documents') is not null as documentos, to_regclass('public.eksteel_materials') is not null as materiais");
      console.log(JSON.stringify(rows[0]));
      return;
    }
    await client.query(readFileSync(join(__dirname, '../database/emeka/001_audits.sql'), 'utf8'));
    console.log('Tabelas e políticas de acesso da emeka_system criadas.');
  } finally { await client.end(); }
}
main().catch(error => {
  if (error.code) console.error('Código de diagnóstico: ' + String(error.code).replace(/[^A-Z0-9_]/gi, ''));
  console.error(error.code === '42P07' ? 'A estrutura já existe. Nenhum dado foi substituído.' : 'Não foi possível preparar o banco. Verifique EMEKA_DATABASE_URL, conexão TLS e permissões.');
  process.exitCode = 1;
});
