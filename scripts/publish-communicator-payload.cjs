/** Stage a validated Windows installer in small objects; does not promote latest.json. */
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');
require('@next/env').loadEnvConfig(process.cwd());
const sha = data => crypto.createHash('sha256').update(data).digest('hex');

async function main() {
  const [version, filename, destination] = process.argv.slice(2);
  if (!/^[0-9][0-9A-Za-z.+~-]*$/.test(version || '') || !filename || !destination)
    throw new Error('Uso: node scripts/publish-communicator-payload.cjs VERSAO INSTALADOR JSON_DE_SAIDA');
  const url = process.env.EMEKA_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || new URL(url).protocol !== 'https:') throw new Error('Configure o Storage HTTPS e a credencial administrativa.');
  const data = await fs.readFile(filename);
  if (data.subarray(0, 2).toString() !== 'MZ') throw new Error('Instalador Windows inválido.');
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const bucket = 'fea-releases';
  const { data: buckets, error } = await client.storage.listBuckets();
  if (error) throw new Error('Não foi possível consultar o Storage.');
  const existing = buckets.find(item => item.name === bucket);
  if (existing && !existing.public) throw new Error('O bucket de releases existente é privado.');
  if (!existing) {
    const { error } = await client.storage.createBucket(bucket, { public: true, fileSizeLimit: 50 * 1024 ** 2 });
    if (error) throw new Error('Não foi possível criar o bucket de releases.');
  }
  const storage = client.storage.from(bucket);
  const manifest = { filename: 'emekaengCommunicator-Setup.exe', size: data.length, sha256: sha(data), parts: [] };
  const chunkSize = 24 * 1024 ** 2;
  for (let offset = 0, index = 1; offset < data.length; offset += chunkSize, index++) {
    const part = data.subarray(offset, Math.min(offset + chunkSize, data.length));
    const object = `windows/${version}/payload/installer.part${String(index).padStart(2, '0')}`;
    const expected = sha(part);
    const { error } = await storage.upload(object, part, { contentType: 'application/octet-stream', cacheControl: '31536000', upsert: false });
    if (error && String(error.statusCode) !== '409') throw new Error(`Falha ao enviar parte ${index}: ${error.message}`);
    const publicUrl = storage.getPublicUrl(object).data.publicUrl;
    const response = await fetch(publicUrl, { signal: AbortSignal.timeout(180000) });
    if (!response.ok) throw new Error(`Falha ao verificar parte ${index}.`);
    const downloaded = Buffer.from(await response.arrayBuffer());
    if (downloaded.length !== part.length || sha(downloaded) !== expected) throw new Error(`Checksum divergente na parte ${index}.`);
    manifest.parts.push({ url: publicUrl, size: part.length, sha256: expected });
    console.log(`Parte ${index} enviada e verificada (${part.length} bytes).`);
  }
  await fs.writeFile(destination, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Payload completo verificado; descritor: ${path.resolve(destination)}. A versão ativa ainda não foi alterada.`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
