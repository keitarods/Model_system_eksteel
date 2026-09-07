"use client";

// Rascunho automático: guarda uma cópia serializada do documento atual
// (peça OU montagem) no IndexedDB a cada mudança (debounced), restaurada
// sozinha da próxima vez que a página abrir — sem isso, atualizar a página
// (ou fechar a aba sem "Salvar") perdia todo o trabalho, já que features/
// sketch/montagem só existem em memória (zustand).
//
// Mesmo banco "eksteel-modelador" que folder.ts (pasta do projeto) e
// linkedFiles.ts (peças vinculadas de uma montagem) já usam — cada um cria
// seu próprio object store, versão crescente, sem mexer nos dos outros (ver
// o mesmo raciocínio de onupgradeneeded/onversionchange em folder.ts).
//
// Guarda só o CONTEÚDO serializável do documento (mesmo JSON de
// serializeProject/serializeAssembly) — nunca o sólido/malha reconstruído
// (isso é sempre recalculado a partir das features, como já acontece ao
// abrir um arquivo normalmente). Guarda também o handle do ARQUIVO atual
// (se houver um aberto de verdade), pra "Salvar" continuar gravando no
// mesmo lugar depois do reload — só funciona se a permissão ainda estiver
// concedida sem precisar perguntar de novo (ver restoreCurrentFileHandle).

const DB_NAME = "eksteel-modelador";
const DRAFT_STORE = "autosaveDrafts";
const HANDLE_STORE = "handles";
// Nome literal (não importado de linkedFiles.ts) de propósito, mesma
// convenção que linkedFiles.ts já usa pra "handles" (dono: folder.ts): quem
// pede a versão mais alta do banco precisa criar TODOS os object stores já
// conhecidos, não só o seu — senão a ORDEM em que os módulos abrem o banco
// pela 1ª vez decide se um store "mais antigo" existe. Sem isso, se este
// módulo (v3) fosse o primeiro a criar o banco do zero, "linkedFileHandles"
// nunca seria criado, e linkedFiles.ts pedir depois a v2 (menor que a v3 já
// existente) dá VersionError pra sempre — quebrando o vínculo de peças.
const LINKED_FILE_HANDLE_STORE = "linkedFileHandles";
const DB_VERSION = 3;

export type DocKind = "modelador" | "montagem";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(HANDLE_STORE)) {
        db.createObjectStore(HANDLE_STORE);
      }
      if (!db.objectStoreNames.contains(LINKED_FILE_HANDLE_STORE)) {
        db.createObjectStore(LINKED_FILE_HANDLE_STORE);
      }
      if (!db.objectStoreNames.contains(DRAFT_STORE)) {
        db.createObjectStore(DRAFT_STORE);
      }
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => {
      console.warn(
        "IndexedDB (eksteel-modelador) bloqueado por outra aba/conexão aberta — recarregue a página se o rascunho automático não restaurar."
      );
    };
  });
}

async function idbGet<T>(store: string, key: string): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(store: string, key: string, value: unknown): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbDelete(store: string, key: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

type DraftRecord = { json: string; savedAt: string };

export async function saveDraft(kind: DocKind, json: string): Promise<void> {
  const record: DraftRecord = { json, savedAt: new Date().toISOString() };
  await idbSet(DRAFT_STORE, kind, record);
}

export async function loadDraft(kind: DocKind): Promise<string | null> {
  const record = await idbGet<DraftRecord>(DRAFT_STORE, kind);
  return record?.json ?? null;
}

export async function clearDraft(kind: DocKind): Promise<void> {
  await idbDelete(DRAFT_STORE, kind);
}

const FILE_HANDLE_KEY: Record<DocKind, string> = {
  modelador: "currentProjectFile",
  montagem: "currentAssemblyFile",
};

export async function rememberCurrentFileHandle(kind: DocKind, handle: FileSystemFileHandle | null): Promise<void> {
  if (handle) await idbSet(HANDLE_STORE, FILE_HANDLE_KEY[kind], handle);
  else await idbDelete(HANDLE_STORE, FILE_HANDLE_KEY[kind]);
}

// Só CONSULTA a permissão (queryPermission, sem popup) — pedir de verdade
// (requestPermission) exige um gesto do usuário, que carregar a página não
// é; navegadores ignoram/rejeitam a chamada fora de um clique. Se a
// permissão ainda não tiver sido concedida, devolve null e o usuário volta
// a cair no fluxo normal de "Salvar Como" da próxima vez — só perde a
// conveniência de continuar salvando direto no mesmo arquivo, nunca o
// conteúdo (esse já foi restaurado do rascunho).
export async function restoreCurrentFileHandle(kind: DocKind): Promise<FileSystemFileHandle | null> {
  const handle = await idbGet<FileSystemFileHandle>(HANDLE_STORE, FILE_HANDLE_KEY[kind]);
  if (!handle) return null;
  try {
    const granted = (await handle.queryPermission({ mode: "readwrite" })) === "granted";
    return granted ? handle : null;
  } catch {
    return null;
  }
}

// Debounce por documento — evita gravar no IndexedDB a cada tecla/arrasto,
// só ~800ms depois da última mudança.
const timers = new Map<DocKind, ReturnType<typeof setTimeout>>();
const AUTOSAVE_DEBOUNCE_MS = 800;

export function scheduleDraftSave(kind: DocKind, json: string): void {
  const existing = timers.get(kind);
  if (existing) clearTimeout(existing);
  timers.set(
    kind,
    setTimeout(() => {
      timers.delete(kind);
      saveDraft(kind, json).catch((err) => console.error("Falha ao salvar rascunho automático:", err));
    }, AUTOSAVE_DEBOUNCE_MS)
  );
}

// Grava imediatamente, sem esperar o debounce — chamado no evento
// "pagehide" (fecha aba/recarrega/navega) pra não perder as últimas
// alterações que ainda estivessem dentro da janela de 800ms do debounce.
// Sem garantia de terminar a tempo (IndexedDB é assíncrono e o navegador
// não espera por isso no unload), mas dispara a escrita o quanto antes em
// vez de só depois do debounce — reduz a janela de perda, não elimina.
export function flushDraftSave(kind: DocKind, json: string): void {
  const existing = timers.get(kind);
  if (existing) {
    clearTimeout(existing);
    timers.delete(kind);
  }
  saveDraft(kind, json).catch((err) => console.error("Falha ao salvar rascunho automático:", err));
}
