import { create } from "zustand";
import type {
  DrawingAnnotation,
  DrawingDimension,
  DrawingSheet,
  DrawingView,
  SheetOrientation,
  SheetSize,
  SheetTemplate,
  TitleBlockInfo,
} from "./types";
import { DEFAULT_TOLERANCE_ROWS } from "./types";
import { normalizeBomTable, type BomRow, type BomTable } from "./bom";
import { createId } from "@/lib/sketch/render";

// Patch de anotação — campos soltos em vez de Partial<DrawingAnnotation>
// (união discriminada por `kind`): espalhar um Partial de união em cima de
// um valor de união concreto confunde o TS sobre se o resultado ainda
// satisfaz a união (mistura campos de variantes diferentes na inferência).
// Todo chamador já sabe o kind de que está mexendo e só manda os campos
// certos pra aquele kind — o cast em updateAnnotation reflete essa garantia
// que o TS não consegue expressar sozinho aqui. Exportado pra quem chama
// (DrawingSheetWorkspace) montar o patch com o mesmo formato, ex. no
// arrasto (translada x/y OU x1/y1/x2/y2 conforme o kind da anotação).
export type AnnotationPatch = Partial<{ x: number; y: number; x1: number; y1: number; x2: number; y2: number; text: string }>;

function defaultTitleBlock(): TitleBlockInfo {
  return {
    partName: "",
    material: "",
    measurements: "",
    code: "",
    finish: "",
    processes: "",
    toleranceStandard: "ABNT NBR ISO 2768-1",
    treatment: "",
    hardness: "",
    designer: "",
    approvedBy: "",
    weight: "",
    revision: "",
    // Vazia de propósito — data de revisão é preenchida à mão quando fizer
    // sentido (uma revisão de verdade), não a data de hoje só porque a
    // folha foi criada agora.
    revisionDate: "",
    page: "1/1",
    toleranceRows: DEFAULT_TOLERANCE_ROWS,
    logoDataUrl: null,
  };
}

export function createSheetObject(
  name: string,
  size: SheetSize = "A4",
  orientation: SheetOrientation = "landscape"
): DrawingSheet {
  return {
    id: createId(),
    name,
    size,
    orientation,
    scale: 1,
    views: [],
    dimensions: [],
    annotations: [],
    bomTables: [],
    titleBlock: defaultTitleBlock(),
  };
}

export type DrawingState = {
  sheets: DrawingSheet[];
  activeSheetId: string | null;

  addSheet: (sheet?: DrawingSheet) => string;
  removeSheet: (id: string) => void;
  renameSheet: (id: string, name: string) => void;
  setSheetSize: (id: string, size: SheetSize) => void;
  setSheetOrientation: (id: string, orientation: SheetOrientation) => void;
  setSheetScale: (id: string, scale: number) => void;
  setActiveSheet: (id: string) => void;

  addView: (sheetId: string, view: DrawingView) => void;
  updateView: (sheetId: string, viewId: string, patch: Partial<DrawingView>) => void;
  removeView: (sheetId: string, viewId: string) => void;
  moveView: (sheetId: string, viewId: string, x: number, y: number) => void;

  addDimension: (sheetId: string, dimension: DrawingDimension) => void;
  updateDimension: (sheetId: string, dimensionId: string, patch: Partial<DrawingDimension>) => void;
  removeDimension: (sheetId: string, dimensionId: string) => void;

  addAnnotation: (sheetId: string, annotation: DrawingAnnotation) => void;
  updateAnnotation: (sheetId: string, annotationId: string, patch: AnnotationPatch) => void;
  removeAnnotation: (sheetId: string, annotationId: string) => void;

  updateTitleBlock: (sheetId: string, patch: Partial<TitleBlockInfo>) => void;

  // Lista de Peças (BOM) — ver src/lib/drawing/bom.ts.
  addBomTable: (sheetId: string, table: BomTable) => void;
  updateBomTable: (sheetId: string, tableId: string, patch: Partial<BomTable>) => void;
  removeBomTable: (sheetId: string, tableId: string) => void;
  // Edição de uma célula à mão — grava em `overrides` (não em `values`),
  // pra sobreviver a um "Atualizar Lista" depois.
  setBomCell: (sheetId: string, tableId: string, rowId: string, key: string, value: string) => void;
  setBomRows: (sheetId: string, tableId: string, rows: BomRow[]) => void;

  // Aplica um modelo de folha (tamanho/orientação/bloco de título) numa
  // folha já existente — SEM tocar em views/dimensions dela (o modelo não
  // sabe nada sobre a peça, só sobre a "moldura" da folha).
  applyTemplate: (sheetId: string, template: SheetTemplate) => void;

  // Substitui as folhas inteiras — usado só ao abrir um projeto salvo
  // (nativeFormat.ts), não durante edição normal.
  loadSheets: (sheets: DrawingSheet[]) => void;
  clear: () => void;
};

// Fábrica (não uma store única): o Modelador e a Montagem têm CADA UM as
// suas folhas, com a mesma lógica mas estados totalmente separados — as
// stores do zustand são singletons de módulo e sobrevivem à navegação
// client-side entre /modelador e /montagem, então uma store só faria as
// folhas da peça vazarem pra montagem (e serem salvas no arquivo errado,
// já que o Modelador serializa `sheets` dentro do .eks3d).
function createDrawingStore() {
  return create<DrawingState>((set, get) => ({
  sheets: [],
  activeSheetId: null,

  addSheet: (sheet) => {
    const newSheet = sheet ?? createSheetObject(`Folha ${get().sheets.length + 1}`);
    set((s) => ({ sheets: [...s.sheets, newSheet], activeSheetId: newSheet.id }));
    return newSheet.id;
  },

  removeSheet: (id) =>
    set((s) => {
      const sheets = s.sheets.filter((sh) => sh.id !== id);
      const activeSheetId = s.activeSheetId === id ? (sheets[0]?.id ?? null) : s.activeSheetId;
      return { sheets, activeSheetId };
    }),

  renameSheet: (id, name) =>
    set((s) => ({ sheets: s.sheets.map((sh) => (sh.id === id ? { ...sh, name } : sh)) })),

  setSheetSize: (id, size) =>
    set((s) => ({ sheets: s.sheets.map((sh) => (sh.id === id ? { ...sh, size } : sh)) })),

  setSheetOrientation: (id, orientation) =>
    set((s) => ({ sheets: s.sheets.map((sh) => (sh.id === id ? { ...sh, orientation } : sh)) })),

  setSheetScale: (id, scale) =>
    set((s) => ({ sheets: s.sheets.map((sh) => (sh.id === id ? { ...sh, scale } : sh)) })),

  setActiveSheet: (id) => set({ activeSheetId: id }),

  addView: (sheetId, view) =>
    set((s) => ({
      sheets: s.sheets.map((sh) => (sh.id === sheetId ? { ...sh, views: [...sh.views, view] } : sh)),
    })),

  updateView: (sheetId, viewId, patch) =>
    set((s) => ({
      sheets: s.sheets.map((sh) =>
        sh.id === sheetId
          ? { ...sh, views: sh.views.map((v) => (v.id === viewId ? { ...v, ...patch } : v)) }
          : sh
      ),
    })),

  removeView: (sheetId, viewId) =>
    set((s) => ({
      sheets: s.sheets.map((sh) =>
        sh.id === sheetId
          ? {
              ...sh,
              views: sh.views.filter((v) => v.id !== viewId),
              // Cota/anotação sem vista dona vira lixo órfão na folha — some
              // junto (anotação com viewId null é solta na folha, não some).
              dimensions: sh.dimensions.filter((d) => d.viewId !== viewId),
              annotations: sh.annotations.filter((a) => a.viewId !== viewId),
            }
          : sh
      ),
    })),

  moveView: (sheetId, viewId, x, y) => get().updateView(sheetId, viewId, { x, y }),

  addDimension: (sheetId, dimension) =>
    set((s) => ({
      sheets: s.sheets.map((sh) => (sh.id === sheetId ? { ...sh, dimensions: [...sh.dimensions, dimension] } : sh)),
    })),

  updateDimension: (sheetId, dimensionId, patch) =>
    set((s) => ({
      sheets: s.sheets.map((sh) =>
        sh.id === sheetId
          ? { ...sh, dimensions: sh.dimensions.map((d) => (d.id === dimensionId ? { ...d, ...patch } : d)) }
          : sh
      ),
    })),

  removeDimension: (sheetId, dimensionId) =>
    set((s) => ({
      sheets: s.sheets.map((sh) =>
        sh.id === sheetId ? { ...sh, dimensions: sh.dimensions.filter((d) => d.id !== dimensionId) } : sh
      ),
    })),

  addAnnotation: (sheetId, annotation) =>
    set((s) => ({
      sheets: s.sheets.map((sh) => (sh.id === sheetId ? { ...sh, annotations: [...sh.annotations, annotation] } : sh)),
    })),

  updateAnnotation: (sheetId, annotationId, patch) =>
    set((s) => ({
      sheets: s.sheets.map((sh) =>
        sh.id === sheetId
          ? {
              ...sh,
              annotations: sh.annotations.map((a) => (a.id === annotationId ? ({ ...a, ...patch } as DrawingAnnotation) : a)),
            }
          : sh
      ),
    })),

  removeAnnotation: (sheetId, annotationId) =>
    set((s) => ({
      sheets: s.sheets.map((sh) =>
        sh.id === sheetId ? { ...sh, annotations: sh.annotations.filter((a) => a.id !== annotationId) } : sh
      ),
    })),

  updateTitleBlock: (sheetId, patch) =>
    set((s) => ({
      sheets: s.sheets.map((sh) => (sh.id === sheetId ? { ...sh, titleBlock: { ...sh.titleBlock, ...patch } } : sh)),
    })),

  addBomTable: (sheetId, table) =>
    set((s) => ({
      sheets: s.sheets.map((sh) =>
        sh.id === sheetId ? { ...sh, bomTables: [...(sh.bomTables ?? []), table] } : sh
      ),
    })),

  updateBomTable: (sheetId, tableId, patch) =>
    set((s) => ({
      sheets: s.sheets.map((sh) =>
        sh.id === sheetId
          ? { ...sh, bomTables: (sh.bomTables ?? []).map((t) => (t.id === tableId ? { ...t, ...patch } : t)) }
          : sh
      ),
    })),

  removeBomTable: (sheetId, tableId) =>
    set((s) => ({
      sheets: s.sheets.map((sh) =>
        sh.id === sheetId ? { ...sh, bomTables: (sh.bomTables ?? []).filter((t) => t.id !== tableId) } : sh
      ),
    })),

  setBomCell: (sheetId, tableId, rowId, key, value) =>
    set((s) => ({
      sheets: s.sheets.map((sh) =>
        sh.id === sheetId
          ? {
              ...sh,
              bomTables: (sh.bomTables ?? []).map((t) =>
                t.id === tableId
                  ? {
                      ...t,
                      rows: t.rows.map((r) =>
                        r.id === rowId ? { ...r, overrides: { ...r.overrides, [key]: value } } : r
                      ),
                    }
                  : t
              ),
            }
          : sh
      ),
    })),

  setBomRows: (sheetId, tableId, rows) => get().updateBomTable(sheetId, tableId, { rows }),

  applyTemplate: (sheetId, template) =>
    set((s) => ({
      sheets: s.sheets.map((sh) =>
        sh.id === sheetId
          ? {
              ...sh,
              size: template.size,
              orientation: template.orientation,
              scale: template.scale,
              titleBlock: template.titleBlock,
              // A moldura da lista do modelo (colunas/medidas) entra nas
              // listas JÁ colocadas na folha, preservando as linhas delas —
              // trocar de modelo padroniza o formato da lista, não apaga o
              // conteúdo dela.
              bomTables: template.bom
                ? (sh.bomTables ?? []).map((t) => ({ ...t, ...template.bom!, columns: template.bom!.columns.map((c) => ({ ...c })) }))
                : sh.bomTables,
            }
          : sh
      ),
    })),

  // annotations/scale/bomTables são opcionais na normalização — projetos
  // salvos antes dessas ferramentas existirem não têm esses campos no JSON.
  loadSheets: (sheets) =>
    set({
      sheets: sheets.map(
        (sh): DrawingSheet => ({
          ...sh,
          annotations: sh.annotations ?? [],
          scale: sh.scale ?? 1,
          bomTables: (sh.bomTables ?? []).map(normalizeBomTable),
        })
      ),
      activeSheetId: sheets[0]?.id ?? null,
    }),
  clear: () => set({ sheets: [], activeSheetId: null }),
  }));
}

// Folhas da PEÇA (Modelador) — salvas dentro do .eks3d (ver nativeFormat.ts).
export const useDrawingStore = createDrawingStore();

// Folhas da MONTAGEM — salvas dentro do .eks3dasm (ver assemblyFormat.ts).
export const useAssemblyDrawingStore = createDrawingStore();
