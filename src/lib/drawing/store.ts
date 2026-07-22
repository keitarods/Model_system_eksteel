import { create } from "zustand";
import type {
  DrawingDimension,
  DrawingSheet,
  DrawingView,
  SheetOrientation,
  SheetSize,
  TitleBlockInfo,
} from "./types";
import { createId } from "@/lib/sketch/render";

function defaultTitleBlock(): TitleBlockInfo {
  return {
    partName: "",
    material: "",
    drawnBy: "",
    date: new Date().toISOString().slice(0, 10),
    notes: "",
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
    views: [],
    dimensions: [],
    titleBlock: defaultTitleBlock(),
  };
}

type DrawingState = {
  sheets: DrawingSheet[];
  activeSheetId: string | null;

  addSheet: (sheet?: DrawingSheet) => string;
  removeSheet: (id: string) => void;
  renameSheet: (id: string, name: string) => void;
  setSheetSize: (id: string, size: SheetSize) => void;
  setSheetOrientation: (id: string, orientation: SheetOrientation) => void;
  setActiveSheet: (id: string) => void;

  addView: (sheetId: string, view: DrawingView) => void;
  updateView: (sheetId: string, viewId: string, patch: Partial<DrawingView>) => void;
  removeView: (sheetId: string, viewId: string) => void;
  moveView: (sheetId: string, viewId: string, x: number, y: number) => void;

  addDimension: (sheetId: string, dimension: DrawingDimension) => void;
  updateDimension: (sheetId: string, dimensionId: string, patch: Partial<DrawingDimension>) => void;
  removeDimension: (sheetId: string, dimensionId: string) => void;

  updateTitleBlock: (sheetId: string, patch: Partial<TitleBlockInfo>) => void;

  // Substitui as folhas inteiras — usado só ao abrir um projeto salvo
  // (nativeFormat.ts), não durante edição normal.
  loadSheets: (sheets: DrawingSheet[]) => void;
  clear: () => void;
};

export const useDrawingStore = create<DrawingState>((set, get) => ({
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
              // Cota sem vista dona vira lixo órfão na folha — some junto.
              dimensions: sh.dimensions.filter((d) => d.viewId !== viewId),
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

  updateTitleBlock: (sheetId, patch) =>
    set((s) => ({
      sheets: s.sheets.map((sh) => (sh.id === sheetId ? { ...sh, titleBlock: { ...sh.titleBlock, ...patch } } : sh)),
    })),

  loadSheets: (sheets) => set({ sheets, activeSheetId: sheets[0]?.id ?? null }),
  clear: () => set({ sheets: [], activeSheetId: null }),
}));
