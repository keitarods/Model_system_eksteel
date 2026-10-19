import Link from "next/link";
import { redirect } from "next/navigation";
import { AppBackground } from "@/components/auth/AppBackground";
import { EmekaBrand } from "@/components/auth/EmekaBrand";
import { AccountBadge } from "@/components/layout/WorkspaceChrome";
import { createClient } from "@/lib/supabase/server";
import { installation } from "@/lib/supabase/installation";

const tools = [
  {
    id: "01", name: "Modelador", category: "Projeto e fabricação", href: "/modelador",
    description: "Transforme ideias em peças. Modele sólidos, trabalhe com chapas e prepare seus desenhos para fabricação.",
    features: ["Modelagem 3D", "Chapas e planificação", "Desenhos técnicos"],
    action: "Abrir Modelador", color: "#ed7c26", icon: "part",
  },
  {
    id: "02", name: "Montagem", category: "Conjuntos mecânicos", href: "/montagem",
    description: "Dê forma ao conjunto. Organize componentes e defina as relações entre as peças do seu projeto.",
    features: ["Componentes vinculados", "Relações entre peças", "Projetos de conjuntos"],
    action: "Abrir Montagem", color: "#62b7e5", icon: "assembly",
  },
  {
    id: "03", name: "Simulação", category: "Análise de engenharia", href: "/simulacao",
    description: "Avalie o comportamento do projeto. Configure materiais, cargas e apoios para analisar seus resultados.",
    features: ["Análise estrutural", "Cargas e condições de apoio", "Visualização de resultados"],
    action: "Abrir Simulação", color: "#8bd4c5", icon: "simulation",
  },
];

function ToolIcon({ kind }: { kind: string }) {
  return <svg aria-hidden="true" width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
    {kind === "part" ? <><path d="m24 5 17 10v19L24 44 7 34V15L24 5Z" /><path d="m7 15 17 10 17-10M24 25v19M15 10l17 10" /></>
      : kind === "assembly" ? <><path d="m16 4 12 7v14l-12 7-12-7V11l12-7Zm0 14v14M4 11l12 7 12-7" /><path d="m28 18 16 9v12l-16 9-12-7V29m12 8v11m-12-19 12 8 16-10" /></>
      : <><path d="M6 9h36v30H6zM6 19h36M6 29h36M18 9v30M30 9v30M6 9l36 30M18 9l24 20M6 19l24 20" /><path d="m21 4 3 4 3-4m-6 40 3-4 3 4" /></>}
  </svg>;
}

export default async function ToolsPage() {
  if (!await installation()) redirect("/configurar");
  const client = await createClient();
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) redirect("/login");

  return <main className="relative isolate min-h-screen bg-[#101b24] text-white">
    <AppBackground />
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[#0b1721]/75" />
    <header className="relative z-10 border-b border-white/10 bg-[#0b1721]/65">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-5 py-4 sm:px-8">
        <Link href="/ferramentas" aria-label="Emeka Engenharia — ferramentas" className="rounded-lg bg-white px-5 py-2 focus-visible:outline-2 focus-visible:outline-orange-400"><EmekaBrand compact /></Link>
        <AccountBadge userEmail={user.email ?? "Minha conta"} />
      </div>
    </header>
    <div className="relative z-10 mx-auto max-w-7xl px-5 py-12 sm:px-8 sm:py-20">
      <div className="mb-10 max-w-2xl sm:mb-14">
        <p className="mb-4 text-xs font-semibold uppercase tracking-[0.22em] text-orange-300">Emeka Engenharia · Ferramentas profissionais</p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-5xl">Seu próximo projeto<br className="hidden sm:block" /> começa aqui.</h1>
        <p className="mt-5 max-w-lg text-base leading-7 text-slate-300">Escolha seu ambiente de trabalho. Da primeira peça à análise do conjunto, tudo em um só lugar.</p>
      </div>
      <section aria-label="Ferramentas de engenharia" className="grid gap-5 lg:grid-cols-3">
        {tools.map(tool => <article key={tool.id} className="group relative flex flex-col overflow-hidden rounded-2xl border border-white/15 bg-[#132634]/95 p-6 shadow-xl shadow-black/10 transition duration-200 hover:-translate-y-1 hover:border-white/30 sm:p-8">
          <div className="absolute inset-x-0 top-0 h-0.5" style={{ backgroundColor: tool.color }} />
          <div className="mb-8 flex items-start justify-between">
            <div className="flex h-20 w-20 items-center justify-center rounded-2xl border border-white/10 bg-white/5" style={{ color: tool.color }}><ToolIcon kind={tool.icon} /></div>
            <span className="font-mono text-sm text-slate-500">{tool.id}</span>
          </div>
          <p className="text-xs uppercase tracking-widest text-slate-400">{tool.category}</p>
          <h2 className="mt-2 text-2xl font-semibold">{tool.name}</h2>
          <p className="mt-4 min-h-24 text-sm leading-7 text-slate-300">{tool.description}</p>
          <ul className="mb-8 mt-6 space-y-3 border-t border-white/10 pt-6 text-sm text-slate-200">{tool.features.map(feature => <li key={feature} className="flex items-center gap-3"><span aria-hidden="true" className="h-1 w-1 rounded-full" style={{ backgroundColor: tool.color }} />{feature}</li>)}</ul>
          <Link href={tool.href} className="mt-auto flex items-center justify-between rounded-xl bg-white px-5 py-3.5 text-sm font-semibold text-[#132634] transition hover:bg-orange-100 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange-400">{tool.action}<span aria-hidden="true">↗</span></Link>
        </article>)}
      </section>
      <footer className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-6 text-xs text-slate-400">
        <span>Emeka Engenharia</span><span>Modelagem · Montagem · Simulação</span>
      </footer>
    </div>
  </main>;
}
