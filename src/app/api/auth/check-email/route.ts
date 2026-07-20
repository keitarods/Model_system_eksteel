import { createClient } from "@supabase/supabase-js";

// Confere se um e-mail já tem conta ANTES de tentar o login (permite dar
// uma mensagem melhor que "senha incorreta" quando na verdade a conta nem
// existe) — precisa da service_role key porque listar usuários é uma
// operação admin, não algo que a chave anon pode fazer. Mesma rota do
// sistema de gestão, sem nenhuma mudança (lógica genérica, não depende do
// projeto Supabase específico).

type CheckEmailResponse = {
  exists: boolean | null;
  reason?: "missing_service_role" | "admin_lookup_failed";
};

const USERS_PER_PAGE = 1000;

function normalizarEmail(email: string) {
  return email.trim().toLowerCase();
}

async function usuarioExiste(email: string) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return {
      exists: null,
      reason: "missing_service_role" as const,
    };
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  let pagina = 1;

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page: pagina,
      perPage: USERS_PER_PAGE,
    });

    if (error) {
      return {
        exists: null,
        reason: "admin_lookup_failed" as const,
      };
    }

    const encontrouUsuario = data.users.some(
      (user) => normalizarEmail(user.email ?? "") === email
    );

    if (encontrouUsuario) {
      return { exists: true };
    }

    if (data.users.length < USERS_PER_PAGE) {
      return { exists: false };
    }

    pagina += 1;
  }
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host || !origin.includes(host)) {
    return Response.json({ exists: null }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as {
    email?: unknown;
  } | null;
  const email =
    typeof body?.email === "string" ? normalizarEmail(body.email) : "";

  if (!email) {
    return Response.json(
      { exists: false } satisfies CheckEmailResponse,
      { status: 400 }
    );
  }

  const resultado = await usuarioExiste(email);

  return Response.json(resultado satisfies CheckEmailResponse);
}
