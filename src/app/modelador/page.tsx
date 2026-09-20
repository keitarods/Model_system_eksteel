import { installation } from "@/lib/supabase/installation";
import { createClient } from "@/lib/supabase/server";
import { ModeladorClient } from "@/components/modelador/ModeladorClient";

// A proteção de verdade (redirecionar quem não está logado pra /login) é
// do middleware.ts — aqui só lê o usuário pra mostrar o e-mail no topo. Sem
// Supabase configurado (.env.local vazio, ex. dev local antes de preencher
// as credenciais do Eksteel-site), o middleware não bloqueia nada, então
// aqui também não chama o Supabase — evita quebrar com URL/chave vazias.
export default async function ModeladorPage() {
  if (!(await installation())) {
    return <ModeladorClient userEmail="" />;
  }

  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();

  return <ModeladorClient userEmail={data.user?.email ?? ""} />;
}
