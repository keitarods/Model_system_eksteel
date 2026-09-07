"use client";

// Vínculo ao vivo das peças (.eks3d) referenciadas por uma montagem —
// generaliza o mesmo padrão de handle persistido em IndexedDB que
// folder.ts já usa pra "pasta do projeto", só que com uma chave por
// componente (linkKey) em vez de uma única pasta.
//
// Igual a folder.ts: só funciona em navegadores com File System Access
// (Chrome/Edge). Sem suporte, o handle nunca sobrevive entre sessões — a
// montagem abre com todos os componentes "não vinculados" e cada um
// precisa ser religado manualmente via pickFileToOpen (ver
// isFileSystemAccessSupported).

import { isFileSystemAccessSupported, pickFileToOpen } from "@/lib/project/folder";
import { NATIVE_FILE_EXTENSION, parseProject } from "@/lib/project/nativeFormat";
import type { Feature } from "@/lib/features/types";
import type { PartProperties } from "@/lib/project/partProperties";

const DB_NAME = "eksteel-modelador";
const STORE_NAME = "linkedFileHandles";
// Precisa ser IGUAL à versão pinada em autosave.ts (DB_VERSION lá) — os
// dois módulos pedem a MESMA versão de propósito, senão o que abrir
// primeiro "vence" e o outro, ao pedir uma versão menor que a já criada,
// toma VersionError pra sempre (IndexedDB não permite abrir com versão
// menor que a atual, mesmo que o store que falta já exista). Se um dia
// precisar subir a versão de novo, suba nos dois arquivos juntos.
const DB_VERSION = 3;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      // "handles" já existe desde a v1 (pasta do projeto, ver folder.ts) —
      // só cria o object store novo, sem mexer no existente.
      if (!db.objectStoreNames.contains("handles")) {
        db.createObjectStore("handles");
      }
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
      // "autosaveDrafts" é dono de autosave.ts (v3) — criado aqui também
      // (defensivamente) pro caso deste módulo ser o primeiro a abrir o
      // banco do zero nesta versão, ver o comentário lá pra mais contexto.
      if (!db.objectStoreNames.contains("autosaveDrafts")) {
        db.createObjectStore("autosaveDrafts");
      }
    };
    request.onsuccess = () => {
      // Mesmo raciocínio do onversionchange em folder.ts: sem fechar ao
      // ser avisado, uma conexão aberta aqui bloquearia uma FUTURA versão
      // maior (se um dia existir) do mesmo jeito que a v1 do folder.ts
      // bloqueou esta v2 — melhor já deixar certo dos dois lados.
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
    // Dispara se OUTRA conexão (ex.: folder.ts, numa aba/página ainda
    // aberta com a versão anterior carregada) estiver segurando o banco
    // numa versão anterior e não fechar a tempo — sem isso, essa promise
    // ficaria pendurada pra sempre, sem nenhum aviso no console.
    request.onblocked = () => {
      console.warn(
        "IndexedDB (eksteel-modelador) bloqueado por outra aba/conexão aberta — recarregue a página se o vínculo de peça não resolver."
      );
    };
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

async function idbDelete(key: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function rememberLinkedFile(linkKey: string, handle: FileSystemFileHandle): Promise<void> {
  await idbSet(linkKey, handle);
}

export async function loadLinkedFileHandle(linkKey: string): Promise<FileSystemFileHandle | null> {
  if (!isFileSystemAccessSupported()) return null;
  const handle = await idbGet<FileSystemFileHandle>(linkKey);
  return handle ?? null;
}

export async function forgetLinkedFile(linkKey: string): Promise<void> {
  await idbDelete(linkKey);
}

// Exportada (não só usada aqui dentro) — ModeladorWorkspace precisa dela
// pra abrir o handle de uma peça vinculada diretamente (editar no contexto
// da Montagem, ver src/lib/project/editInContext.ts), sem passar por
// resolveLinkedFile (que devolve só features já lidas, não o handle em si —
// e o Modelador precisa do handle pra "Salvar" gravar direto nele).
export async function ensureReadPermission(handle: FileSystemFileHandle): Promise<boolean> {
  const opts: FileSystemHandlePermissionDescriptor = { mode: "read" };
  if ((await handle.queryPermission(opts)) === "granted") return true;
  return (await handle.requestPermission(opts)) === "granted";
}

export type LinkResolution =
  | { ok: true; features: Feature[]; fileName: string; properties: PartProperties }
  | { ok: false; reason: "sem-suporte" | "sem-handle" | "sem-permissao" | "arquivo-invalido" };

// Tenta resolver uma peça vinculada a partir do handle lembrado (sem pedir
// nada ao usuário) — usado ao reabrir uma montagem. Falha em qualquer
// etapa só devolve o motivo, nunca lança; quem chama decide como mostrar
// isso (ícone de "não vinculado" na árvore + botão "Vincular arquivo...").
export async function resolveLinkedFile(linkKey: string): Promise<LinkResolution> {
  if (!isFileSystemAccessSupported()) return { ok: false, reason: "sem-suporte" };

  const handle = await loadLinkedFileHandle(linkKey);
  if (!handle) return { ok: false, reason: "sem-handle" };

  if (!(await ensureReadPermission(handle))) return { ok: false, reason: "sem-permissao" };

  try {
    const file = await handle.getFile();
    const parsed = parseProject(await file.text());
    return { ok: true, features: parsed.features, fileName: file.name, properties: parsed.properties };
  } catch {
    return { ok: false, reason: "arquivo-invalido" };
  }
}

// Pede ao usuário pra escolher/religar o arquivo .eks3d de uma peça —
// usado tanto ao inserir um componente novo quanto ao religar um já
// existente que ficou "não vinculado". Grava o novo handle (se o
// navegador suportar) pra não precisar perguntar de novo na próxima vez
// que a montagem for aberta nesta máquina.
export async function pickAndLinkFile(
  linkKey: string
): Promise<{ features: Feature[]; fileName: string; properties: PartProperties } | null> {
  const picked = await pickFileToOpen([
    { description: "Peça Eksteel", accept: { "application/json": [NATIVE_FILE_EXTENSION] } },
  ]);
  if (!picked) return null;

  const parsed = parseProject(await picked.file.text());
  if (picked.handle) {
    await rememberLinkedFile(linkKey, picked.handle);
  }
  return { features: parsed.features, fileName: picked.file.name, properties: parsed.properties };
}
