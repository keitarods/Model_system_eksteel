"use client";

// Integração com a pasta local do projeto, via File System Access API —
// só Chrome/Edge (Chromium) suportam por enquanto; Firefox/Safari não têm
// showDirectoryPicker(). Em qualquer navegador sem suporte, as funções de
// salvar caem automaticamente pro download comum do navegador (ver
// saveOrDownload), então nada fica bloqueado, só perde a conveniência de
// gravar direto na pasta.
//
// A pasta escolhida fica guardada no IndexedDB entre sessões (o handle em
// si é serializável pela API do navegador) — assim não precisa escolher de
// novo toda vez, só reconfirmar a permissão.

const DB_NAME = "eksteel-modelador";
const STORE_NAME = "handles";
const FOLDER_KEY = "projectFolder";

export function isFileSystemAccessSupported(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    // Sem 2º argumento (versão) de propósito: abre a versão ATUAL do banco,
    // qualquer que seja — linkedFiles.ts (vínculo de peças de montagem)
    // também abre esse mesmo banco, numa versão mais nova, pra acrescentar
    // seu próprio object store. Fixar "1" aqui quebraria com um
    // `VersionError` assim que o banco já tivesse subido de versão por lá.
    const request = indexedDB.open(DB_NAME);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => {
      // Sem isso, uma conexão aberta aqui (ex.: ao montar o Modelador) fica
      // pendurada pra sempre — nunca chamamos db.close() depois de usar.
      // Se o usuário navegar (client-side, sem recarregar a página — ex.
      // clicando em "Abrir Montagem") pra outra tela que precise abrir o
      // MESMO banco numa versão mais nova (ver linkedFiles.ts), essa
      // conexão velha bloqueia a atualização de versão indefinidamente
      // (nem sucesso nem erro — só trava, sem aviso nenhum). onversionchange
      // é o evento padrão do IndexedDB pra avisar "alguém quer atualizar a
      // versão, feche se não estiver usando" — fechar aqui desbloqueia.
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
  });
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Abre o seletor de pasta do SO. Retorna null se o usuário cancelar.
export async function pickProjectFolder(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const handle = await window.showDirectoryPicker({ id: "eksteel-projeto", mode: "readwrite" });
    await idbSet(FOLDER_KEY, handle);
    return handle;
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return null;
    throw err;
  }
}

// Recupera a pasta lembrada de uma sessão anterior (sem re-perguntar ao
// usuário) — a permissão de leitura/escrita ainda pode precisar ser
// reconfirmada via ensureWritePermission antes de gravar algo nela.
export async function loadRememberedFolder(): Promise<FileSystemDirectoryHandle | null> {
  if (!isFileSystemAccessSupported()) return null;
  const handle = await idbGet<FileSystemDirectoryHandle>(FOLDER_KEY);
  return handle ?? null;
}

export async function forgetProjectFolder(): Promise<void> {
  await idbSet(FOLDER_KEY, undefined);
}

// Navegadores exigem reconfirmar a permissão de escrita a cada sessão nova
// (o grant não sobrevive a um reload), então isso precisa ser chamado antes
// de qualquer escrita — silencioso se já estava concedida.
export async function ensureWritePermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const opts: FileSystemHandlePermissionDescriptor = { mode: "readwrite" };
  if ((await handle.queryPermission(opts)) === "granted") return true;
  return (await handle.requestPermission(opts)) === "granted";
}

export async function writeFileToFolder(
  handle: FileSystemDirectoryHandle,
  filename: string,
  content: Blob | string
): Promise<void> {
  const fileHandle = await handle.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
}

// Dispara o download comum do navegador (funciona em qualquer browser,
// inclusive sem File System Access) — usado como fallback e também pra
// STEP/DXF quando nenhuma pasta foi escolhida.
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Ponto único usado por todo salvamento/exportação: grava na pasta do
// projeto se houver uma com permissão concedida, senão baixa normalmente.
export async function saveOrDownload(
  folder: FileSystemDirectoryHandle | null,
  content: Blob | string,
  filename: string
): Promise<"folder" | "download"> {
  if (folder && (await ensureWritePermission(folder))) {
    await writeFileToFolder(folder, filename, content);
    return "folder";
  }
  const blob = content instanceof Blob ? content : new Blob([content], { type: "text/plain" });
  downloadBlob(blob, filename);
  return "download";
}

// Abre um arquivo pra leitura — prefere o seletor nativo (mesma pasta do
// projeto fica sugerida), com fallback pra um <input type="file"> comum
// em navegadores sem File System Access (Firefox/Safari). Quando o seletor
// nativo está disponível, devolve também o FileSystemFileHandle: quem
// chama pode guardá-lo pra depois salvar direto nesse mesmo arquivo (ver
// writeToFileHandle), sem precisar perguntar onde salvar de novo a cada
// alteração — no fallback (handle null) isso não é possível, só download.
export async function pickFileToOpen(
  accept: FilePickerAcceptType[]
): Promise<{ file: File; handle: FileSystemFileHandle | null } | null> {
  if (isFileSystemAccessSupported()) {
    try {
      const [handle] = await window.showOpenFilePicker({ multiple: false, types: accept });
      return { file: await handle.getFile(), handle };
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return null;
      throw err;
    }
  }

  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = Object.values(accept[0]?.accept ?? {}).flat().join(",");
    input.onchange = () => {
      const file = input.files?.[0];
      resolve(file ? { file, handle: null } : null);
    };
    input.click();
  });
}

// Pede ao usuário onde salvar um arquivo novo (nome e pasta) — só a
// primeira vez que um projeto ainda sem arquivo aberto é salvo. O handle
// devolvido pode ser reusado depois em writeToFileHandle pra ir salvando
// no mesmo arquivo, sem abrir esse diálogo de novo.
export async function pickSaveFileHandle(
  suggestedName: string,
  types: FilePickerAcceptType[]
): Promise<FileSystemFileHandle | null> {
  try {
    return await window.showSaveFilePicker({ suggestedName, types });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return null;
    throw err;
  }
}

// showOpenFilePicker() só concede permissão de LEITURA por padrão — abrir
// um projeto existente e tentar salvar nele direto falhava sempre (sem
// aviso nenhum: a exceção só cai no catch de quem chama, que então volta
// pro fluxo de "Salvar Como"). showSaveFilePicker() já concede leitura+
// escrita, então isso normalmente é no-op nesse caso.
async function ensureFileWritePermission(handle: FileSystemFileHandle): Promise<boolean> {
  const opts: FileSystemHandlePermissionDescriptor = { mode: "readwrite" };
  if ((await handle.queryPermission(opts)) === "granted") return true;
  return (await handle.requestPermission(opts)) === "granted";
}

export async function writeToFileHandle(
  handle: FileSystemFileHandle,
  content: Blob | string
): Promise<void> {
  if (!(await ensureFileWritePermission(handle))) {
    throw new Error(`Permissão de escrita negada para "${handle.name}".`);
  }
  const writable = await handle.createWritable();
  await writable.write(content);
  await writable.close();
}
