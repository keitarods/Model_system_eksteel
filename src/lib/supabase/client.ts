import { getBrowserConfig } from "./InstallationProvider";
import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  const config = getBrowserConfig();
  if (!config) throw new Error("Configure o acesso da emeka_system em /configurar.");
  return createBrowserClient(config.url, config.key);
}
