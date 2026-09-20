import { NextRequest, NextResponse } from 'next/server';
import { canConfigureInstallation } from '@/lib/supabase/setupAuthorization';
import { authorizeDestination } from '@/lib/project/server/destinations';
export const runtime = 'nodejs';
export async function POST(request: NextRequest) {
  const reply = (body: object, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
  if (request.headers.get('origin') !== new URL(request.url).origin) return reply({error:'Origem inválida.'},403);
  if (!canConfigureInstallation(request.url, request.headers.get('x-setup-token') || '')) return reply({error:'Informe o token administrativo da instalação. Em desenvolvimento local ele é dispensado.'},403);
  try {
    const reader = request.body?.getReader(); if (!reader) return reply({error:'Dados ausentes.'},400);
    const chunks: Uint8Array[]=[]; let size=0;
    try {
      while (true) { const part=await reader.read(); if(part.done) break; size+=part.value.length; if(size>98304) { await reader.cancel(); return reply({error:'Dados acima do limite.'},413); } chunks.push(part.value); }
    } finally { reader.releaseLock(); }
    const input=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    await authorizeDestination(input.host,input.port,input.caPem);
    return reply({ok:true});
  } catch (error) { if (error instanceof Error && error.message.startsWith('Certificado CA')) return reply({error:error.message},400); return reply({error:'Não foi possível autorizar. Confira host, porta e permissão de escrita da configuração no servidor.'},400); }
}
