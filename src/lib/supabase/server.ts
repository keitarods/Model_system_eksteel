import { installation } from "./installation";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

const cookieDomain = process.env.NEXT_PUBLIC_COOKIE_DOMAIN || undefined;

export async function createClient() {
  const config = await installation();
  if (!config) throw new Error("Configure o acesso em /configurar.");
  const cookieStore = await cookies();

  return createServerClient(
    config.url,
    config.key,
    {
      ...(cookieDomain ? { cookieOptions: { domain: cookieDomain } } : {}),
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Server Components não conseguem sempre escrever cookies; o middleware cuida do refresh.
          }
        },
      },
    }
  );
}
