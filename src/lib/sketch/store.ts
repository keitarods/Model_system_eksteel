import { create } from "zustand";
import { BASE_SKETCH_PLANE } from "./types";
import type {
  CircleShape,
  DimensionAnnotation,
  Point,
  SketchPlane,
  SketchPoint,
  SketchShape,
  SketchTool,
} from "./types";
import { findNearbyPoint, resolveSnapWithEdges } from "./snap";
import { findEdgeHit, findLineRegion, findRectRegion, type EdgeHit } from "./hitTest";
import { findCircleByCenter, edgeHitToDimension, createId, distance } from "./render";
import { findCornerNear, computeFillet, computeChamfer } from "./filletChamfer";
import { DRAG_TOOLS, CLICK_TOOLS } from "./tools";

// Tolerâncias em mm (unidades de mundo do plano do sketch) — as mesmas,
// independente de quem gerou o "raw" (SVG 2D via CTM, ou raycast num plano
// 3D via worldToLocalPoint), por isso moraram aqui e não numa view.
const SNAP_TOLERANCE = 6;
const EDGE_SELECT_TOLERANCE = 8;
const SELECT_POINT_TOLERANCE = 8;
const CLICK_VS_DRAG_THRESHOLD = 4;

export type ReferenceSegment = { x1: number; y1: number; x2: number; y2: number };

// Arrastar um ponto (perto o bastante de um vértice/centro) reformata a(s)
// forma(s) que o referenciam livremente. Pra retângulo: arrastar uma ARESTA
// redimensiona só aquele lado (mexe só em p1 ou p2, só no eixo x ou y);
// arrastar o INTERIOR move o retângulo inteiro. Pra linha solta: arrastar
// perto de uma ponta estica/encolhe aquele lado ao longo da direção da
// própria linha; perto do meio move a linha inteira. Círculo: arrastar a
// borda redimensiona o raio direto (o centro já é um ponto normal).
export type SelectDrag =
  | { mode: "point"; pointId: string }
  | { mode: "circleRadius"; shapeId: string; center: Point }
  | { mode: "rectEdge"; shapeId: string; axis: "x" | "y"; corner: "p1" | "p2" }
  | { mode: "translate"; pointIds: string[]; startPositions: Record<string, Point> }
  | { mode: "lineEnd"; movingPointId: string; anchor: Point; direction: Point };

// Estado de "primeira seleção" das ferramentas de 2 cliques (Perpendicular,
// Tangente, Unir Pontos) — nenhuma delas é um solver: o segundo clique
// aplica a mudança uma vez só e o estado é descartado.
export type PendingConstraint =
  | { kind: "perpendicular"; firstId: string }
  | { kind: "tangent"; firstId: string; firstShapeKind: "line" | "circle" }
  | { kind: "joinPoints"; firstId: string };

type SketchState = {
  tool: SketchTool;
  gridSize: number;
  activePlane: SketchPlane;
  points: Record<string, SketchPoint>;
  shapes: SketchShape[];
  dimensions: DimensionAnnotation[];
  // Valor atual usado pelo próximo clique das ferramentas Concordância
  // (fillet2d) e Chanfro (chamfer2d) — mostrado/editável na paleta enquanto
  // a ferramenta está ativa.
  filletRadius: number;
  chamferDistance: number;

  // Estado de interação "ao vivo" (não persiste no feature tree) —
  // compartilhado por QUALQUER view que desenhe/edite o sketch (o editor 2D
  // em SVG e o overlay dentro do viewport 3D), pra que arrastar/clicar num
  // painel se reflita instantaneamente no outro (mesma fonte de verdade, em
  // vez de duas cópias de estado local desencontradas).
  downRaw: Point | null;
  draftPoint: Point | null;
  measurement: { x1: number; y1: number; x2: number; y2: number } | null;
  edgeHitCandidate: EdgeHit | null;
  hoverHit: EdgeHit | null;
  snapIndicator: Point | null;
  selectDrag: SelectDrag | null;
  dragPreview: Record<string, Point>;
  dragRadiusPreview: { shapeId: string; radius: number } | null;
  selectedShapeId: string | null;
  pendingConstraint: PendingConstraint | null;

  setTool: (tool: SketchTool) => void;
  setActivePlane: (plane: SketchPlane) => void;
  setFilletRadius: (radius: number) => void;
  setChamferDistance: (distance: number) => void;
  // Resolve um clique bruto num id de ponto do pool — reaproveita um ponto
  // já existente (coincidência), ou encosta numa aresta do sketch/geometria
  // de referência do sólido 3D se estiver perto o bastante, ou cai pro
  // grid. referenceGeometry vem de fora (projeção do sólido, calculada no
  // ModeladorWorkspace) — por isso é passado a cada chamada.
  resolvePointAt: (raw: Point, toleranceWorld: number, referenceGeometry?: ReferenceSegment[]) => string;
  // Move um ou mais pontos do pool de uma vez (uma chamada = um passo de
  // undo) — usado pela ferramenta Selecionar pra arrastar vértices/formas.
  movePoints: (updates: Record<string, Point>) => void;
  // Redimensiona um círculo direto (arrastar o corpo dele com Selecionar) —
  // sem precisar de uma cota de raio já existente.
  resizeCircle: (shapeId: string, radius: number) => void;
  addShape: (shape: SketchShape) => void;
  // Remove a geometria e qualquer cota que dependa dela diretamente
  // (raio/largura/altura); cotas de "distance" entre pontos ficam (o ponto
  // pode ainda pertencer a outra forma) — mesmo espírito de não recolher
  // pontos órfãos.
  removeShape: (id: string) => void;
  addDimension: (dimension: DimensionAnnotation) => void;
  removeDimension: (id: string) => void;
  updateDistanceDimension: (id: string, newLength: number) => void;
  updateRadiusDimension: (id: string, newRadius: number) => void;
  updateWidthDimension: (id: string, newWidth: number) => void;
  updateHeightDimension: (id: string, newHeight: number) => void;
  // Pede o novo valor via prompt() e despacha pra ação de update certa
  // conforme o tipo da cota — mesmo fluxo usado tanto pelo editor 2D quanto
  // pelo overlay 3D, pra não duplicar o roteamento em cada view.
  promptEditDimension: (dimension: DimensionAnnotation, currentValue: number) => void;
  // Ferramentas de alinhamento "de um clique só" (ao estilo dos constraints
  // do Inventor) — mas sem solver: aplicam a mudança UMA VEZ, não ficam
  // reforçando depois se você arrastar outra coisa.
  makeLineHorizontal: (lineId: string) => void;
  makeLineVertical: (lineId: string) => void;
  makePerpendicular: (lineAId: string, lineBId: string) => void;
  makeTangent: (lineId: string, circleId: string) => void;
  // Funde removeId em keepId em todo mundo que referencia (shapes + cotas);
  // a posição final fica sendo a de keepId.
  joinPoints: (keepId: string, removeId: string) => void;
  // Substitui o retângulo (um único primitivo com só 2 cantos) por 4 linhas
  // independentes formando o mesmo contorno fechado — dá pra editar cada
  // lado separadamente depois (arrastar ponta, unir com outra linha, cotar
  // como distância comum etc.), com a mesma mecânica que já existe pra
  // qualquer linha solta. Ação deliberada (não automática ao desenhar um
  // retângulo nem) — outros retângulos do sketch continuam como primitivo,
  // o que preserva a detecção de perfil pra Extrudar/Revolucionar.
  convertRectToLines: (rectId: string) => void;
  clear: () => void;

  // Máquina de interação em espaço local do plano (mm) — agnóstica de quem
  // gerou o ponto "raw" (CTM de SVG no editor 2D, ou raycast+worldToLocalPoint
  // no overlay 3D). down/move/up espelham exatamente os handlers de
  // pointerdown/move/up que existiam no SketchEditor antes dessa extração.
  handleRawDown: (raw: Point, referenceGeometry?: ReferenceSegment[]) => void;
  handleRawMove: (raw: Point, referenceGeometry?: ReferenceSegment[]) => void;
  handleRawUp: (raw: Point, referenceGeometry?: ReferenceSegment[]) => void;
  clearHover: () => void;
  deleteSelectedShape: () => void;
};

// Desfazer/refazer agora é global (ver src/lib/history/store.ts), que
// observa esta store inteira — por isso não há mais histórico/undo local
// aqui, só o estado do sketch em si.
export const useSketchStore = create<SketchState>((set, get) => {
  function previewSnap(raw: Point, referenceGeometry: ReferenceSegment[]): Point {
    const { points, shapes, gridSize } = get();
    const resolved = resolveSnapWithEdges(raw, points, shapes, referenceGeometry, gridSize, SNAP_TOLERANCE);
    // Efeito colateral de propósito: todo chamador já está dentro de um
    // handler de ponteiro, então é seguro atualizar o indicador visual
    // aqui — evita duplicar a resolução de snap só pra saber se "colou".
    set({ snapIndicator: resolved.snapped ? resolved.point : null });
    return resolved.point;
  }

  // Ferramentas de clique único/duplo aplicam a mudança na hora — não
  // passam pela máquina de arrasto (downRaw/draftPoint) usada pelas
  // ferramentas de desenho.
  function handleConstraintClick(tool: SketchTool, raw: Point, referenceGeometry: ReferenceSegment[]) {
    const { shapes, points, pendingConstraint } = get();

    if (tool === "point") {
      const id = get().resolvePointAt(raw, SNAP_TOLERANCE, referenceGeometry);
      get().addShape({ id: createId(), type: "point", pointId: id });
      return;
    }

    if (tool === "horizontal" || tool === "vertical") {
      const lineHit = findLineRegion(raw, shapes, points, EDGE_SELECT_TOLERANCE);
      if (!lineHit) return;
      if (tool === "horizontal") get().makeLineHorizontal(lineHit.shapeId);
      else get().makeLineVertical(lineHit.shapeId);
      return;
    }

    if (tool === "perpendicular") {
      const lineHit = findLineRegion(raw, shapes, points, EDGE_SELECT_TOLERANCE);
      if (!lineHit) return;
      if (!pendingConstraint || pendingConstraint.kind !== "perpendicular") {
        set({ pendingConstraint: { kind: "perpendicular", firstId: lineHit.shapeId } });
        return;
      }
      if (pendingConstraint.firstId === lineHit.shapeId) return;
      get().makePerpendicular(pendingConstraint.firstId, lineHit.shapeId);
      set({ pendingConstraint: null });
      return;
    }

    if (tool === "tangent") {
      const hit = findEdgeHit(raw, shapes, points, EDGE_SELECT_TOLERANCE);
      if (!hit) return;
      const kind: "line" | "circle" | null =
        hit.kind === "line" ? "line" : hit.kind === "circleRadius" ? "circle" : null;
      if (!kind) return; // arestas de retângulo não entram nessa ferramenta

      if (!pendingConstraint || pendingConstraint.kind !== "tangent") {
        set({ pendingConstraint: { kind: "tangent", firstId: hit.shapeId, firstShapeKind: kind } });
        return;
      }
      if (pendingConstraint.firstShapeKind === kind) return; // precisa de 1 linha + 1 círculo
      if (kind === "circle") {
        get().makeTangent(pendingConstraint.firstId, hit.shapeId);
      } else {
        get().makeTangent(hit.shapeId, pendingConstraint.firstId);
      }
      set({ pendingConstraint: null });
      return;
    }

    if (tool === "joinPoints") {
      const nearby = findNearbyPoint(raw, Object.values(points), SELECT_POINT_TOLERANCE);
      if (!nearby) return;
      if (!pendingConstraint || pendingConstraint.kind !== "joinPoints") {
        set({ pendingConstraint: { kind: "joinPoints", firstId: nearby.id } });
        return;
      }
      if (pendingConstraint.firstId === nearby.id) return;
      get().joinPoints(pendingConstraint.firstId, nearby.id);
      set({ pendingConstraint: null });
      return;
    }

    if (tool === "fillet2d" || tool === "chamfer2d") {
      // Um retângulo é 1 primitivo só (2 cantos diagonais, sem 4 linhas
      // independentes) — clicar perto de um canto dele converte pra 4
      // linhas soltas primeiro (mesma mecânica de convertRectToLines, já
      // usada pela ferramenta Selecionar), só então o canto vira um par de
      // linhas que a busca genérica abaixo já sabe achar.
      const rectId = findRectCornerNear(raw, shapes, points, SELECT_POINT_TOLERANCE);
      if (rectId) get().convertRectToLines(rectId);

      const live = get();
      const corner = findCornerNear(raw, live.shapes, live.points, SELECT_POINT_TOLERANCE);
      if (!corner) return;

      const result =
        tool === "fillet2d"
          ? computeFillet(corner, live.points, live.filletRadius)
          : computeChamfer(corner, live.points, live.chamferDistance);
      if (!result) return;

      set((s) => ({
        points: {
          ...s.points,
          ...Object.fromEntries(result.newPoints.map((p) => [p.id, p])),
        },
        shapes: [
          ...s.shapes.filter(
            (sh) => sh.id !== result.updatedLineA.id && sh.id !== result.updatedLineB.id
          ),
          result.updatedLineA,
          result.updatedLineB,
          result.newShape,
        ],
      }));
    }
  }

  // Deriva os 4 cantos de todo retângulo do sketch na hora (mesma lógica de
  // convertRectToLines) só pra testar proximidade — não vale a pena manter
  // isso pré-calculado em algum lugar por causa de uma única ferramenta.
  function findRectCornerNear(
    raw: Point,
    shapes: SketchShape[],
    points: Record<string, SketchPoint>,
    tolerance: number
  ): string | null {
    for (const shape of shapes) {
      if (shape.type !== "rect") continue;
      const p1 = points[shape.p1];
      const p2 = points[shape.p2];
      if (!p1 || !p2) continue;
      const corners = [p1, { x: p2.x, y: p1.y }, p2, { x: p1.x, y: p2.y }];
      if (corners.some((c) => Math.hypot(raw.x - c.x, raw.y - c.y) < tolerance)) {
        return shape.id;
      }
    }
    return null;
  }

  return {
    tool: "rect",
    gridSize: 10,
    activePlane: BASE_SKETCH_PLANE,
    points: {},
    shapes: [],
    dimensions: [],
    filletRadius: 5,
    chamferDistance: 5,

    downRaw: null,
    draftPoint: null,
    measurement: null,
    edgeHitCandidate: null,
    hoverHit: null,
    snapIndicator: null,
    selectDrag: null,
    dragPreview: {},
    dragRadiusPreview: null,
    selectedShapeId: null,
    pendingConstraint: null,

    setTool: (tool) =>
      set((s) => ({
        tool,
        measurement: tool === "measure" ? s.measurement : null,
        hoverHit: tool === "dimension" ? s.hoverHit : null,
        selectDrag: tool === "select" ? s.selectDrag : null,
        dragPreview: tool === "select" ? s.dragPreview : {},
        dragRadiusPreview: tool === "select" ? s.dragRadiusPreview : null,
        selectedShapeId: tool === "select" ? s.selectedShapeId : null,
        pendingConstraint: null,
      })),
    setActivePlane: (plane) => set({ activePlane: plane }),
    setFilletRadius: (radius) => set({ filletRadius: Math.max(radius, 0.1) }),
    setChamferDistance: (distance) => set({ chamferDistance: Math.max(distance, 0.1) }),

    resolvePointAt: (raw, toleranceWorld, referenceGeometry = []) => {
      const { points, gridSize, shapes } = get();
      const resolved = resolveSnapWithEdges(
        raw,
        points,
        shapes,
        referenceGeometry,
        gridSize,
        toleranceWorld
      );
      if (resolved.existingId) return resolved.existingId;

      const id = createId();
      set((s) => ({
        points: {
          ...s.points,
          [id]: { id, x: resolved.point.x, y: resolved.point.y },
        },
      }));
      return id;
    },

    movePoints: (updates) =>
      set((s) => {
        const nextPoints = { ...s.points };
        for (const [id, pos] of Object.entries(updates)) {
          if (!nextPoints[id]) continue;
          nextPoints[id] = { id, x: pos.x, y: pos.y };
        }
        return { points: nextPoints };
      }),

    resizeCircle: (shapeId, radius) =>
      set((s) => ({
        shapes: s.shapes.map((shape) =>
          shape.type === "circle" && shape.id === shapeId
            ? { ...shape, radius: Math.max(radius, 0.5) }
            : shape
        ),
      })),

    addShape: (shape) => set((s) => ({ shapes: [...s.shapes, shape] })),

    removeShape: (id) =>
      set((s) => ({
        shapes: s.shapes.filter((shape) => shape.id !== id),
        dimensions: s.dimensions.filter((d) => {
          if (d.kind === "radius") return d.circleId !== id;
          if (d.kind === "width" || d.kind === "height") return d.rectId !== id;
          return true;
        }),
      })),

    addDimension: (dimension) =>
      set((s) => ({ dimensions: [...s.dimensions, dimension] })),

    removeDimension: (id) =>
      set((s) => ({ dimensions: s.dimensions.filter((d) => d.id !== id) })),

    // Move p2 em relação a p1 ao longo da direção atual entre eles — qualquer
    // shape que referencie esses ids (inclusive de outra aresta) acompanha na
    // hora, porque todo mundo lê do mesmo pool.
    updateDistanceDimension: (id, newLength) =>
      set((s) => {
        const dim = s.dimensions.find((d) => d.id === id);
        if (!dim || dim.kind !== "distance" || newLength <= 0) return s;

        const p1 = s.points[dim.p1];
        const p2 = s.points[dim.p2];
        if (!p1 || !p2) return s;

        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const currentLength = Math.hypot(dx, dy);
        if (currentLength < 1e-6) return s;

        const ux = dx / currentLength;
        const uy = dy / currentLength;

        return {
          points: {
            ...s.points,
            [p2.id]: { id: p2.id, x: p1.x + ux * newLength, y: p1.y + uy * newLength },
          },
        };
      }),

    updateRadiusDimension: (id, newRadius) =>
      set((s) => {
        const dim = s.dimensions.find((d) => d.id === id);
        if (!dim || dim.kind !== "radius" || newRadius <= 0) return s;

        return {
          shapes: s.shapes.map((shape) =>
            shape.type === "circle" && shape.id === dim.circleId
              ? { ...shape, radius: newRadius }
              : shape
          ),
        };
      }),

    // Retângulo só guarda p1/p2 (cantos diagonais) — largura mexe só no x de
    // p2, altura só no y, preservando o outro eixo (ao contrário de "distance"
    // genérico, que moveria os dois juntos ao longo da diagonal).
    updateWidthDimension: (id, newWidth) =>
      set((s) => {
        const dim = s.dimensions.find((d) => d.id === id);
        if (!dim || dim.kind !== "width" || newWidth <= 0) return s;

        const rect = s.shapes.find((sh) => sh.id === dim.rectId);
        if (!rect || rect.type !== "rect") return s;

        const p1 = s.points[rect.p1];
        const p2 = s.points[rect.p2];
        if (!p1 || !p2) return s;

        const sign = p2.x - p1.x >= 0 ? 1 : -1;

        return {
          points: {
            ...s.points,
            [p2.id]: { id: p2.id, x: p1.x + sign * newWidth, y: p2.y },
          },
        };
      }),

    updateHeightDimension: (id, newHeight) =>
      set((s) => {
        const dim = s.dimensions.find((d) => d.id === id);
        if (!dim || dim.kind !== "height" || newHeight <= 0) return s;

        const rect = s.shapes.find((sh) => sh.id === dim.rectId);
        if (!rect || rect.type !== "rect") return s;

        const p1 = s.points[rect.p1];
        const p2 = s.points[rect.p2];
        if (!p1 || !p2) return s;

        const sign = p2.y - p1.y >= 0 ? 1 : -1;

        return {
          points: {
            ...s.points,
            [p2.id]: { id: p2.id, x: p2.x, y: p1.y + sign * newHeight },
          },
        };
      }),

    promptEditDimension: (dimension, currentValue) => {
      const label =
        dimension.kind === "radius"
          ? "raio"
          : dimension.kind === "width"
            ? "largura"
            : dimension.kind === "height"
              ? "altura"
              : "distância";
      const input = window.prompt(`Novo valor de ${label} (mm):`, currentValue.toFixed(2));
      if (input === null) return;
      const value = Number(input.replace(",", "."));
      if (!Number.isFinite(value) || value <= 0) return;

      if (dimension.kind === "radius") get().updateRadiusDimension(dimension.id, value);
      else if (dimension.kind === "width") get().updateWidthDimension(dimension.id, value);
      else if (dimension.kind === "height") get().updateHeightDimension(dimension.id, value);
      else get().updateDistanceDimension(dimension.id, value);
    },

    makeLineHorizontal: (lineId) =>
      set((s) => {
        const line = s.shapes.find((sh) => sh.id === lineId);
        if (!line || line.type !== "line") return s;
        const p1 = s.points[line.p1];
        const p2 = s.points[line.p2];
        if (!p1 || !p2) return s;
        return { points: { ...s.points, [p2.id]: { id: p2.id, x: p2.x, y: p1.y } } };
      }),

    makeLineVertical: (lineId) =>
      set((s) => {
        const line = s.shapes.find((sh) => sh.id === lineId);
        if (!line || line.type !== "line") return s;
        const p1 = s.points[line.p1];
        const p2 = s.points[line.p2];
        if (!p1 || !p2) return s;
        return { points: { ...s.points, [p2.id]: { id: p2.id, x: p1.x, y: p2.y } } };
      }),

    // Gira a linha B (em torno do ponto que ela compartilha com A, se
    // houver — senão em torno do próprio p1 de B) até ficar a 90° de A,
    // escolhendo o lado (+90 ou -90) mais próximo do ângulo atual de B pra
    // não "virar" a linha do avesso sem necessidade.
    makePerpendicular: (lineAId, lineBId) =>
      set((s) => {
        const lineA = s.shapes.find((sh) => sh.id === lineAId);
        const lineB = s.shapes.find((sh) => sh.id === lineBId);
        if (!lineA || lineA.type !== "line" || !lineB || lineB.type !== "line") return s;

        const pA1 = s.points[lineA.p1];
        const pA2 = s.points[lineA.p2];
        if (!pA1 || !pA2) return s;
        const angleA = Math.atan2(pA2.y - pA1.y, pA2.x - pA1.x);

        let pivotId = lineB.p1;
        let movingId = lineB.p2;
        if (lineB.p2 === lineA.p1 || lineB.p2 === lineA.p2) {
          pivotId = lineB.p2;
          movingId = lineB.p1;
        }

        const pivot = s.points[pivotId];
        const moving = s.points[movingId];
        if (!pivot || !moving) return s;

        const length = Math.hypot(moving.x - pivot.x, moving.y - pivot.y);
        if (length < 1e-6) return s;

        const currentAngle = Math.atan2(moving.y - pivot.y, moving.x - pivot.x);
        const target1 = angleA + Math.PI / 2;
        const target2 = angleA - Math.PI / 2;
        const normalize = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
        const targetAngle =
          Math.abs(normalize(target1 - currentAngle)) <= Math.abs(normalize(target2 - currentAngle))
            ? target1
            : target2;

        return {
          points: {
            ...s.points,
            [movingId]: {
              id: movingId,
              x: pivot.x + Math.cos(targetAngle) * length,
              y: pivot.y + Math.sin(targetAngle) * length,
            },
          },
        };
      }),

    // Translada a linha inteira perpendicularmente a ela mesma até a
    // distância até o centro do círculo virar exatamente o raio — mantém o
    // lado em que já estava (não pula pro outro lado do círculo).
    makeTangent: (lineId, circleId) =>
      set((s) => {
        const line = s.shapes.find((sh) => sh.id === lineId);
        const circle = s.shapes.find((sh) => sh.id === circleId);
        if (!line || line.type !== "line" || !circle || circle.type !== "circle") return s;

        const p1 = s.points[line.p1];
        const p2 = s.points[line.p2];
        const center = s.points[circle.center];
        if (!p1 || !p2 || !center) return s;

        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const len = Math.hypot(dx, dy);
        if (len < 1e-6) return s;

        const perpX = -dy / len;
        const perpY = dx / len;

        const toCx = center.x - p1.x;
        const toCy = center.y - p1.y;
        const signedDist = toCx * perpX + toCy * perpY;
        const side = signedDist >= 0 ? 1 : -1;
        const adjustment = circle.radius * side - signedDist;

        return {
          points: {
            ...s.points,
            [p1.id]: { id: p1.id, x: p1.x + perpX * adjustment, y: p1.y + perpY * adjustment },
            [p2.id]: { id: p2.id, x: p2.x + perpX * adjustment, y: p2.y + perpY * adjustment },
          },
        };
      }),

    joinPoints: (keepId, removeId) =>
      set((s) => {
        if (keepId === removeId) return s;
        if (!s.points[keepId] || !s.points[removeId]) return s;

        const remap = (id: string) => (id === removeId ? keepId : id);

        const shapes = s.shapes.map((shape) => {
          if (shape.type === "circle") {
            return shape.center === removeId ? { ...shape, center: keepId } : shape;
          }
          if (shape.type === "point") {
            return shape.pointId === removeId ? { ...shape, pointId: keepId } : shape;
          }
          return { ...shape, p1: remap(shape.p1), p2: remap(shape.p2) };
        });

        const dimensions = s.dimensions.map((dim) =>
          dim.kind === "distance" ? { ...dim, p1: remap(dim.p1), p2: remap(dim.p2) } : dim
        );

        const points = { ...s.points };
        delete points[removeId];

        return { shapes, dimensions, points };
      }),

    convertRectToLines: (rectId) =>
      set((s) => {
        const rect = s.shapes.find((sh) => sh.id === rectId);
        if (!rect || rect.type !== "rect") return s;

        const p1 = s.points[rect.p1];
        const p2 = s.points[rect.p2];
        if (!p1 || !p2) return s;

        const topRightId = createId();
        const bottomLeftId = createId();
        const points = {
          ...s.points,
          [topRightId]: { id: topRightId, x: p2.x, y: p1.y },
          [bottomLeftId]: { id: bottomLeftId, x: p1.x, y: p2.y },
        };

        const newLines: SketchShape[] = [
          { id: createId(), type: "line", p1: rect.p1, p2: topRightId },
          { id: createId(), type: "line", p1: topRightId, p2: rect.p2 },
          { id: createId(), type: "line", p1: rect.p2, p2: bottomLeftId },
          { id: createId(), type: "line", p1: bottomLeftId, p2: rect.p1 },
        ];

        const shapes = [...s.shapes.filter((sh) => sh.id !== rectId), ...newLines];

        // Cotas de largura/altura eram específicas do primitivo — não fazem
        // mais sentido depois de virar 4 linhas soltas. Cotas de distância
        // continuam válidas (os pontos dos cantos originais sobrevivem).
        const dimensions = s.dimensions.filter(
          (d) => !((d.kind === "width" || d.kind === "height") && d.rectId === rectId)
        );

        return {
          shapes,
          dimensions,
          points,
          selectedShapeId: null,
        };
      }),

    clear: () =>
      set({
        shapes: [],
        dimensions: [],
        points: {},
        selectedShapeId: null,
        pendingConstraint: null,
        selectDrag: null,
        dragPreview: {},
        dragRadiusPreview: null,
      }),

    handleRawDown: (raw, referenceGeometry = []) => {
      const { tool, shapes, points } = get();

      if (CLICK_TOOLS.has(tool)) {
        handleConstraintClick(tool, raw, referenceGeometry);
        return;
      }

      if (tool === "select") {
        const nearbyPoint = findNearbyPoint(raw, Object.values(points), SELECT_POINT_TOLERANCE);
        if (nearbyPoint) {
          set({ selectDrag: { mode: "point", pointId: nearbyPoint.id }, downRaw: raw });
          return;
        }

        // Retângulo tem regra própria (aresta = 1 eixo só, interior = mover
        // tudo) — checa antes do caminho genérico de linha/círculo.
        const rectHit = findRectRegion(raw, shapes, points, EDGE_SELECT_TOLERANCE);
        if (rectHit) {
          if (rectHit.region === "edge") {
            set({
              selectedShapeId: rectHit.shapeId,
              selectDrag: {
                mode: "rectEdge",
                shapeId: rectHit.shapeId,
                axis: rectHit.axis,
                corner: rectHit.corner,
              },
              downRaw: raw,
            });
          } else {
            const rect = shapes.find((s) => s.id === rectHit.shapeId);
            if (rect && rect.type === "rect") {
              const pointIds = [rect.p1, rect.p2];
              const startPositions = Object.fromEntries(
                pointIds.map((id) => [id, { x: points[id].x, y: points[id].y }])
              );
              set({
                selectedShapeId: rectHit.shapeId,
                selectDrag: { mode: "translate", pointIds, startPositions },
                downRaw: raw,
              });
            }
          }
          return;
        }

        // Linha solta: perto de uma ponta estica/encolhe só aquele lado,
        // perto do meio move a linha inteira.
        const lineHit = findLineRegion(raw, shapes, points, EDGE_SELECT_TOLERANCE);
        if (lineHit) {
          if (lineHit.region === "end") {
            const anchor = points[lineHit.anchorPointId];
            const originalMoving = points[lineHit.movingPointId];
            const dx = originalMoving.x - anchor.x;
            const dy = originalMoving.y - anchor.y;
            const length = Math.max(Math.hypot(dx, dy), 1e-6);
            set({
              selectedShapeId: lineHit.shapeId,
              selectDrag: {
                mode: "lineEnd",
                movingPointId: lineHit.movingPointId,
                anchor: { x: anchor.x, y: anchor.y },
                direction: { x: dx / length, y: dy / length },
              },
              downRaw: raw,
            });
          } else {
            const startPositions = Object.fromEntries(
              lineHit.pointIds.map((id) => [id, { x: points[id].x, y: points[id].y }])
            );
            set({
              selectedShapeId: lineHit.shapeId,
              selectDrag: { mode: "translate", pointIds: lineHit.pointIds, startPositions },
              downRaw: raw,
            });
          }
          return;
        }

        // Sobrou só círculo: perto do centro já caiu no caminho de "point"
        // acima (move o círculo); perto da borda redimensiona o raio.
        const circleHit = findEdgeHit(
          raw,
          shapes.filter((s) => s.type === "circle"),
          points,
          EDGE_SELECT_TOLERANCE
        );
        const circle = circleHit
          ? (shapes.find((s) => s.id === circleHit.shapeId) as CircleShape | undefined)
          : undefined;
        if (circle) {
          const center = points[circle.center];
          set({
            selectedShapeId: circle.id,
            selectDrag: { mode: "circleRadius", shapeId: circle.id, center: { x: center.x, y: center.y } },
            downRaw: raw,
          });
        } else {
          set({ selectedShapeId: null });
        }
        return;
      }

      if (!DRAG_TOOLS.has(tool)) return;

      const snapped = previewSnap(raw, referenceGeometry);
      set({
        downRaw: raw,
        draftPoint: snapped,
        edgeHitCandidate: tool === "dimension" ? findEdgeHit(raw, shapes, points, EDGE_SELECT_TOLERANCE) : null,
      });
    },

    handleRawMove: (raw, referenceGeometry = []) => {
      const { selectDrag, downRaw, tool, shapes, points } = get();

      if (selectDrag) {
        if (selectDrag.mode === "point") {
          set({ dragPreview: { [selectDrag.pointId]: previewSnap(raw, referenceGeometry) } });
        } else if (selectDrag.mode === "circleRadius") {
          const radius = Math.max(distance(selectDrag.center, raw), 0.5);
          set({ dragRadiusPreview: { shapeId: selectDrag.shapeId, radius } });
        } else if (selectDrag.mode === "rectEdge") {
          const rect = shapes.find((s) => s.id === selectDrag.shapeId);
          if (rect && rect.type === "rect") {
            const cornerPointId = selectDrag.corner === "p1" ? rect.p1 : rect.p2;
            const current = points[cornerPointId];
            const snapped = previewSnap(raw, referenceGeometry);
            set({
              dragPreview: {
                [cornerPointId]:
                  selectDrag.axis === "x" ? { x: snapped.x, y: current.y } : { x: current.x, y: snapped.y },
              },
            });
          }
        } else if (selectDrag.mode === "translate" && downRaw) {
          const dx = raw.x - downRaw.x;
          const dy = raw.y - downRaw.y;
          const preview: Record<string, Point> = {};
          for (const id of selectDrag.pointIds) {
            const start = selectDrag.startPositions[id];
            preview[id] = { x: start.x + dx, y: start.y + dy };
          }
          set({ dragPreview: preview });
        } else if (selectDrag.mode === "lineEnd") {
          // Estica/encolhe só ao longo da direção original da linha — não
          // deixa o ângulo mudar, só o comprimento a partir dessa ponta.
          const { anchor, direction } = selectDrag;
          const projected = (raw.x - anchor.x) * direction.x + (raw.y - anchor.y) * direction.y;
          const clamped = Math.max(projected, 2);
          set({
            dragPreview: {
              [selectDrag.movingPointId]: {
                x: anchor.x + direction.x * clamped,
                y: anchor.y + direction.y * clamped,
              },
            },
          });
        }
        return;
      }

      if (!downRaw) {
        if (tool === "dimension") {
          set({ hoverHit: findEdgeHit(raw, shapes, points, EDGE_SELECT_TOLERANCE) });
        }
        return;
      }

      set({ draftPoint: previewSnap(raw, referenceGeometry) });
    },

    handleRawUp: (rawEnd, referenceGeometry = []) => {
      const { selectDrag, dragPreview, dragRadiusPreview, downRaw, tool, shapes, edgeHitCandidate } = get();

      if (selectDrag) {
        if (selectDrag.mode === "circleRadius" && dragRadiusPreview) {
          get().resizeCircle(dragRadiusPreview.shapeId, dragRadiusPreview.radius);
        } else if (Object.keys(dragPreview).length > 0) {
          get().movePoints(dragPreview);
        }
        set({ selectDrag: null, dragPreview: {}, dragRadiusPreview: null, downRaw: null });
        return;
      }

      if (!downRaw) return;
      const dragDistance = distance(downRaw, rawEnd);

      // Clicar (sem arrastar de verdade) perto de uma linha/aresta/círculo
      // existente cota o elemento inteiro na hora — não precisa mais acertar
      // ponto a ponto. Um arrasto de verdade entre dois pontos ainda cai no
      // caminho de baixo (cota customizada entre pontos quaisquer).
      if (tool === "dimension" && edgeHitCandidate && dragDistance < CLICK_VS_DRAG_THRESHOLD) {
        const dimension = edgeHitToDimension(edgeHitCandidate, shapes);
        if (dimension) get().addDimension(dimension);
        set({ downRaw: null, draftPoint: null, edgeHitCandidate: null });
        return;
      }

      if (dragDistance > 1e-3) {
        if (tool === "dimension") {
          // Só cota se os dois pontos caírem em cima de geometria de
          // verdade (ponto já existente, aresta de uma forma, ou geometria
          // de referência projetada) — resolvePointAt sozinho SEMPRE
          // resolve pra algum ponto (cria um novo no grid se não achar
          // nada perto), o que criava cota "no vazio" a cada arrasto sobre
          // área em branco. "snapped" é exatamente esse sinal: true só
          // quando colou em algo real, não quando só caiu no grid.
          const { points: pts, shapes: shs, gridSize } = get();
          const startSnap = resolveSnapWithEdges(downRaw, pts, shs, referenceGeometry, gridSize, SNAP_TOLERANCE);
          if (startSnap.snapped) {
            const startId = startSnap.existingId ?? get().resolvePointAt(downRaw, SNAP_TOLERANCE, referenceGeometry);
            const circle = findCircleByCenter(get().shapes, startId);
            if (circle) {
              get().addDimension({ id: createId(), kind: "radius", circleId: circle.id });
            } else {
              const endSnap = resolveSnapWithEdges(rawEnd, get().points, get().shapes, referenceGeometry, gridSize, SNAP_TOLERANCE);
              if (endSnap.snapped) {
                const endId = endSnap.existingId ?? get().resolvePointAt(rawEnd, SNAP_TOLERANCE, referenceGeometry);
                if (startId !== endId) {
                  get().addDimension({ id: createId(), kind: "distance", p1: startId, p2: endId });
                }
              }
            }
          }
        } else if (tool === "measure") {
          const { points: pts, shapes: shs, gridSize } = get();
          const start = resolveSnapWithEdges(downRaw, pts, shs, referenceGeometry, gridSize, SNAP_TOLERANCE).point;
          const end = resolveSnapWithEdges(rawEnd, pts, shs, referenceGeometry, gridSize, SNAP_TOLERANCE).point;
          set({ measurement: { x1: start.x, y1: start.y, x2: end.x, y2: end.y } });
        } else {
          const startId = get().resolvePointAt(downRaw, SNAP_TOLERANCE, referenceGeometry);
          const endId = get().resolvePointAt(rawEnd, SNAP_TOLERANCE, referenceGeometry);

          if (tool === "circle") {
            const startPoint = get().points[startId] ?? downRaw;
            const endPoint = get().points[endId] ?? rawEnd;
            const radius = distance(startPoint, endPoint);
            if (radius > 1e-3) {
              get().addShape({ id: createId(), type: "circle", center: startId, radius });
            }
          } else if (tool === "centerline" && startId !== endId) {
            get().addShape({ id: createId(), type: "line", p1: startId, p2: endId, isCenterLine: true });
          } else if ((tool === "line" || tool === "rect") && startId !== endId) {
            get().addShape({ id: createId(), type: tool, p1: startId, p2: endId });
          }
        }
      }

      set({ downRaw: null, draftPoint: null, edgeHitCandidate: null });
    },

    clearHover: () => set({ hoverHit: null, snapIndicator: null }),

    deleteSelectedShape: () => {
      const { selectedShapeId } = get();
      if (!selectedShapeId) return;
      get().removeShape(selectedShapeId);
      set({ selectedShapeId: null });
    },
  };
});
