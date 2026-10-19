/** Maintainer-only publication. Never bundle this administrative key in the site. */
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');
const { loadEnvConfig } = require('@next/env');

async function main() {
  loadEnvConfig(process.cwd());
  const [system, version, filename] = process.argv.slice(2);
  if (!['linux', 'windows'].includes(system) || !/^[0-9][0-9A-Za-z.+~-]*$/.test(version || '') || !filename)
    throw new Error('Uso: npm run fea:publish -- linux|windows VERSAO ARQUIVO');
  const extension = system === 'linux' ? '.deb' : '.exe';
  const name = path.basename(filename);
  if (!/^[A-Za-z0-9_.-]+$/.test(name) || !name.endsWith(extension)) throw new Error('Instalador inválido para o sistema informado.');
  let config = {};
  try { config = JSON.parse(await fs.readFile(path.join(process.env.EMEKA_CONFIG_DIR || '.emeka-config', 'auth.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('Configuração local inválida.'); }
  const url = process.env.EMEKA_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || config.url;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Configure o Supabase e SUPABASE_SERVICE_ROLE_KEY no ambiente privado de publicação. Não envie a chave ao Git ou ao navegador.');
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash)
    throw new Error('O storage de publicação exige uma URL HTTPS válida.');
  const data = await fs.readFile(filename);
  if (system === 'linux' ? data.subarray(0, 8).toString() !== '!<arch>\n' : data.subarray(0, 2).toString() !== 'MZ')
    throw new Error('O conteúdo não corresponde ao formato do instalador.');
  const sha256 = crypto.createHash('sha256').update(data).digest('hex');
  const requiredMiB = Math.ceil(data.length / (1024 * 1024));
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const bucket = 'fea-releases';
  const { data: buckets, error: listing } = await client.storage.listBuckets();
  if (listing) throw new Error('Não foi possível consultar os buckets. Confira a credencial administrativa.');
  const existing = buckets.find(item => item.name === bucket);
  if (existing && !existing.public) throw new Error('O bucket fea-releases existente é privado; nenhuma permissão foi alterada.');
  if (!existing) {
    const { error } = await client.storage.createBucket(bucket, { public: true, fileSizeLimit: requiredMiB * 1024 * 1024 });
    if (error) {
      if (String(error.statusCode) === '413') throw new Error(`O Supabase recusou o limite de ${requiredMiB} MiB necessário para este instalador. Aumente o limite de upload do projeto para pelo menos ${requiredMiB} MiB. Nenhuma versão foi publicada.`);
      throw new Error('Não foi possível criar fea-releases. Confira permissões e limites do plano.');
    }
  }
  const storage = client.storage.from(bucket);
  const object = `${system}/${version}/${name}`;
  // Immutable releases: never overwrite a binary already offered to users.
  const { error: upload } = await storage.upload(object, data, { contentType: 'application/octet-stream', cacheControl: '31536000', upsert: false });
  if (upload) {
    if (String(upload.statusCode) === '413') throw new Error(`O instalador excede o limite de upload do projeto ou do bucket fea-releases. Configure ambos para pelo menos ${requiredMiB} MiB. A versão ativa não foi alterada.`);
    throw new Error('Falha ao enviar instalador. Confira limite de tamanho do Storage e se essa versão já existe.');
  }
  const publicUrl = storage.getPublicUrl(object).data.publicUrl;
  const response = await fetch(publicUrl, { signal: AbortSignal.timeout(180000) });
  if (!response.ok || !response.body) throw new Error('Falha ao verificar download público; versão ativa não alterada.');
  const hash = crypto.createHash('sha256');
  let size = 0;
  for await (const chunk of response.body) { hash.update(chunk); size += chunk.length; }
  if (size !== data.length || hash.digest('hex') !== sha256) throw new Error('Checksum público divergente; versão ativa não alterada.');
  const manifest = { platform: system, version, path: object, size, sha256, publishedAt: new Date().toISOString() };
  const { error: promotion } = await storage.upload(`${system}/latest.json`, JSON.stringify(manifest),
    { contentType: 'application/json', cacheControl: '0', upsert: true });
  if (promotion) throw new Error('Instalador enviado e verificado, mas não foi possível atualizar a versão ativa.');
  console.log(`Publicado e verificado: ${publicUrl}\nSHA-256: ${sha256}`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
