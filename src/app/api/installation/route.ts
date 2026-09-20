import { NextRequest, NextResponse } from 'next/server';
import { canConfigureInstallation } from '@/lib/supabase/setupAuthorization';
import { installation, saveInstallation } from '@/lib/supabase/installation';
import { validateSupabaseCredentials } from '@/lib/project/supabaseConnection';
export const runtime = 'nodejs';
export async function POST(request: NextRequest) {
  const reply = (error: string, status: number) => NextResponse.json({ error }, { status });
  if (request.headers.get('origin') !== new URL(request.url).origin) return reply('Origem inválida.',403);
  if (await installation()) return reply('Esta instalação já foi configurada. Alterações exigem o administrador do servidor.',409);
  if (!canConfigureInstallation(request.url, request.headers.get('x-setup-token') || '')) return reply('Informe o token administrativo da instalação. Em desenvolvimento local ele é dispensado.',403);
  try {
    const reader = request.body?.getReader(); if (!reader) return reply('Dados ausentes.',400);
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 16384) { await reader.cancel(); return reply('Dados acima do limite.',413); } chunks.push(part.value); }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (typeof body.url !== 'string' || typeof body.key !== 'string') return reply('Informe URL e chave pública.',400);
    const config = validateSupabaseCredentials(body.url,body.key);
    await saveInstallation(config);
    return NextResponse.json({ ok: true });
  } catch { return reply('Não foi possível salvar. Confira URL HTTPS, chave pública e permissão de escrita. A instalação pode já ter sido configurada por outra sessão.',400); }
}
