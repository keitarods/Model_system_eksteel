import type { Feature } from "@/lib/features/types";

// Formato nativo do Modelador Eksteel — JSON com a árvore de features
// inteira (inclusive os sketches, com shapes/points/dimensions), pra poder
// reabrir e continuar editando depois. Diferente de STEP/DXF (que exportam
// só a geometria final, sem histórico paramétrico).
export const NATIVE_FILE_EXTENSION = ".eks3d";
export const NATIVE_MIME_TYPE = "application/vnd.eksteel.modelador+json";
const NATIVE_FORMAT_ID = "eksteel-modelador";
const NATIVE_FORMAT_VERSION = 1;

type NativeProjectFile = {
  format: typeof NATIVE_FORMAT_ID;
  version: number;
  savedAt: string;
  features: Feature[];
};

export function serializeProject(features: Feature[]): string {
  const payload: NativeProjectFile = {
    format: NATIVE_FORMAT_ID,
    version: NATIVE_FORMAT_VERSION,
    savedAt: new Date().toISOString(),
    features,
  };
  return JSON.stringify(payload, null, 2);
}

// Lança um Error com mensagem amigável se o arquivo não for reconhecido —
// quem chama decide como mostrar isso (hoje, um alert simples).
export function parseProject(json: string): Feature[] {
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

  return (data as NativeProjectFile).features;
}
