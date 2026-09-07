import { createClient } from "@/lib/supabase/server";
import { AssemblyWorkspace } from "@/components/assembly/AssemblyWorkspace";

// Mesmo padrão de src/app/modelador/page.tsx: a proteção de verdade
// (redirecionar quem não está logado) é do middleware — aqui só lê o
// usuário pra mostrar o e-mail no topo.
function temSupabaseConfig() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

export default async function MontagemPage() {
  if (!temSupabaseConfig()) {
    return <AssemblyWorkspace userEmail="" />;
  }

  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();

  return <AssemblyWorkspace userEmail={data.user?.email ?? ""} />;
}
