import { create } from "zustand";
import { BASE_SKETCH_PLANE } from "./types";
import type {
  CircleShape,
  DimensionAnnotation,
  EdgeRef,
  Point,
  SketchPlane,
  SketchPoint,
  SketchShape,
  SketchTool,
} from "./types";
import { findNearbyPoint, resolveSnapWithEdges } from "./snap";
import { findEdgeHit, findLineRegion, findRectRegion, projectOntoSegment, type EdgeHit } from "./hitTest";
import {
  findCircleByCenter,
  findArcByCenter,
  findSlotByCenter,
  edgeHitToDimension,
  resolveDimension,
  createId,
  distance,
  perpendicularDistanceToLine,
  computeDimensionLineGeometry,
  computeRadiusDimensionGeometry,
  DEFAULT_DIM_OFFSET,
  RADIUS_DIM_DIR,
} from "./render";
import { findCornerNear, computeFillet, computeChamfer } from "./filletChamfer";
import { DRAG_TOOLS, CLICK_TOOLS, SLOT_TOOLS } from "./tools";

// Tolerâncias em mm (unidades de mundo do plano do sketch) — as mesmas,
// independente de quem gerou o "raw" (SVG 2D via CTM, ou raycast num plano
// 3D via worldToLocalPoint), por isso moraram aqui e não numa view.
const SNAP_TOLERANCE = 6;
const EDGE_SELECT_TOLERANCE = 8;
const SELECT_POINT_TOLERANCE = 8;
const CLICK_VS_DRAG_THRESHOLD = 4;

export type ReferenceSegment = { x1: number; y1: number; x2: number; y2: number };

// Recorte de copiar/colar: uma forma + os pontos que ela referencia,
// clonados (não é uma referência viva pro shape/pontos originais — copiar,
// apagar o original e colar continua funcionando). pasteCount conta quantas
// vezes já colou desde a última cópia, pra cada colagem subsequente
// deslocar um pouco mais (evita empilhar exatamente em cima da anterior).
type SketchClipboard = { shape: SketchShape; points: SketchPoint[]; pasteCount: number };

// Ids de ponto que uma forma referencia — central pra copiar/colar (clonar
// só os pontos realmente usados) e reaproveitável se mais operações em lote
// precisarem disso no futuro.
function pointIdsOfShape(shape: SketchShape): string[] {
  switch (shape.type) {
    case "line":
      return [shape.p1, shape.p2];
    case "rect":
      return [shape.p1, shape.p2];
    case "circle":
      return [shape.center];
    case "point":
      return [shape.pointId];
    case "arc":
      return [shape.p1, shape.p2, shape.center];
    case "slot":
      return [shape.center1, shape.center2];
  }
}

// Devolve uma cópia da forma com novo id e os ids de ponto trocados
// conforme idMap (ponto antigo → novo) — usado só na colagem, depois que os
// pontos clonados já ganharam seus próprios ids novos.
function remapShapePoints(shape: SketchShape, newId: string, idMap: Map<string, string>): SketchShape {
  const remap = (pointId: string) => idMap.get(pointId) ?? pointId;
  switch (shape.type) {
    case "line":
      return { ...shape, id: newId, p1: remap(shape.p1), p2: remap(shape.p2) };
    case "rect":
      return { ...shape, id: newId, p1: remap(shape.p1), p2: remap(shape.p2) };
    case "circle":
      return { ...shape, id: newId, center: remap(shape.center) };
    case "point":
      return { ...shape, id: newId, pointId: remap(shape.pointId) };
    case "arc":
      return { ...shape, id: newId, p1: remap(shape.p1), p2: remap(shape.p2), center: remap(shape.center) };
    case "slot":
      return { ...shape, id: newId, center1: remap(shape.center1), center2: remap(shape.center2) };
  }
}

// Cota clicada perto o bastante da sua PRÓPRIA linha de cota (já deslocada
// pelo offset atual, não a geometria medida) — usado só pela ferramenta
// Selecionar pra iniciar o arrasto do offset. Roda ANTES do resto da
// cascata de seleção (ponto/retângulo/linha/círculo) pra uma cota não ficar
// "atrás" da geometria que ela mede, já que a linha de cota normalmente
// fica bem perto dela.
type DimensionHit = { dimensionId: string; nx: number; ny: number; startOffset: number };

function findDimensionHit(
  raw: Point,
  dimensions: DimensionAnnotation[],
  shapes: SketchShape[],
  points: Record<string, SketchPoint>,
  tolerance: number
): DimensionHit | null {
  let best: DimensionHit | null = null;
  let bestDist = tolerance;

  for (const dim of dimensions) {
    const render = resolveDimension(dim, shapes, points);
    if (!render) continue;
    const offset = dim.offset ?? DEFAULT_DIM_OFFSET;

    if (render.kind === "radius") {
      const geo = computeRadiusDimensionGeometry(render.cx, render.cy, render.r, offset);
      const { distance: d } = projectOntoSegment(raw, geo.edge, geo.tip);
      if (d < bestDist) {
        bestDist = d;
        best = { dimensionId: dim.id, nx: RADIUS_DIM_DIR.x, ny: RADIUS_DIM_DIR.y, startOffset: offset };
      }
      continue;
    }

    const geo = computeDimensionLineGeometry({ x: render.x1, y: render.y1 }, { x: render.x2, y: render.y2 }, offset);
    if (!geo) continue;
    const { distance: d } = projectOntoSegment(raw, geo.dimA, geo.dimB);
    if (d < bestDist) {
      bestDist = d;
      best = { dimensionId: dim.id, nx: geo.nx, ny: geo.ny, startOffset: offset };
    }
  }

  return best;
}

// Só arestas retas entram no fluxo de 2 cliques (cota relacional linha a
// linha) — raio de círculo/arco/rasgo continua cotando na hora, num clique
// só (ver handleRawUp). dimensionPick1 guarda sempre esse tipo restrito
// (nunca um hit de raio), garantido pelo type guard abaixo em todo ponto
// que escreve nesse campo.
type LineLikeEdgeHit = Extract<EdgeHit, { kind: "line" | "rectWidth" | "rectHeight" | "slotLength" }>;

function isLineLikeHit(hit: EdgeHit): hit is LineLikeEdgeHit {
  return hit.kind === "line" || hit.kind === "rectWidth" || hit.kind === "rectHeight" || hit.kind === "slotLength";
}

function rotatePoint2D(p: Point, center: Point, angleDeg: number): Point {
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  return { x: center.x + dx * cos - dy * sin, y: center.y + dx * sin + dy * cos };
}

// Duas capturas da MESMA aresta física (não só a mesma forma — um
// retângulo/rasgo tem 2 arestas paralelas com o mesmo shapeId, mas
// fisicamente diferentes, daí checar edge/side também).
function sameEdgeHit(a: LineLikeEdgeHit, b: EdgeHit): boolean {
  if (a.kind !== b.kind || a.shapeId !== b.shapeId) return false;
  if (a.kind === "rectWidth" && b.kind === "rectWidth") return a.edge === b.edge;
  if (a.kind === "rectHeight" && b.kind === "rectHeight") return a.edge === b.edge;
  if (a.kind === "slotLength" && b.kind === "slotLength") return a.side === b.side;
  return true;
}

function edgeHitToEdgeRef(hit: LineLikeEdgeHit): EdgeRef {
  if (hit.kind === "line") return { kind: "line", lineId: hit.shapeId };
  if (hit.kind === "rectWidth") return { kind: "rectEdge", rectId: hit.shapeId, axis: "width", edge: hit.edge };
  if (hit.kind === "rectHeight") return { kind: "rectEdge", rectId: hit.shapeId, axis: "height", edge: hit.edge };
  return { kind: "slotTangent", slotId: hit.shapeId, side: hit.side };
}

function edgeRefReferencesShape(ref: EdgeRef, shapeId: string): boolean {
  if (ref.kind === "line") return ref.lineId === shapeId;
  if (ref.kind === "rectEdge") return ref.rectId === shapeId;
  return ref.slotId === shapeId;
}

// Move a geometria que um EdgeRef aponta por (dx,dy) — usado ao editar uma
// cota "edgeDistance": a aresta `a` (1ª escolhida) fica parada, só `b`
// (2ª) se mexe, mesmo espírito de updateDistanceDimension (p1 fixo, p2
// anda). Cada kind de EdgeRef vira uma operação diferente na geometria
// real por trás: linha solta translada os 2 pontos; aresta de retângulo só
// move o canto correspondente (equivalente a updateWidth/HeightDimension,
// mas podendo mover o canto p1 OU p2 conforme qual aresta foi clicada);
// tangente de rasgo vira ajuste direto do campo radius (a distância que a
// tangente anda de seu próprio eixo É o raio).
function translateEdgeRef(
  ref: EdgeRef,
  dx: number,
  dy: number,
  shapes: SketchShape[],
  points: Record<string, SketchPoint>
): { points: Record<string, SketchPoint> } | { shapes: SketchShape[] } | null {
  if (ref.kind === "line") {
    const line = shapes.find((s) => s.id === ref.lineId);
    if (!line || line.type !== "line") return null;
    const p1 = points[line.p1];
    const p2 = points[line.p2];
    if (!p1 || !p2) return null;
    return {
      points: {
        ...points,
        [p1.id]: { id: p1.id, x: p1.x + dx, y: p1.y + dy },
        [p2.id]: { id: p2.id, x: p2.x + dx, y: p2.y + dy },
      },
    };
  }

  if (ref.kind === "rectEdge") {
    const rect = shapes.find((s) => s.id === ref.rectId);
    if (!rect || rect.type !== "rect") return null;
    const cornerId = ref.edge === "p1" ? rect.p1 : rect.p2;
    const corner = points[cornerId];
    if (!corner) return null;
    return { points: { ...points, [cornerId]: { id: cornerId, x: corner.x + dx, y: corner.y + dy } } };
  }

  // slotTangent: a distância que a tangente anda na direção normal do
  // próprio rasgo é diretamente a variação do raio.
  const slot = shapes.find((s) => s.id === ref.slotId);
  if (!slot || slot.type !== "slot") return null;
  const c1 = points[slot.center1];
  const c2 = points[slot.center2];
  if (!c1 || !c2) return null;
  const axisDx = c2.x - c1.x;
  const axisDy = c2.y - c1.y;
  const axisLen = Math.hypot(axisDx, axisDy) || 1;
  const nx = (-axisDy / axisLen) * ref.side;
  const ny = (axisDx / axisLen) * ref.side;
  const newRadius = Math.max(slot.radius + (dx * nx + dy * ny), 0.5);
  return { shapes: shapes.map((s) => (s.id === slot.id ? { ...s, radius: newRadius } : s)) };
}

// Deslocamento (mm) aplicado a cada colagem sucessiva, multiplicado pelo
// número de vezes já colado — a 1ª colagem sai 12mm da original, a 2ª
// 24mm, etc., em vez de empilhar tudo no mesmo lugar.
const PASTE_OFFSET_STEP = 12;

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

// Estado transitório da ferramenta Rasgo, entre os 3 passos (clique, clique,
// arrasto). "centerToCenter"/"centerPoint" guardam o que falta pro 1º clique
// da variante em questão; "ready" é o estado comum às duas variantes assim
// que os dois centros já foram resolvidos — só falta o arrasto do raio
// (reaproveita downRaw/draftPoint genéricos pra isso, ver handleRawMove/Up).
export type PendingSlot =
  | { kind: "centerToCenter"; center1Id: string }
  | { kind: "centerPoint"; midpoint: Point }
  | { kind: "ready"; center1Id: string; center2Id: string };

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
  // 1ª aresta reta escolhida pela ferramenta Cota, aguardando uma 2ª (ao
  // estilo Inventor: clicar aresta A, depois aresta B, dá a distância entre
  // as duas) — só usado pra kinds "line"/"rectWidth"/"rectHeight"/
  // "slotLength"; raio de círculo/arco/rasgo continua cotando na hora, num
  // clique só, sem passar por aqui (ver handleRawUp).
  dimensionPick1: LineLikeEdgeHit | null;
  snapIndicator: Point | null;
  selectDrag: SelectDrag | null;
  dragPreview: Record<string, Point>;
  dragRadiusPreview: { shapeId: string; radius: number } | null;
  selectedShapeId: string | null;
  // Arrasto do OFFSET de uma cota (linha de cota puxada pra longe/perto da
  // geometria medida) — independente de selectDrag (que é sobre pontos/
  // formas), mas roteado pelos MESMOS handleRawDown/Move/Up, então não
  // precisa de nenhum mesh 3D próprio pra captar o clique (ver
  // findDimensionHit) — reaproveita o InteractivePlane que já existe.
  dimensionDrag: { dimensionId: string; nx: number; ny: number; startOffset: number; startRaw: Point } | null;
  dimensionDragPreview: number | null;
  pendingConstraint: PendingConstraint | null;
  pendingSlot: PendingSlot | null;
  clipboard: SketchClipboard | null;

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
  // Move p1/p2 do arco ao longo da direção atual até center (mantém o
  // ângulo, só muda a distância) — diferente do círculo, o arco não tem um
  // campo .radius próprio pra só trocar; as linhas aparadas vizinhas
  // compartilham esses mesmos ids de ponto, então acompanham o novo raio.
  updateArcRadiusDimension: (id: string, newRadius: number) => void;
  // Estruturalmente igual a updateRadiusDimension — SlotShape guarda radius
  // direto, igual círculo.
  updateSlotRadiusDimension: (id: string, newRadius: number) => void;
  // Cota entre 2 arestas escolhidas (linha a linha) — a aresta `a` (1ª
  // escolhida) fica parada, só a `b` (2ª) se move pra atingir o novo valor
  // (ver translateEdgeRef).
  updateEdgeDistanceDimension: (id: string, newValue: number) => void;
  updateWidthDimension: (id: string, newWidth: number) => void;
  updateHeightDimension: (id: string, newHeight: number) => void;
  // Distância da linha de cota até a geometria medida (arrastável, ver
  // DimensionOffsetHandle em SketchOverlay3D.tsx) — não muda o VALOR
  // medido, só onde a linha/seta/rótulo aparecem. Serve pra qualquer kind
  // de cota (todas ganharam o campo offset).
  updateDimensionOffset: (id: string, offset: number) => void;
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
  // Clona a forma selecionada (+ pontos que ela usa) pro clipboard — não
  // depende da área de transferência do sistema operacional, só do estado
  // do sketch (mais simples e funciona igual em qualquer navegador).
  copySelectedShape: () => void;
  // Cria uma nova forma a partir do clipboard, deslocada um pouco da
  // posição original, e já seleciona ela. Sem efeito se nunca copiou nada.
  pasteShape: () => void;
  // Padrão retangular/circular da forma selecionada — ação de UM disparo
  // (igual copiar/colar): gera as cópias na hora e pronto, não é uma
  // feature paramétrica reeditável depois (o esboço 2D não tem árvore de
  // histórico própria, só a lista de shapes). dir1/dir2 já vêm normalizados
  // (ver AXIS_VECTORS_2D no componente); count2/spacing2 ausentes = só 1
  // direção.
  patternShapeRectangular: (shapeId: string, dir1: Point, count1: number, spacing1: number, dir2?: Point, count2?: number, spacing2?: number) => void;
  // angle = ângulo TOTAL varrido pelas `count` instâncias (360 = volta
  // completa, espaçamento angle/count; menor = leque, espaçamento
  // angle/(count-1)).
  patternShapeCircular: (shapeId: string, center: Point, count: number, angle: number) => void;
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

  // Passos 1 e 2 (cliques) da ferramenta Rasgo — o 3º passo (arrasto do
  // raio) não passa por aqui: assim que pendingSlot chega em "ready", esse
  // clique só arma downRaw e a máquina genérica de downRaw/draftPoint (já
  // usada por qualquer ferramenta de arrasto) cuida do preview; handleRawUp
  // finaliza olhando pendingSlot.kind === "ready" explicitamente.
  function handleSlotDown(tool: SketchTool, raw: Point, referenceGeometry: ReferenceSegment[]) {
    const { pendingSlot } = get();

    if (!pendingSlot) {
      if (tool === "slotCenterToCenter") {
        const center1Id = get().resolvePointAt(raw, SNAP_TOLERANCE, referenceGeometry);
        set({ pendingSlot: { kind: "centerToCenter", center1Id } });
      } else {
        // "centerPoint": o ponto médio não é referenciado pelo SlotShape
        // final (só center1/center2 são), então não vira ponto persistente
        // — só a coordenada (com snap) fica guardada, usada na hora de
        // espelhar a extremidade oposta no 2º clique.
        const midpoint = previewSnap(raw, referenceGeometry);
        set({ pendingSlot: { kind: "centerPoint", midpoint } });
      }
      return;
    }

    if (pendingSlot.kind === "centerToCenter") {
      const center2Id = get().resolvePointAt(raw, SNAP_TOLERANCE, referenceGeometry);
      if (center2Id === pendingSlot.center1Id) return; // eixo de comprimento zero, ignora
      set({ pendingSlot: { kind: "ready", center1Id: pendingSlot.center1Id, center2Id } });
      return;
    }

    if (pendingSlot.kind === "centerPoint") {
      const endId = get().resolvePointAt(raw, SNAP_TOLERANCE, referenceGeometry);
      const end = get().points[endId];
      const { midpoint } = pendingSlot;
      if (!end) return;
      const mirrorPos = { x: 2 * midpoint.x - end.x, y: 2 * midpoint.y - end.y };
      const mirrorId = get().resolvePointAt(mirrorPos, SNAP_TOLERANCE, referenceGeometry);
      if (mirrorId === endId) return; // extremidade clicada em cima do ponto médio, ignora
      set({ pendingSlot: { kind: "ready", center1Id: endId, center2Id: mirrorId } });
      return;
    }

    // kind === "ready": inicia o arrasto do raio.
    set({ downRaw: raw });
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
    dimensionPick1: null,
    snapIndicator: null,
    selectDrag: null,
    dragPreview: {},
    dragRadiusPreview: null,
    selectedShapeId: null,
    dimensionDrag: null,
    dimensionDragPreview: null,
    pendingConstraint: null,
    pendingSlot: null,
    clipboard: null,

    setTool: (tool) =>
      set((s) => ({
        tool,
        measurement: tool === "measure" ? s.measurement : null,
        hoverHit: tool === "dimension" ? s.hoverHit : null,
        dimensionPick1: tool === "dimension" ? s.dimensionPick1 : null,
        selectDrag: tool === "select" ? s.selectDrag : null,
        dragPreview: tool === "select" ? s.dragPreview : {},
        dragRadiusPreview: tool === "select" ? s.dragRadiusPreview : null,
        selectedShapeId: tool === "select" ? s.selectedShapeId : null,
        pendingConstraint: null,
        pendingSlot: null,
        downRaw: null,
        draftPoint: null,
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
          if (d.kind === "arcRadius") return d.arcId !== id;
          if (d.kind === "slotRadius") return d.slotId !== id;
          if (d.kind === "width" || d.kind === "height") return d.rectId !== id;
          if (d.kind === "edgeDistance") {
            return !edgeRefReferencesShape(d.a, id) && !edgeRefReferencesShape(d.b, id);
          }
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

    updateArcRadiusDimension: (id, newRadius) =>
      set((s) => {
        const dim = s.dimensions.find((d) => d.id === id);
        if (!dim || dim.kind !== "arcRadius" || newRadius <= 0) return s;

        const arc = s.shapes.find((sh) => sh.id === dim.arcId);
        if (!arc || arc.type !== "arc") return s;

        const center = s.points[arc.center];
        const p1 = s.points[arc.p1];
        const p2 = s.points[arc.p2];
        if (!center || !p1 || !p2) return s;

        const moveToRadius = (p: SketchPoint): SketchPoint => {
          const dx = p.x - center.x;
          const dy = p.y - center.y;
          const len = Math.hypot(dx, dy);
          if (len < 1e-6) return p;
          return { id: p.id, x: center.x + (dx / len) * newRadius, y: center.y + (dy / len) * newRadius };
        };

        const newP1 = moveToRadius(p1);
        const newP2 = moveToRadius(p2);

        return {
          points: { ...s.points, [newP1.id]: newP1, [newP2.id]: newP2 },
        };
      }),

    updateSlotRadiusDimension: (id, newRadius) =>
      set((s) => {
        const dim = s.dimensions.find((d) => d.id === id);
        if (!dim || dim.kind !== "slotRadius" || newRadius <= 0) return s;

        return {
          shapes: s.shapes.map((shape) =>
            shape.type === "slot" && shape.id === dim.slotId
              ? { ...shape, radius: newRadius }
              : shape
          ),
        };
      }),

    updateEdgeDistanceDimension: (id, newValue) =>
      set((s) => {
        const dim = s.dimensions.find((d) => d.id === id);
        if (!dim || dim.kind !== "edgeDistance" || newValue <= 0) return s;

        const render = resolveDimension(dim, s.shapes, s.points);
        if (!render || render.kind !== "distance") return s;

        const dx = render.x2 - render.x1;
        const dy = render.y2 - render.y1;
        const curDist = Math.hypot(dx, dy);
        if (curDist < 1e-6) return s;

        const delta = newValue - curDist;
        const ux = dx / curDist;
        const uy = dy / curDist;

        const patch = translateEdgeRef(dim.b, delta * ux, delta * uy, s.shapes, s.points);
        return patch ?? s;
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

    updateDimensionOffset: (id, offset) =>
      set((s) => ({
        dimensions: s.dimensions.map((d) => (d.id === id ? { ...d, offset } : d)),
      })),

    promptEditDimension: (dimension, currentValue) => {
      const label =
        dimension.kind === "radius" || dimension.kind === "arcRadius" || dimension.kind === "slotRadius"
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
      else if (dimension.kind === "arcRadius") get().updateArcRadiusDimension(dimension.id, value);
      else if (dimension.kind === "slotRadius") get().updateSlotRadiusDimension(dimension.id, value);
      else if (dimension.kind === "width") get().updateWidthDimension(dimension.id, value);
      else if (dimension.kind === "height") get().updateHeightDimension(dimension.id, value);
      else if (dimension.kind === "edgeDistance") get().updateEdgeDistanceDimension(dimension.id, value);
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
          if (shape.type === "slot") {
            return { ...shape, center1: remap(shape.center1), center2: remap(shape.center2) };
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
        pendingSlot: null,
        dimensionPick1: null,
        selectDrag: null,
        dragPreview: {},
        dragRadiusPreview: null,
        dimensionDrag: null,
        dimensionDragPreview: null,
      }),

    handleRawDown: (raw, referenceGeometry = []) => {
      const { tool, shapes, points, dimensions } = get();

      if (CLICK_TOOLS.has(tool)) {
        handleConstraintClick(tool, raw, referenceGeometry);
        return;
      }

      if (SLOT_TOOLS.has(tool)) {
        handleSlotDown(tool, raw, referenceGeometry);
        return;
      }

      if (tool === "select") {
        // Cota clicada perto da própria linha (já deslocada pelo offset)
        // arma o arrasto do offset — checado ANTES do resto (ponto/
        // retângulo/linha/círculo), já que a linha de cota normalmente fica
        // por cima ou bem perto da geometria que ela mede.
        const dimHit = findDimensionHit(raw, dimensions, shapes, points, EDGE_SELECT_TOLERANCE);
        if (dimHit) {
          set({ dimensionDrag: { ...dimHit, startRaw: raw }, downRaw: raw });
          return;
        }

        // Círculo pequeno (raio menor que a tolerância de ponto) tem a
        // borda INTEIRA dentro do halo de 8mm do centro — o teste de
        // "perto de um ponto" abaixo vencia sempre, então clicar na borda
        // só arrastava o centro (movia a forma inteira), nunca reduzia o
        // raio. Decide ANTES, por proximidade RELATIVA (mais perto da
        // borda que do centro), não por tolerância absoluta — assim
        // funciona pra círculo de qualquer tamanho: só um clique
        // genuinamente mais perto do centro vira "mover", o resto da área
        // dentro da tolerância da borda vira "redimensionar".
        let bestCircleEdge: { shape: CircleShape; center: Point; dist: number } | null = null;
        for (const shape of shapes) {
          if (shape.type !== "circle") continue;
          const center = points[shape.center];
          if (!center) continue;
          const dCenter = distance(raw, center);
          const dEdge = Math.abs(dCenter - shape.radius);
          if (dEdge < dCenter && dEdge <= EDGE_SELECT_TOLERANCE && (!bestCircleEdge || dEdge < bestCircleEdge.dist)) {
            bestCircleEdge = { shape, center: { x: center.x, y: center.y }, dist: dEdge };
          }
        }
        if (bestCircleEdge) {
          set({
            selectedShapeId: bestCircleEdge.shape.id,
            selectDrag: { mode: "circleRadius", shapeId: bestCircleEdge.shape.id, center: bestCircleEdge.center },
            downRaw: raw,
          });
          return;
        }

        const nearbyPoint = findNearbyPoint(raw, Object.values(points), SELECT_POINT_TOLERANCE);
        if (nearbyPoint) {
          // Esse ponto vencia QUALQUER forma antes de chegar no teste
          // específico de círculo/linha/retângulo mais abaixo — pra um
          // círculo, cujo único ponto é o próprio centro, isso significava
          // nunca marcar selectedShapeId ao clicar nele (só arrastava o
          // ponto cru), quebrando Copiar/Excluir/Padrão nele. Resolve o
          // "dono" do ponto agora: se só 1 forma o referencia (círculo,
          // ponto solto, ou uma linha cuja ponta ninguém mais compartilha),
          // seleciona ela também; ponto compartilhado por 2+ formas (junção
          // entre linhas) fica ambíguo, desseleciona.
          const owners = shapes.filter((sh) => pointIdsOfShape(sh).includes(nearbyPoint.id));
          set({
            selectDrag: { mode: "point", pointId: nearbyPoint.id },
            downRaw: raw,
            selectedShapeId: owners.length === 1 ? owners[0].id : null,
          });
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

        // Nada bateu (nem borda de círculo, nem ponto, nem retângulo, nem
        // linha) — clique em espaço vazio, desseleciona.
        set({ selectedShapeId: null });
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
      const { selectDrag, downRaw, tool, shapes, points, dimensionDrag } = get();

      if (dimensionDrag) {
        const delta = (raw.x - dimensionDrag.startRaw.x) * dimensionDrag.nx + (raw.y - dimensionDrag.startRaw.y) * dimensionDrag.ny;
        set({ dimensionDragPreview: dimensionDrag.startOffset + delta });
        return;
      }

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
        } else if (SLOT_TOOLS.has(tool)) {
          // Passos 1/2 (antes do arrasto): sem downRaw ainda, mas o preview
          // ao vivo (linha de borracha até o cursor) reaproveita draftPoint
          // do mesmo jeito que o arrasto do raio faz mais adiante.
          set({ draftPoint: previewSnap(raw, referenceGeometry) });
        }
        return;
      }

      set({ draftPoint: previewSnap(raw, referenceGeometry) });
    },

    handleRawUp: (rawEnd, referenceGeometry = []) => {
      const {
        selectDrag,
        dragPreview,
        dragRadiusPreview,
        downRaw,
        tool,
        shapes,
        edgeHitCandidate,
        pendingSlot,
        dimensionDrag,
        dimensionDragPreview,
      } = get();

      if (dimensionDrag) {
        if (dimensionDragPreview !== null) {
          get().updateDimensionOffset(dimensionDrag.dimensionId, dimensionDragPreview);
        }
        set({ dimensionDrag: null, dimensionDragPreview: null, downRaw: null });
        return;
      }

      if (SLOT_TOOLS.has(tool)) {
        // Só o 3º passo (arrasto do raio, pendingSlot já em "ready") solta
        // algo aqui — os 2 primeiros cliques são resolvidos inteiramente em
        // handleSlotDown, sem passar por downRaw.
        if (pendingSlot?.kind === "ready" && downRaw) {
          const c1 = get().points[pendingSlot.center1Id];
          const c2 = get().points[pendingSlot.center2Id];
          if (c1 && c2) {
            const radius = perpendicularDistanceToLine(rawEnd, c1, c2);
            if (radius > 0.5) {
              get().addShape({
                id: createId(),
                type: "slot",
                center1: pendingSlot.center1Id,
                center2: pendingSlot.center2Id,
                radius,
              });
              set({ pendingSlot: null });
            }
          }
          set({ downRaw: null, draftPoint: null });
        }
        return;
      }

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
      //
      // Arestas retas (linha/aresta de retângulo/tangente de rasgo) passam
      // por um 2º passo opcional, ao estilo Inventor: clicar a 1ª só
      // "arma" a seleção (dimensionPick1); clicar uma 2ª aresta diferente
      // dá a distância ENTRE as duas (ex.: as 2 tangentes de um rasgo =
      // largura dele, ou as 2 arestas de largura de um retângulo = altura)
      // em vez da cota natural de cada uma isolada. Raio de círculo/arco/
      // rasgo continua instantâneo num clique só, sem essa espera.
      if (tool === "dimension" && dragDistance < CLICK_VS_DRAG_THRESHOLD) {
        const { dimensionPick1 } = get();

        if (dimensionPick1) {
          if (!edgeHitCandidate || sameEdgeHit(dimensionPick1, edgeHitCandidate)) {
            const dimension = edgeHitToDimension(dimensionPick1, shapes);
            if (dimension) get().addDimension(dimension);
          } else if (isLineLikeHit(edgeHitCandidate)) {
            get().addDimension({
              id: createId(),
              kind: "edgeDistance",
              a: edgeHitToEdgeRef(dimensionPick1),
              b: edgeHitToEdgeRef(edgeHitCandidate),
            });
          } else {
            // 2º clique caiu num raio (círculo/arco/rasgo) — não dá pra
            // relacionar com a aresta pendente, descarta a espera e cota o
            // raio na hora, comportamento instantâneo de sempre.
            const dimension = edgeHitToDimension(edgeHitCandidate, shapes);
            if (dimension) get().addDimension(dimension);
          }
          set({ dimensionPick1: null, downRaw: null, draftPoint: null, edgeHitCandidate: null });
          return;
        }

        if (edgeHitCandidate) {
          if (isLineLikeHit(edgeHitCandidate)) {
            set({ dimensionPick1: edgeHitCandidate, downRaw: null, draftPoint: null, edgeHitCandidate: null });
            return;
          }
          const dimension = edgeHitToDimension(edgeHitCandidate, shapes);
          if (dimension) get().addDimension(dimension);
          set({ downRaw: null, draftPoint: null, edgeHitCandidate: null });
          return;
        }
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
            const arc = circle ? null : findArcByCenter(get().shapes, startId);
            const slot = circle || arc ? null : findSlotByCenter(get().shapes, startId);
            if (circle) {
              get().addDimension({ id: createId(), kind: "radius", circleId: circle.id });
            } else if (arc) {
              get().addDimension({ id: createId(), kind: "arcRadius", arcId: arc.id });
            } else if (slot) {
              get().addDimension({ id: createId(), kind: "slotRadius", slotId: slot.id });
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

    copySelectedShape: () => {
      const { shapes, points, selectedShapeId } = get();
      const shape = shapes.find((s) => s.id === selectedShapeId);
      if (!shape) return;
      const clonedPoints = pointIdsOfShape(shape)
        .map((id) => points[id])
        .filter((p): p is SketchPoint => p !== undefined);
      set({ clipboard: { shape, points: clonedPoints, pasteCount: 0 } });
    },

    pasteShape: () => {
      const { clipboard } = get();
      if (!clipboard) return;

      const offset = PASTE_OFFSET_STEP * (clipboard.pasteCount + 1);
      const idMap = new Map<string, string>();
      const newPoints: Record<string, SketchPoint> = {};
      for (const p of clipboard.points) {
        const newId = createId();
        idMap.set(p.id, newId);
        newPoints[newId] = { id: newId, x: p.x + offset, y: p.y + offset };
      }
      const newShape = remapShapePoints(clipboard.shape, createId(), idMap);

      set((s) => ({
        points: { ...s.points, ...newPoints },
        shapes: [...s.shapes, newShape],
        selectedShapeId: newShape.id,
        clipboard: { ...clipboard, pasteCount: clipboard.pasteCount + 1 },
      }));
    },

    patternShapeRectangular: (shapeId, dir1, count1, spacing1, dir2, count2, spacing2) => {
      const { shapes, points } = get();
      const shape = shapes.find((s) => s.id === shapeId);
      if (!shape) return;
      const sourcePointIds = pointIdsOfShape(shape);
      const sourcePoints = sourcePointIds.map((id) => points[id]).filter((p): p is SketchPoint => p !== undefined);
      if (sourcePoints.length === 0) return;

      const n1 = Math.max(1, Math.round(count1));
      const n2 = dir2 && count2 ? Math.max(1, Math.round(count2)) : 1;
      const newPoints: Record<string, SketchPoint> = {};
      const newShapes: SketchShape[] = [];

      for (let i = 0; i < n1; i++) {
        for (let j = 0; j < n2; j++) {
          if (i === 0 && j === 0) continue; // original já existe
          const dx = dir1.x * spacing1 * i + (dir2 ? dir2.x * (spacing2 ?? 0) * j : 0);
          const dy = dir1.y * spacing1 * i + (dir2 ? dir2.y * (spacing2 ?? 0) * j : 0);
          const idMap = new Map<string, string>();
          for (const p of sourcePoints) {
            const newId = createId();
            idMap.set(p.id, newId);
            newPoints[newId] = { id: newId, x: p.x + dx, y: p.y + dy };
          }
          newShapes.push(remapShapePoints(shape, createId(), idMap));
        }
      }

      set((s) => ({
        points: { ...s.points, ...newPoints },
        shapes: [...s.shapes, ...newShapes],
      }));
    },

    patternShapeCircular: (shapeId, center, count, angle) => {
      const { shapes, points } = get();
      const shape = shapes.find((s) => s.id === shapeId);
      if (!shape) return;
      const sourcePointIds = pointIdsOfShape(shape);
      const sourcePoints = sourcePointIds.map((id) => points[id]).filter((p): p is SketchPoint => p !== undefined);
      if (sourcePoints.length === 0) return;

      const n = Math.max(1, Math.round(count));
      if (n <= 1) return;
      const fullTurn = Math.abs(angle - 360) < 1e-6;
      const step = fullTurn ? angle / n : angle / (n - 1);

      const newPoints: Record<string, SketchPoint> = {};
      const newShapes: SketchShape[] = [];
      for (let i = 1; i < n; i++) {
        const idMap = new Map<string, string>();
        for (const p of sourcePoints) {
          const newId = createId();
          idMap.set(p.id, newId);
          const rotated = rotatePoint2D({ x: p.x, y: p.y }, center, step * i);
          newPoints[newId] = { id: newId, x: rotated.x, y: rotated.y };
        }
        newShapes.push(remapShapePoints(shape, createId(), idMap));
      }

      set((s) => ({
        points: { ...s.points, ...newPoints },
        shapes: [...s.shapes, ...newShapes],
      }));
    },
  };
});
