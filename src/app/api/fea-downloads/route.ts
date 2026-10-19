import { COMMUNICATOR_BUCKET, communicatorDownloads, publicDownloadUrl, releaseDownload } from '@/lib/simulation/communicatorDownloads';
import { installation } from '@/lib/supabase/installation';

export const dynamic = 'force-dynamic';
export async function GET() {
  const downloads = communicatorDownloads(process.env);
  const config = await installation().catch(() => null);
  const base = publicDownloadUrl(config?.url)?.replace(/\/$/, '');
  if (base) await Promise.all((['windows', 'linux'] as const).map(async system => {
    if (downloads[system]) return; // Explicit external hosting remains supported.
    try {
      const response = await fetch(`${base}/storage/v1/object/public/${COMMUNICATOR_BUCKET}/${system}/latest.json`,
        { cache: 'no-store', signal: AbortSignal.timeout(5000) });
      if (response.ok) downloads[system] = releaseDownload(base, system, await response.json());
    } catch { /* A missing release must not break the simulation screen. */ }
  }));
  return Response.json(downloads, { headers: { 'Cache-Control': 'no-store' } });
}
