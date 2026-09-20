import { installation } from "@/lib/supabase/installation";
import { createClient } from "@/lib/supabase/server";
import { AssemblyWorkspace } from "@/components/assembly/AssemblyWorkspace";

// Mesmo padrão de src/app/modelador/page.tsx: a proteção de verdade
// (redirecionar quem não está logado) é do middleware — aqui só lê o
// usuário pra mostrar o e-mail no topo.
export default async function MontagemPage() {
  if (!(await installation())) {
    return <AssemblyWorkspace userEmail="" />;
  }

  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();

  return <AssemblyWorkspace userEmail={data.user?.email ?? ""} />;
}
