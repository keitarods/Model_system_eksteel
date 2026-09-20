import { mkdir, writeFile, readFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID, X509Certificate } from 'node:crypto';

export function destinationAddress(host: unknown, port: unknown) {
  if (typeof host !== 'string' || !/^[a-z0-9][a-z0-9.-]*$/i.test(host.trim()) || !Number.isInteger(port) || Number(port) < 1 || Number(port) > 65535) throw new Error('Host ou porta inválidos.');
  return `${host.trim().toLowerCase()}:${port}`;
}
function location(address: string) {
  return join(process.env.CAD_CONFIG_DIR || join(process.cwd(), '.cad-config'), 'destinations', createHash('sha256').update(address).digest('hex') + '.json');
}
export function validateDatabaseCa(value: unknown): string {
  if (typeof value !== 'string' || Buffer.byteLength(value) > 65536) throw new Error('Certificado CA inválido ou acima de 64 KiB.');
  const pem = value.trim();
  const blocks = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
  if (!blocks?.length || pem.replace(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g, '').trim()) throw new Error('Certificado CA inválido. Envie somente certificados públicos PEM, sem chave privada.');
  for (const block of blocks) {
    let cert: X509Certificate;
    try { cert = new X509Certificate(block); } catch { throw new Error('Certificado CA inválido. Use um arquivo PEM válido.'); }
    if (!cert.ca) throw new Error('Certificado CA inválido: o certificado precisa ser de uma autoridade certificadora.');
    if (Date.parse(cert.validFrom) > Date.now() || Date.parse(cert.validTo) < Date.now()) throw new Error('Certificado CA fora do período de validade. Baixe o certificado atualizado do provedor.');
  }
  return blocks.join('\n') + '\n';
}
export async function destinationCa(host: string, port: number): Promise<string | undefined> {
  const address = destinationAddress(host, port);
  try {
    const stored = JSON.parse(await readFile(location(address), 'utf8'));
    return stored.address === address && stored.caPem ? validateDatabaseCa(stored.caPem) : undefined;
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
}
export async function authorizeDestination(host: unknown, port: unknown, caPem?: unknown) {
  const address = destinationAddress(host, port);
  const ca = caPem === undefined ? undefined : validateDatabaseCa(caPem);
  const filename = location(address);
  await mkdir(join(filename, '..'), { recursive: true, mode: 0o700 });
  if (ca !== undefined) {
    // Administrative certificate replacement is atomic: readers see old or new,
    // never a half-written trust configuration. A plain reauthorization keeps it.
    const temporary = `${filename}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify({ address, caPem: ca }), { flag: 'wx', mode: 0o600 });
      await rename(temporary, filename);
    } finally { await unlink(temporary).catch(() => undefined); }
    return;
  }
  // One file per destination, exclusive create: concurrent registrations cannot
  // lose other entries and existing grants cannot be silently overwritten.
  try { await writeFile(filename, JSON.stringify({ address }), { flag: 'wx', mode: 0o600 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
}
export async function allowedDestinationsFor(value: unknown) {
  const env = process.env.CAD_DATABASE_ALLOWED_HOSTS || '';
  if (!value || typeof value !== 'object') return env;
  const input = value as { host?: unknown; port?: unknown };
  const address = destinationAddress(input.host, input.port);
  try {
    const stored = JSON.parse(await readFile(location(address), 'utf8'));
    return stored.address === address ? `${env},${address}` : env;
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return env; throw error; }
}
