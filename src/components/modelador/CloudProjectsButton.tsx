"use client";
import { HeaderIcon } from "@/components/icons/HeaderIcon";

import { loadRememberedCloud, rememberCloud, forgetCloud } from "@/lib/project/rememberedCloud";
import { CloudDocumentsPanel } from "./CloudDocumentsPanel";
import { useEffect, useRef, useState } from "react";
import { useInstallation } from "@/lib/supabase/InstallationProvider";
import { ConnectionStringInput } from "./ConnectionStringInput";
import { createPortal } from "react-dom";
import { connectCustomerDatabase } from "@/lib/project/databaseConnection";
import type { DatabaseKind } from "@/lib/project/databaseConfig";
import { connectCustomerSupabase } from "@/lib/project/supabaseConnection";
import type { CloudSession } from "@/lib/project/cloudProvider";
import { cloudName, type CloudConnection } from "@/lib/project/cloudStorage";

type Props = {
  compact?: boolean;
  getProject: () => string | Promise<string>;
  documentKind?: "part" | "assembly" | "drawing";
  generateDocument?: (kind: "pdf" | "dxf") => Promise<{ filename: string; body: Blob }>;
  onOpen: (json: string, name: string) => void;
  suggestedName: string;
  disabled?: boolean;
  documentEpoch?: number;
};

export function CloudProjectsButton({ getProject, onOpen, suggestedName, disabled, documentEpoch, documentKind = "part", generateDocument, compact = false }: Props) {
  const authConfig = useInstallation();
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [connection, setConnection] = useState<CloudConnection | null>(null);
  const [providerKind, setProviderKind] = useState<"supabase" | DatabaseKind>("supabase");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("5432");
  const [database, setDatabase] = useState("");
  const [username, setUsername] = useState("");
  const [url, setUrl] = useState("");
  const [publicKey, setPublicKey] = useState("");
  const [rememberPublic, setRememberPublic] = useState(false);
  const [preferenceMessage, setPreferenceMessage] = useState("");
  useEffect(() => {
    try {
      const saved = loadRememberedCloud(window.localStorage);
      if (saved) { setUrl(saved.url); setPublicKey(saved.key); setRememberPublic(true); }
    } catch { /* Browser storage may be disabled; manual connection still works. */ }
  }, []);
  function savePublicPreference() {
    try {
      rememberCloud(window.localStorage, url, publicKey);
      setPreferenceMessage("URL e chave pública lembradas neste navegador. A senha não foi salva.");
    } catch (error) {
      setPreferenceMessage(error instanceof Error && /^(Informe|Use)/.test(error.message)
        ? error.message : "O navegador não permitiu salvar a preferência. Você ainda pode conectar manualmente.");
    }
  }
  function clearPublicPreference() {
    try { forgetCloud(window.localStorage); setRememberPublic(false); setPreferenceMessage("Dados lembrados removidos. Os campos atuais continuam editáveis."); }
    catch { setPreferenceMessage("O navegador não permitiu remover os dados. Remova os dados deste site nas configurações do navegador."); }
  }
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const session = useRef<CloudSession | null>(null);
  useEffect(() => () => { void session.current?.disconnect().catch(() => undefined); }, []);
  const [folders, setFolders] = useState<string[]>([]);
  const [folder, setFolder] = useState("");
  const [newFolder, setNewFolder] = useState("");
  const [projects, setProjects] = useState<string[]>([]);
  const [project, setProject] = useState("");
  const [opened, setOpened] = useState<{ folder: string; project: string; token: string | null } | null>(null);
  useEffect(() => { setOpened(null); }, [documentEpoch]);
  const [versions, setVersions] = useState<string[]>([]);
  const dialog = useRef<HTMLDialogElement>(null);
  const locked = useRef(false);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (visible) dialog.current?.showModal(); }, [visible]);

  async function run(action: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setFailed(false);
    setMessage("");
    try { await action(); }
    catch (error) { setFailed(true); setMessage(error instanceof Error ? error.message : "Não foi possível acessar a nuvem."); }
    finally { locked.current = false; setBusy(false); }
  }
  function close() {
    if (locked.current) return;
    setVisible(false);
    setPassword("");
    trigger.current?.focus();
  }
  async function refreshProjects(api: CloudConnection, selected: string) {
    setProjects(await api.projects(selected));
    setVersions([]);
  }
  function openDialog() {
    setVisible(true);
    setMessage("");
    if (!connection) setProject(suggestedName.replace(/\.eks3d(?:asm)?$/i, ""));
  }
  async function connect() {
    let next: CloudSession | null = null;
    try {
      next = providerKind === "supabase"
        ? await connectCustomerSupabase(url, publicKey, email, password)
        : await connectCustomerDatabase({ kind: providerKind, host, port: Number(port), database, username, password });
      const api = next.provider;
      const names = await api.folders();
      const selected = names[0] ?? "";
      const items = selected ? await api.projects(selected) : [];
      session.current = next;
      if (providerKind === "supabase" && rememberPublic) savePublicPreference();
      setOpened(null); setConnection(api); setFolders(names); setFolder(selected); setProjects(items); setVersions([]);
      setMessage("Conexão OK: autenticação e consulta ao armazenamento concluídas. A permissão de gravação será verificada ao criar uma pasta ou salvar uma peça.");
    } catch (error) {
      await next?.disconnect().catch(() => undefined);
      throw error;
    } finally { setPassword(""); }
  }
  const fieldClass = "w-full rounded border border-chrome-border bg-chrome-surface-alt p-2 text-sm";
  const buttonClass = "rounded border border-chrome-border px-3 py-2 text-sm hover:bg-chrome-surface-alt disabled:opacity-40";
  return <>
    <button ref={trigger} type="button" disabled={disabled} onClick={openDialog}
      className="rounded-lg px-2 py-1.5 text-xs text-chrome-text-muted hover:bg-chrome-surface-alt disabled:opacity-40"
      title="Conectar o banco do cliente e salvar versões de peças">{compact ? <><HeaderIcon kind="cloud" /><span className="sr-only">Projetos na nuvem</span></> : "Projetos na nuvem"}</button>
    {visible && createPortal(<dialog ref={dialog} aria-labelledby="cloud-project-title"
      onCancel={event => { event.preventDefault(); close(); }} onKeyDown={event => event.stopPropagation()}
      className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[min(36rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-chrome-border bg-chrome-surface p-5 text-chrome-text shadow-2xl backdrop:bg-black/50">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 id="cloud-project-title" className="text-lg font-semibold">Projetos na nuvem</h2>
        <button type="button" className={buttonClass} disabled={busy} onClick={close}>Fechar</button>
      </div>
      <div className="mb-3 text-sm">
        <span className={connection ? "font-semibold text-emerald-600" : "text-chrome-text-muted"}>
          {connection ? "● Conectado nesta aba" : "○ Não conectado"}
        </span>
        {(busy || message) && <p role={failed ? "alert" : "status"} aria-live={failed ? "assertive" : "polite"}
          className={`mt-2 rounded border p-3 ${failed ? "border-red-500 text-red-600" : "border-chrome-border"}`}>
          {busy ? "Acessando o armazenamento…" : `${failed ? "Erro: " : ""}${message}`}
        </p>}
      </div>
      <p className="mb-4 text-sm text-chrome-text-muted">Pastas privadas da sua conta. Salvar atualiza a peça aberta; Criar revisão guarda uma cópia separada. Salvar e Ctrl+S na área de trabalho continuam salvando localmente.</p>
      {!connection ? <form className="mb-5 space-y-3" onSubmit={event => { event.preventDefault(); void run(connect); }}>
        <p className="text-sm">Escolha seu armazenamento e informe as credenciais. O banco deve estar preparado pelo administrador.</p>
        <fieldset disabled={busy} className="space-y-3">
          <label className="block text-sm">Tipo de conexão<select className={fieldClass} value={providerKind} onChange={e => {
            const kind = e.target.value as "supabase" | DatabaseKind;
            setProviderKind(kind); setPassword(""); setPort(kind === "mysql" ? "3306" : kind === "mssql" ? "1433" : "5432");
          }}><option value="supabase">Supabase Storage</option><option value="postgres">PostgreSQL</option><option value="mysql">MySQL</option><option value="mssql">SQL Server</option></select></label>
          {providerKind === "supabase" ? <>
          <label className="block text-sm">URL do Supabase<input type="url" required className={fieldClass} placeholder="https://seu-projeto.supabase.co" value={url} onChange={e => setUrl(e.target.value)} /></label>
          <label className="block text-sm">Chave pública (anon/publishable)<input required type="password" autoComplete="off" className={fieldClass} value={publicKey} onChange={e => setPublicKey(e.target.value)} /></label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={rememberPublic} onChange={e => {
            if (e.target.checked) { setRememberPublic(true); setPreferenceMessage("A URL e a chave serão lembradas ao conectar, ou pelo botão Salvar preferência."); }
            else clearPublicPreference();
          }} />Lembrar URL e chave pública neste navegador</label>
          {rememberPublic && <div className="flex gap-2">
            <button type="button" className={buttonClass} onClick={savePublicPreference}>Salvar preferência</button>
            <button type="button" className={buttonClass} onClick={clearPublicPreference}>Esquecer dados salvos</button>
          </div>}
          {preferenceMessage && <p role="status" className="text-xs text-chrome-text-muted">{preferenceMessage}</p>}
          <label className="block text-sm">E-mail no Supabase do cliente<input required type="email" autoComplete="off" className={fieldClass} value={email} onChange={e => setEmail(e.target.value)} /></label>
          </> : <>
            <ConnectionStringInput key={providerKind} kind={providerKind} disabled={busy} onApply={c => {
              setHost(c.host); setPort(String(c.port)); setDatabase(c.database); setUsername(c.username); setPassword(c.password);
            }} />
            <label className="block text-sm">Host<input required className={fieldClass} value={host} onChange={e => setHost(e.target.value)} placeholder="banco.empresa.com" /></label>
            <label className="block text-sm">Porta<input required type="number" min="1" max="65535" className={fieldClass} value={port} onChange={e => setPort(e.target.value)} /></label>
            <label className="block text-sm">Banco de dados<input required className={fieldClass} value={database} onChange={e => setDatabase(e.target.value)} /></label>
            <label className="block text-sm">Usuário do banco<input required autoComplete="off" className={fieldClass} value={username} onChange={e => setUsername(e.target.value)} /></label>
          </>}
          <label className="block text-sm">Senha desse usuário<input required type="password" autoComplete="off" className={fieldClass} value={password} onChange={e => setPassword(e.target.value)} /></label>
          <p className="text-xs text-chrome-text-muted">{providerKind === "supabase"
            ? "A senha será enviada por HTTPS ao Supabase informado. Confira esse endereço. Não informe senha do PostgreSQL nem service_role."
            : "A senha será enviada ao servidor do software para conectar ao banco via TLS. Não é salva no navegador ou em disco; a sessão expira em uma hora. O destino deve ser liberado pelo administrador."}</p>
          {providerKind !== "supabase" && !authConfig && <p role="status" className="text-sm">O administrador precisa configurar o login da instalação antes de habilitar bancos SQL externos. Supabase Storage usa a conexão informada acima.</p>}
          <button type="submit" disabled={providerKind !== "supabase" && !authConfig} className={buttonClass}>Conectar</button>
        </fieldset>
      </form> : <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <span className="break-all">Conectado: {providerKind === "supabase" ? url : `${providerKind}://${host}:${port}/${database}`}</span>
        <button type="button" className={buttonClass} disabled={busy} onClick={() => void run(async () => {
          const current = session.current; session.current = null;
          setOpened(null); setConnection(null); setFolders([]); setFolder(""); setProjects([]); setVersions([]); setPassword(""); if (!rememberPublic) setPublicKey("");
          await current?.disconnect();
        })}>Desconectar / trocar banco</button>
      </div>}
      {connection && <fieldset disabled={busy} className="space-y-4 disabled:opacity-60">
        <label className="block text-sm">Pasta
          <select className={fieldClass} value={folder} onChange={event => {
            const selected = event.target.value; setFolder(selected); setVersions([]);
            if (connection) void run(() => refreshProjects(connection, selected));
          }}><option value="" disabled>Crie ou selecione uma pasta</option>{folders.map(name => <option key={name}>{name}</option>)}</select>
        </label>
        <div className="flex items-end gap-2">
          <label className="min-w-0 flex-1 text-sm">Nova pasta<input className={fieldClass} maxLength={80} value={newFolder} onChange={e => setNewFolder(e.target.value)} /></label>
          <button type="button" className={buttonClass} disabled={!newFolder.trim()} onClick={() => void run(async () => {
            const name = cloudName(newFolder); await connection!.createFolder(name);
            setFolders(await connection!.folders()); setFolder(name); setNewFolder("");
            await refreshProjects(connection!, name); setMessage("Pasta criada.");
          })}>Criar pasta</button>
        </div>
        {documentKind === "part" && <label className="block text-sm">Peça existente
          <select className={fieldClass} value={projects.includes(project) ? project : ""} onChange={e => { setProject(e.target.value); setVersions([]); }}>
            <option value="">Nova peça ou nome abaixo</option>{projects.map(name => <option key={name}>{name}</option>)}
          </select>
        </label>
        }
        <label className="block text-sm">Nome da peça ou montagem<input className={fieldClass} maxLength={80} value={project} onChange={e => { setProject(e.target.value); setVersions([]); }} /></label>
        {documentKind === "part" && <>
        <p className="text-xs text-chrome-text-muted">Para uma peça nova, informe o nome e use Salvar como. Para atualizar uma existente, abra a peça atual ou uma revisão.</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={buttonClass} disabled={!opened || opened.folder !== folder || opened.project !== project} onClick={() => void run(async () => {
            if (!opened) return;
            const token = await connection!.saveCurrent(folder, project, await getProject(), opened.token);
            setOpened({ folder, project, token }); setMessage("Peça atualizada. Nenhuma revisão adicional foi criada.");
          })}>Salvar</button>
          <button type="button" className={buttonClass} disabled={!folder || !project.trim()} onClick={() => void run(async () => {
            const name = cloudName(project);
            if ((await connection!.projects(folder)).includes(name)) throw new Error("Esse nome já existe. Para atualizar, abra a peça; para Salvar como, informe outro nome.");
            const token = await connection!.saveCurrent(folder, name, await getProject(), null);
            setProject(name); setOpened({ folder, project: name, token });
            setMessage("Nova peça salva. Os próximos salvamentos atualizarão esta peça.");
            setProjects(await connection!.projects(folder)); setVersions([]);
          })}>Salvar como</button>
          <button type="button" className={buttonClass} disabled={!opened || opened.folder !== folder || opened.project !== project} onClick={() => void run(async () => {
            await connection!.save(folder, project, await getProject());
            setMessage("Revisão criada com o conteúdo da área de trabalho. A peça atual no banco não foi alterada.");
            setVersions(await connection!.versions(folder, project));
          })}>Criar revisão</button>
          <button type="button" className={buttonClass} disabled={!folder || !project.trim()} onClick={() => void run(async () => {
            const current = await connection!.current(folder, project);
            if (!current) throw new Error("Esta peça ainda não tem um registro atual. Abra uma revisão existente e clique em Salvar, ou crie outra peça com Salvar como.");
            if (!window.confirm("Abrir a peça atual? Alterações não salvas na área de trabalho serão substituídas.")) return;
            onOpen(current.json, `${project}.eks3d`);
            setOpened({ folder, project, token: current.token }); setMessage("Peça aberta. Salvar atualizará este registro.");
          })}>Abrir peça atual</button>
          <button type="button" className={buttonClass} disabled={!folder || !project.trim()} onClick={() => void run(async () => {
            const items = await connection!.versions(folder, project); setVersions(items);
            if (!items.length) setMessage("Nenhuma versão salva para esta peça.");
          })}>Listar versões</button>
        </div>
        {versions.length > 0 && <ul className="max-h-60 space-y-2 overflow-auto" aria-label="Versões salvas">
          {versions.map((version, index) => <li key={version} className="flex items-center justify-between gap-2 text-sm">
            <span>{version.slice(0, 10)} {version.slice(11, 19).replaceAll("-", ":")} UTC {index === 0 ? "(mais recente por data do dispositivo)" : ""}</span>
            <button type="button" className={buttonClass} onClick={() => void run(async () => {
              const json = await connection!.open(folder, project, version);
              const current = await connection!.current(folder, project);
              if (!window.confirm("Abrir esta versão? Alterações não salvas da peça atual serão substituídas.")) return;
              onOpen(json, `${project}.eks3d`);
              setOpened({ folder, project, token: current?.token ?? null });
              setMessage("Revisão aberta. Salvar usará este conteúdo para atualizar a peça atual; a revisão permanece preservada.");
            })}>Abrir</button>
          </li>)}
        </ul>}
        </>}
        {connection.documents ? <CloudDocumentsPanel key={folder} library={connection.documents} folder={folder} source={project} busy={busy} run={run}
          getNative={getProject} generateDocument={generateDocument} nativeExtension={documentKind === "drawing" ? ".eksdesenho" : documentKind === "assembly" ? ".eks3dasm" : ".eks3d"}
          onOpenNative={(json,name)=>{onOpen(json,name);setOpened(null);}} />
          : <p className="text-xs">Biblioteca de PDF, DXF e montagens disponível no conector Supabase Storage.</p>}
      </fieldset>}

    </dialog>, document.body)}
  </>;
}
