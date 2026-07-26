import { create } from "zustand";
import { useSketchStore } from "@/lib/sketch/store";
import { useFeatureStore } from "@/lib/features/store";
import { useDrawingStore } from "@/lib/drawing/store";
import type { DimensionAnnotation, SketchPlane, SketchPoint, SketchShape } from "@/lib/sketch/types";
import type { Feature } from "@/lib/features/types";
import type { DrawingSheet } from "@/lib/drawing/types";

// Desfazer/refazer global: observa as TRÊS stores (sketch + features +
// folhas de desenho) juntas e guarda snapshots — mais simples e mais seguro
// do que escrever a operação inversa de cada ação (linha, cota, extrude,
// remover feature, mover vista na folha...). Como todo update nessas
// stores já cria objetos/arrays novos (nunca muta em lugar), guardar as
// referências antigas no snapshot é seguro.
type Snapshot = {
  shapes: SketchShape[];
  points: Record<string, SketchPoint>;
  dimensions: DimensionAnnotation[];
  activePlane: SketchPlane;
  features: Feature[];
  drawingSheets: DrawingSheet[];
};

const MAX_HISTORY = 100;

type UndoStoreState = {
  past: Snapshot[];
  future: Snapshot[];
};

export const useUndoStore = create<UndoStoreState>(() => ({
  past: [],
  future: [],
}));

function captureSnapshot(): Snapshot {
  const sketch = useSketchStore.getState();
  return {
    shapes: sketch.shapes,
    points: sketch.points,
    dimensions: sketch.dimensions,
    activePlane: sketch.activePlane,
    features: useFeatureStore.getState().features,
    drawingSheets: useDrawingStore.getState().sheets,
  };
}

function applySnapshot(snapshot: Snapshot) {
  useSketchStore.setState({
    shapes: snapshot.shapes,
    points: snapshot.points,
    dimensions: snapshot.dimensions,
    activePlane: snapshot.activePlane,
  });
  useFeatureStore.setState({ features: snapshot.features });
  useDrawingStore.setState({ sheets: snapshot.drawingSheets });
}

let restoring = false;
let batching = false;
let batchStart: Snapshot | null = null;
let lastSnapshot: Snapshot = captureSnapshot();

// Uma única ação do usuário (ex.: "Extrudar") costuma disparar mais de um
// set() em sequência síncrona (addFeature + clearSketch) — sem agrupar
// isso, Ctrl+Z precisaria ser apertado várias vezes pra desfazer "uma"
// ação. queueMicrotask junta tudo que aconteceu na mesma volta síncrona
// num único passo de histórico.
function onStoreChange() {
  if (restoring) return;

  if (!batching) {
    batching = true;
    batchStart = lastSnapshot;
    queueMicrotask(() => {
      batching = false;
      const finalSnapshot = captureSnapshot();
      if (batchStart) {
        const start = batchStart;
        useUndoStore.setState((s) => ({
          past: [...s.past, start].slice(-MAX_HISTORY),
          future: [],
        }));
      }
      lastSnapshot = finalSnapshot;
      batchStart = null;
    });
  }
}

// useSketchStore também guarda estado efêmero de interação (preview de
// arrasto, indicador de snap, seleção, ferramenta pendente etc.) — isso
// muda a cada movimento do mouse durante um arrasto, e um subscribe() sem
// seletor dispara pra QUALQUER mudança na store, não só nessas. Sem esse
// filtro, cada mousemove empilhava um passo de "desfazer" idêntico ao
// anterior (shapes/points ainda não tinham mudado de verdade, só o
// preview), poluindo o histórico com dezenas de snapshots duplicados — o
// efeito visível era Ctrl+Z parecer "não fazer nada" (o passo desfeito era
// idêntico ao atual) até apertar várias vezes seguidas.
function persistentSketchSlice() {
  const s = useSketchStore.getState();
  return { shapes: s.shapes, points: s.points, dimensions: s.dimensions, activePlane: s.activePlane };
}

let lastPersistentSlice = persistentSketchSlice();

function onSketchStoreChange() {
  const current = persistentSketchSlice();
  const changed =
    current.shapes !== lastPersistentSlice.shapes ||
    current.points !== lastPersistentSlice.points ||
    current.dimensions !== lastPersistentSlice.dimensions ||
    current.activePlane !== lastPersistentSlice.activePlane;
  lastPersistentSlice = current;
  if (!changed) return;
  onStoreChange();
}

// Mesmo problema do sketch (comentário acima): activeSheetId é seleção de
// UI (qual aba de folha está aberta), não edição — trocar de aba sozinho
// não deveria empilhar um passo de desfazer.
function persistentDrawingSlice() {
  return { sheets: useDrawingStore.getState().sheets };
}

let lastPersistentDrawingSlice = persistentDrawingSlice();

function onDrawingStoreChange() {
  const current = persistentDrawingSlice();
  if (current.sheets === lastPersistentDrawingSlice.sheets) return;
  lastPersistentDrawingSlice = current;
  onStoreChange();
}

useSketchStore.subscribe(onSketchStoreChange);
useFeatureStore.subscribe(onStoreChange);
useDrawingStore.subscribe(onDrawingStoreChange);

export function undoModel() {
  const { past } = useUndoStore.getState();
  if (past.length === 0) return;

  const previous = past[past.length - 1];
  const current = captureSnapshot();

  // try/finally: se applySnapshot lançar no meio (ex.: um dos 3 setState
  // encadeados dispara um re-render que estoura em algum componente), sem
  // isso `restoring` ficava travado em true pra sempre — e como
  // onStoreChange começa com `if (restoring) return`, NENHUMA edição
  // seguinte voltaria a entrar no histórico, dando exatamente a impressão
  // de "desfazer parou de funcionar" (mesmo continuando clicável).
  restoring = true;
  try {
    applySnapshot(previous);
  } finally {
    restoring = false;
  }
  lastSnapshot = previous;

  useUndoStore.setState((s) => ({
    past: s.past.slice(0, -1),
    future: [current, ...s.future],
  }));
}

export function redoModel() {
  const { future } = useUndoStore.getState();
  if (future.length === 0) return;

  const next = future[0];
  const current = captureSnapshot();

  restoring = true;
  try {
    applySnapshot(next);
  } finally {
    restoring = false;
  }
  lastSnapshot = next;

  useUndoStore.setState((s) => ({
    past: [...s.past, current],
    future: s.future.slice(1),
  }));
}
