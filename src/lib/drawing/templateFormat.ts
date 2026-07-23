import type { SheetTemplate } from "./types";

// Arquivo separado só pro "modelo de folha" (tamanho + bloco de título,
// tabela de tolerâncias e logo) — mesma ideia do .eks3d pra peças
// (nativeFormat.ts), mas reutilizável entre projetos diferentes: abre um
// projeto novo, carrega o modelo padrão da empresa, já sai com o bloco de
// título certo sem redigitar tudo de novo.
export const SHEET_TEMPLATE_EXTENSION = ".eksfolha";
export const SHEET_TEMPLATE_MIME_TYPE = "application/vnd.eksteel.folha+json";
const TEMPLATE_FORMAT_ID = "eksteel-folha-modelo";
const TEMPLATE_FORMAT_VERSION = 1;

type SheetTemplateFile = {
  format: typeof TEMPLATE_FORMAT_ID;
  version: number;
  savedAt: string;
  template: SheetTemplate;
};

export function serializeSheetTemplate(template: SheetTemplate): string {
  const payload: SheetTemplateFile = {
    format: TEMPLATE_FORMAT_ID,
    version: TEMPLATE_FORMAT_VERSION,
    savedAt: new Date().toISOString(),
    template,
  };
  return JSON.stringify(payload, null, 2);
}

export function parseSheetTemplate(json: string): SheetTemplate {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error("Arquivo não é um JSON válido.");
  }

  if (
    !data ||
    typeof data !== "object" ||
    (data as { format?: unknown }).format !== TEMPLATE_FORMAT_ID ||
    !(data as { template?: unknown }).template
  ) {
    throw new Error(`Arquivo não reconhecido como modelo de folha da Eksteel (esperado "${SHEET_TEMPLATE_EXTENSION}").`);
  }

  return (data as SheetTemplateFile).template;
}
