import { installation } from "@/lib/supabase/installation";
import { createClient } from "@/lib/supabase/server";
import { SimulationWorkspace } from "@/components/simulation/SimulationWorkspace";

// Mesmo padrão de src/app/modelador/page.tsx e montagem/page.tsx: a proteção é do
// middleware; aqui só lê o usuário pra mostrar a conta no cabeçalho.
export default async function SimulationPage() {
  if (!(await installation())) return <SimulationWorkspace userEmail="" />;
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return <SimulationWorkspace userEmail={data.user?.email ?? ""} />;
}
