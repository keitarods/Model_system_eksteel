import { createHash } from 'node:crypto';
import { installation } from '@/lib/supabase/installation';
import { createClient } from '@/lib/supabase/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function forward(request: Request) {
  const url = new URL(request.url);
  const reply = (error: string, status: number) => Response.json({ error }, { status });
  if (request.method !== 'GET' && request.headers.get('origin') !== url.origin) return reply('Origem inválida.', 403);
  let owner: string;
  if (await installation()) {
    const client = await createClient();
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) return reply('Entre na sua conta para usar a simulação.', 401);
    owner = data.user.id;
  } else if (process.env.NODE_ENV === 'development' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    owner = 'local-development';
  } else return reply('Configure a autenticação da instalação para usar o serviço de simulação.', 403);
  const service = process.env.FEA_SERVICE_URL;
  const token = process.env.FEA_API_TOKEN;
  if (!service || !token || token.length < 24) return reply('Serviço FEA não configurado. Configure FEA_SERVICE_URL e FEA_API_TOKEN no servidor.', 503);
  const id = url.searchParams.get('jobId');
  if (id && !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)) return reply('Trabalho inválido.', 400);
  if (request.method === 'DELETE' && !id) return reply('Informe o trabalho a cancelar.', 400);
  let body: Uint8Array | undefined;
  if (request.method === 'POST') {
    const reader = request.body?.getReader();
    if (!reader) return reply('Dados ausentes.', 400);
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength;
      if (size > 14_000_000) { await reader.cancel(); return reply('Geometria acima do limite de envio.', 413); }
      chunks.push(part.value);
    }
    body = Buffer.concat(chunks);
  }
  const path = request.method === 'POST' ? '/jobs' : id ? `/jobs/${id}${url.searchParams.has('result') ? '/result' : url.searchParams.has('input') ? '/input' : ''}` : '/health';
  try {
    const upstream = await fetch(`${service.replace(/\/$/, '')}${path}`, {
      method: request.method,
      headers: { 'Authorization': `Bearer ${token}`, 'X-FEA-Owner': createHash('sha256').update(owner).digest('hex'), 'Content-Type': 'application/json' },
      body: body as BodyInit | undefined, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(30000),
    });
    return new Response(upstream.body, { status: upstream.status, headers: { 'Content-Type': upstream.headers.get('content-type') ?? 'application/json', 'Cache-Control': 'no-store' } });
  } catch { return reply('O serviço de cálculo está temporariamente indisponível. Tente novamente em instantes. Se persistir, contate o administrador do site.', 502); }
}
export const GET = forward;
export const POST = forward;
export const DELETE = forward;
