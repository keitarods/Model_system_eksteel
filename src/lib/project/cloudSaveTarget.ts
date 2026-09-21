import type { ProjectCloudProvider } from './cloudProvider';
export type CloudSaveTarget = { folder: string; project: string; token: string | null; documentEpoch?: number };
export function currentSaveTarget(target: CloudSaveTarget | null, epoch?: number): CloudSaveTarget | null {
  return target?.documentEpoch === epoch ? target : null;
}
/** Read a destination token without replacing the local document or refreshing an existing edit token. */
export async function selectSaveTarget(provider: ProjectCloudProvider, folder: string, project: string,
  existing: CloudSaveTarget | null, documentEpoch?: number): Promise<CloudSaveTarget | null> {
  if (!folder || !project) return null;
  const current = currentSaveTarget(existing, documentEpoch);
  if (current?.folder === folder && current.project === project) return current;
  const saved = await provider.current(folder, project);
  return { folder, project, token: saved?.token ?? null, documentEpoch };
}
