import { create } from "zustand";
import { useSketchStore } from "@/lib/sketch/store";
import { useFeatureStore } from "@/lib/features/store";
import { useDrawingStore } from "@/lib/drawing/store";
import { useAssemblyStore } from "@/lib/assembly/store";
import type { DimensionAnnotation, SketchLayer, SketchConstraint, SketchPlane, SketchPoint, SketchShape } from "@/lib/sketch/types";
import type { Feature } from "@/lib/features/types";
import type { DrawingSheet } from "@/lib/drawing/types";
import type { AssemblyConstraint, ComponentInstance } from "@/lib/assembly/types";

// Desfazer/refazer global: observa as stores (sketch + features + folhas de
// desenho + montagem) juntas e guarda snapshots — mais simples e mais
// seguro do que escrever a operação inversa de cada ação (linha, cota,
// extrude, remover feature, mover vista na folha, inserir/restringir
// componente...). Como todo update nessas stores já cria objetos/arrays
// novos (nunca muta em lugar), guardar as referências antigas no snapshot
// é seguro. useAssemblyStore só existe no documento de Montagem (rota
// /montagem) — no Modelador ela nunca muda, então nunca gera snapshot ali,
// as duas telas convivem sem interferir uma na outra.
type Snapshot = {
  shapes: SketchShape[];
  points: Record<string, SketchPoint>;
  dimensions: DimensionAnnotation[];
  activePlane: SketchPlane;
  layers: SketchLayer[];
  activeLayerId: string;
  constraints: SketchConstraint[];
  fixedPointIds: string[];
  nextParamNumber: number;
  features: Feature[];
  drawingSheets: DrawingSheet[];
  assemblyInstances: ComponentInstance[];
  assemblyConstraints: AssemblyConstraint[];
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
  const assembly = useAssemblyStore.getState();
  return {
    shapes: sketch.shapes,
    points: sketch.points,
    dimensions: sketch.dimensions,
    activePlane: sketch.activePlane,
    layers:sketch.layers,activeLayerId:sketch.activeLayerId,
    constraints: sketch.constraints,
    fixedPointIds: sketch.fixedPointIds,
    nextParamNumber: sketch.nextParamNumber,
    features: useFeatureStore.getState().features,
    drawingSheets: useDrawingStore.getState().sheets,
    assemblyInstances: assembly.instances,
    assemblyConstraints: assembly.constraints,
  };
}

function applySnapshot(snapshot: Snapshot) {
  useSketchStore.setState({
    shapes: snapshot.shapes,
    points: snapshot.points,
    dimensions: snapshot.dimensions,
    activePlane: snapshot.activePlane,
    layers:snapshot.layers,activeLayerId:snapshot.activeLayerId,
    constraints: snapshot.constraints,
    fixedPointIds: snapshot.fixedPointIds,
    nextParamNumber: snapshot.nextParamNumber,
    modifyPreview: null, modifyError: null, arcPoints: [],
    selectedShapeId: null, multiProfileSelection: [],
    downRaw: null, draftPoint: null, selectDrag: null, dragPreview: {},
    dragRadiusPreview: null, pendingConstraint: null, pendingSlot: null,
    dimensionDrag: null, dimensionDragPreview: null, dimensionPick1: null,
    hoverHit: null, edgeHitCandidate: null, snapIndicator: null, alignmentGuides: null,
  });
  useFeatureStore.setState({ features: snapshot.features });
  useDrawingStore.setState({ sheets: snapshot.drawingSheets });
  useAssemblyStore.setState({ instances: snapshot.assemblyInstances, constraints: snapshot.assemblyConstraints });
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
    queueMicrotask(flushPendingHistory);
  }
}

// Flush before undo/redo too: synchronous edits must not race the queued commit.
function flushPendingHistory() {
  if (!batching) return;
  batching = false;
  const start = batchStart;
  batchStart = null;
  lastSnapshot = captureSnapshot();
  if (start) useUndoStore.setState((s) => ({
    past: [...s.past, start].slice(-MAX_HISTORY), future: [],
  }));
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
  return { shapes: s.shapes, points: s.points, dimensions: s.dimensions, activePlane: s.activePlane,layers:s.layers,activeLayerId:s.activeLayerId, constraints: s.constraints, fixedPointIds: s.fixedPointIds, nextParamNumber: s.nextParamNumber };
}

let lastPersistentSlice = persistentSketchSlice();

function onSketchStoreChange() {
  const current = persistentSketchSlice();
  const changed =
    current.shapes !== lastPersistentSlice.shapes ||
    current.points !== lastPersistentSlice.points ||
    current.dimensions !== lastPersistentSlice.dimensions ||
    current.activePlane !== lastPersistentSlice.activePlane ||
    current.layers !== lastPersistentSlice.layers || current.activeLayerId !== lastPersistentSlice.activeLayerId ||
    current.constraints !== lastPersistentSlice.constraints ||
    current.fixedPointIds !== lastPersistentSlice.fixedPointIds ||
    current.nextParamNumber !== lastPersistentSlice.nextParamNumber;
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

// Mesmo raciocínio das duas fatias acima — useAssemblyStore não guarda
// nenhum estado efêmero de UI hoje (nem seleção), mas o filtro fica pronto
// pra quando isso mudar (ex.: instância selecionada na árvore).
function persistentAssemblySlice() {
  const s = useAssemblyStore.getState();
  return { instances: s.instances, constraints: s.constraints };
}

let lastPersistentAssemblySlice = persistentAssemblySlice();

function onAssemblyStoreChange() {
  const current = persistentAssemblySlice();
  if (
    current.instances === lastPersistentAssemblySlice.instances &&
    current.constraints === lastPersistentAssemblySlice.constraints
  ) {
    return;
  }
  lastPersistentAssemblySlice = current;
  onStoreChange();
}

useSketchStore.subscribe(onSketchStoreChange);
useFeatureStore.subscribe(onStoreChange);
useDrawingStore.subscribe(onDrawingStoreChange);
useAssemblyStore.subscribe(onAssemblyStoreChange);

export function undoModel() {
  flushPendingHistory();
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
  flushPendingHistory();
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
