import { readFile, mkdir, open } from "node:fs/promises";
import { join } from "node:path";
export type Installation = { url: string; key: string };
const directory = () => process.env.CAD_CONFIG_DIR || join(process.cwd(), '.cad-config');
export async function installation(): Promise<Installation | null> {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY };
  try { return JSON.parse(await readFile(join(directory(), 'auth.json'), 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}
export async function saveInstallation(config: Installation) {
  await mkdir(directory(), { recursive: true, mode: 0o700 });
  const file = await open(join(directory(), 'auth.json'), 'wx', 0o600);
  try { await file.writeFile(JSON.stringify(config)); } finally { await file.close(); }
}
