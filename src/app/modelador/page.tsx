import { createClient } from "@/lib/supabase/server";
import { ModeladorWorkspace } from "@/components/modelador/ModeladorWorkspace";

// A proteção de verdade (redirecionar quem não está logado pra /login) é
// do middleware.ts — aqui só lê o usuário pra mostrar o e-mail no topo. Sem
// Supabase configurado (.env.local vazio, ex. dev local antes de preencher
// as credenciais do Eksteel-site), o middleware não bloqueia nada, então
// aqui também não chama o Supabase — evita quebrar com URL/chave vazias.
function temSupabaseConfig() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

export default async function ModeladorPage() {
  if (!temSupabaseConfig()) {
    return <ModeladorWorkspace userEmail="" />;
  }

  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();

  return <ModeladorWorkspace userEmail={data.user?.email ?? ""} />;
}
