import type { AnyShape } from "replicad";
import type { BomSourcePart } from "./bom";
import type { DrawingBend } from "./autoDimensions";

export type SheetShapeSource = {
  kind: "peca" | "montagem";
  // Constrói a shape a projetar. `flatten` só faz sentido pra peça de chapa
  // (planificada vs. dobrada); a montagem ignora. Devolver null = nada
  // modelado/vinculado ainda, e a mensagem de `emptyMessage` é mostrada.
  buildShape: (options: { flatten: boolean; onBend?:(bend:import("@/lib/replicad/drawingBends").NativeDrawingBend)=>void }) => AnyShape | null;
  // Assinatura do modelo atual — carimbada em cada vista gerada e comparada
  // depois pra sinalizar "vista desatualizada" (ver isViewStale).
  signature: string;
  // Habilita o par planificada/dobrada no seletor de vista (só peça de chapa).
  supportsFlatten: boolean;
  bends?: DrawingBend[];
  emptyMessage: string;
  // Só montagem: peças resolvidas (instância + sólido + iProperties) pra
  // montar/atualizar a Lista de Peças. Ausente = a ferramenta de lista nem
  // aparece na barra (uma folha de peça única não tem o que listar).
  bomParts?: () => BomSourcePart[];
  componentSources?: () => { id: string; name: string; group: string; available: boolean; properties: import("@/lib/project/partProperties").PartProperties; source: SheetShapeSource }[];
};
