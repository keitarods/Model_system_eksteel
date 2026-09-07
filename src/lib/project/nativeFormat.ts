import type { Feature } from "@/lib/features/types";
import type { DrawingSheet } from "@/lib/drawing/types";
import { normalizePartProperties, type PartProperties } from "@/lib/project/partProperties";

// Formato nativo do Modelador Eksteel — JSON com a árvore de features
// inteira (inclusive os sketches, com shapes/points/dimensions), pra poder
// reabrir e continuar editando depois. Diferente de STEP/DXF (que exportam
// só a geometria final, sem histórico paramétrico). drawingSheets (folhas
// de desenho 2D geradas da peça) mora no MESMO arquivo — ao contrário do
// .idw separado do Inventor (vinculado ao .ipt por fora), aqui é tudo um
// projeto só, mais simples de não perder o vínculo entre os dois.
export const NATIVE_FILE_EXTENSION = ".eks3d";
export const NATIVE_MIME_TYPE = "application/vnd.eksteel.modelador+json";
const NATIVE_FORMAT_ID = "eksteel-modelador";
const NATIVE_FORMAT_VERSION = 1;

type NativeProjectFile = {
  format: typeof NATIVE_FORMAT_ID;
  version: number;
  savedAt: string;
  features: Feature[];
  // Opcional — ausente em projetos salvos antes da ferramenta de Desenho
  // existir. parseProject devolve [] nesse caso (ver abaixo).
  drawingSheets?: DrawingSheet[];
  // Opcional pelo mesmo motivo — ausente antes das "iProperties" existirem.
  // parseProject devolve o padrão (ver normalizePartProperties) nesse caso.
  // É daqui que a Lista de Peças (BOM) de uma MONTAGEM tira código/
  // descrição/material/densidade de cada peça vinculada — ver
  // src/lib/drawing/bom.ts.
  properties?: PartProperties;
};

export type ParsedProject = {
  features: Feature[];
  drawingSheets: DrawingSheet[];
  properties: PartProperties;
};

export function serializeProject(
  features: Feature[],
  drawingSheets: DrawingSheet[] = [],
  properties?: PartProperties
): string {
  const payload: NativeProjectFile = {
    format: NATIVE_FORMAT_ID,
    version: NATIVE_FORMAT_VERSION,
    savedAt: new Date().toISOString(),
    features,
    drawingSheets,
    properties: normalizePartProperties(properties),
  };
  return JSON.stringify(payload, null, 2);
}

// Lança um Error com mensagem amigável se o arquivo não for reconhecido —
// quem chama decide como mostrar isso (hoje, um alert simples).
export function parseProject(json: string): ParsedProject {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error("Arquivo não é um JSON válido.");
  }

  if (
    !data ||
    typeof data !== "object" ||
    (data as { format?: unknown }).format !== NATIVE_FORMAT_ID ||
    !Array.isArray((data as { features?: unknown }).features)
  ) {
    throw new Error(`Arquivo não reconhecido como projeto do Modelador Eksteel (esperado "${NATIVE_FILE_EXTENSION}").`);
  }

  const file = data as NativeProjectFile;
  return {
    features: file.features,
    drawingSheets: Array.isArray(file.drawingSheets) ? file.drawingSheets : [],
    properties: normalizePartProperties(file.properties),
  };
}
