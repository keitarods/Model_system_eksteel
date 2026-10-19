export type CommunicatorDownloads = { windows: string | null; linux: string | null };

export const COMMUNICATOR_BUCKET = 'fea-releases';

/** A manifest can only point to a versioned installer in our release bucket. */
export function releaseDownload(base: string, system: 'windows' | 'linux', value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const release = value as Record<string, unknown>;
  if (release.platform !== system || typeof release.path !== 'string' ||
      typeof release.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(release.sha256) ||
      typeof release.size !== 'number' || release.size <= 0) return null;
  const extension = system === 'windows' ? 'exe' : 'deb';
  if (!new RegExp(`^${system}/[0-9][0-9A-Za-z.+~-]*/[A-Za-z0-9_.-]+\\.${extension}$`).test(release.path)) return null;
  return publicDownloadUrl(`${base}/storage/v1/object/public/${COMMUNICATOR_BUCKET}/${release.path}`);
}

/** Only explicitly configured public download links; never infer a release URL. */
export function publicDownloadUrl(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null;
    return url.href;
  } catch { return null; }
}

export function communicatorDownloads(env: Record<string, string | undefined>): CommunicatorDownloads {
  return {
    windows: publicDownloadUrl(env.FEA_COMMUNICATOR_WINDOWS_URL),
    linux: publicDownloadUrl(env.FEA_COMMUNICATOR_LINUX_URL),
  };
}
