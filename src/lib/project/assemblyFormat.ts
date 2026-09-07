import type { AssemblyConstraint, ComponentInstance } from "@/lib/assembly/types";
import type { DrawingSheet } from "@/lib/drawing/types";

// Formato nativo de Montagem do Eksteel — ao contrário do .eks3d (que
// incorpora a árvore de features inteira), aqui as peças são vinculadas AO
// VIVO: só `linkKey`/`sourceFileName` são salvos, nunca `features` — quem
// resolve o vínculo de verdade (handle do arquivo .eks3d) é
// src/lib/project/linkedFiles.ts, via IndexedDB, fora deste JSON (handles
// não são serializáveis). Reabrir uma montagem noutra máquina, ou depois
// da permissão do navegador expirar, pede pra religar cada peça de novo —
// ver o aviso equivalente já existente em folder.ts pra pasta do projeto.
export const ASSEMBLY_FILE_EXTENSION = ".eks3dasm";
export const ASSEMBLY_MIME_TYPE = "application/vnd.eksteel.montagem+json";
const ASSEMBLY_FORMAT_ID = "eksteel-montagem";
const ASSEMBLY_FORMAT_VERSION = 1;

type AssemblyFile = {
  format: typeof ASSEMBLY_FORMAT_ID;
  version: number;
  savedAt: string;
  instances: ComponentInstance[];
  constraints: AssemblyConstraint[];
  // Folhas de desenho DA MONTAGEM (vistas da montagem inteira + Lista de
  // Peças) — mesmo raciocínio do .eks3d, que guarda as folhas da peça no
  // mesmo arquivo em vez de um .idw separado. Opcional: montagens salvas
  // antes da folha de montagem existir não têm o campo.
  drawingSheets?: DrawingSheet[];
};

export type ParsedAssembly = {
  instances: ComponentInstance[];
  constraints: AssemblyConstraint[];
  drawingSheets: DrawingSheet[];
};

export function serializeAssembly(
  instances: ComponentInstance[],
  constraints: AssemblyConstraint[],
  drawingSheets: DrawingSheet[] = []
): string {
  const payload: AssemblyFile = {
    format: ASSEMBLY_FORMAT_ID,
    version: ASSEMBLY_FORMAT_VERSION,
    savedAt: new Date().toISOString(),
    instances,
    constraints,
    drawingSheets,
  };
  return JSON.stringify(payload, null, 2);
}

export function parseAssembly(json: string): ParsedAssembly {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error("Arquivo não é um JSON válido.");
  }

  if (
    !data ||
    typeof data !== "object" ||
    (data as { format?: unknown }).format !== ASSEMBLY_FORMAT_ID ||
    !Array.isArray((data as { instances?: unknown }).instances)
  ) {
    throw new Error(`Arquivo não reconhecido como montagem do Eksteel (esperado "${ASSEMBLY_FILE_EXTENSION}").`);
  }

  const file = data as AssemblyFile;
  return {
    instances: file.instances,
    constraints: Array.isArray(file.constraints) ? file.constraints : [],
    drawingSheets: Array.isArray(file.drawingSheets) ? file.drawingSheets : [],
  };
}
