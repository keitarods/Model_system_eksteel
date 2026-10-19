import { authRedirect } from "@/lib/supabase/authRedirect";
import { installation } from "@/lib/supabase/installation";
import { type EmailOtpType } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = authRedirect(searchParams.get("next"), type);

  const redirectUrl = new URL(next, origin);

  const config = await installation();
  if (
    (code || (token_hash && type)) &&
    config
  ) {
    const response = NextResponse.redirect(redirectUrl);

    const supabase = createServerClient(
      config.url,
      config.key,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) => {
              response.cookies.set(name, value, options);
            });
          },
        },
      }
    );

    const { error } = await (code
      ? supabase.auth.exchangeCodeForSession(code)
      : supabase.auth.verifyOtp({ token_hash: token_hash!, type: type! })).catch(() => ({ error: true }));
    if (error) return NextResponse.redirect(new URL("/login?error=auth_callback", origin));

    return response;
  }

  return NextResponse.redirect(new URL("/login?error=auth_callback", origin));
}
