import type { DocumentLibrary } from "./cloudDocuments";
/** Provider boundary: UI and native documents are independent of database SDKs.
 * SQL engines need a server adapter; database passwords must not reach browser drivers.
 */
export type CurrentProject = { json: string; token: string };
export const CLOUD_CONFLICT = "Conflito: a peça foi alterada por outra sessão. Abra a peça atual novamente ou use Salvar como com outro nome.";

export interface ProjectCloudProvider {
  userId: string;
  documents?: DocumentLibrary;
  folders(): Promise<string[]>;
  projects(folder: string): Promise<string[]>;
  versions(folder: string, project: string): Promise<string[]>;
  createFolder(folder: string): Promise<void>;
  current(folder: string, project: string): Promise<CurrentProject | null>;
  saveCurrent(folder: string, project: string, json: string, expected: string | null): Promise<string>;
  /** Explicit immutable revision; retained for compatibility with previous callers. */
  save(folder: string, project: string, json: string): Promise<string>;
  open(folder: string, project: string, version: string): Promise<string>;
}

export interface CloudSession {
  provider: ProjectCloudProvider;
  disconnect(): Promise<void>;
}
