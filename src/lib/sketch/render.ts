import type { EdgeHit } from "./hitTest";
import type {
  ArcShape,
  CircleShape,
  DimensionAnnotation,
  EdgeRef,
  Point,
  RectShape,
  SketchPoint,
  SketchShape,
  SketchTool,
  SlotShape,
} from "./types";

// Funções puras de resolução de geometria/cota — sem JSX, sem estado —
// compartilhadas pelo editor 2D (SVG) e pelo overlay 3D (Three.js), pra não
// duplicar a mesma lógica em dois lugares que podem divergir com o tempo.

export function createId() {
  return Math.random().toString(36).slice(2, 10);
}

export function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// Distância perpendicular de p até a reta INFINITA que passa por a-b (não o
// segmento) — usada pelo 3º passo (arrasto) da ferramenta Rasgo pra definir
// o raio a partir de qualquer ponto ao lado do eixo, mesmo além das pontas.
export function perpendicularDistanceToLine(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number }
) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return distance(p, a);
  return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
}

export function findCircleByCenter(shapes: SketchShape[], centerId: string): CircleShape | null {
  return (
    shapes.find((s): s is CircleShape => s.type === "circle" && s.center === centerId) ?? null
  );
}

export function findArcByCenter(shapes: SketchShape[], centerId: string): ArcShape | null {
  return shapes.find((s): s is ArcShape => s.type === "arc" && s.center === centerId) ?? null;
}

export function findSlotByCenter(shapes: SketchShape[], centerId: string): SlotShape | null {
  return (
    shapes.find(
      (s): s is SlotShape => s.type === "slot" && (s.center1 === centerId || s.center2 === centerId)
    ) ?? null
  );
}

export type DimensionRender =
  | { kind: "distance"; x1: number; y1: number; x2: number; y2: number }
  | { kind: "radius"; cx: number; cy: number; r: number };

// Resolve um EdgeRef pro segmento reto que ele representa AGORA (não guarda
// coordenadas, sempre relê a geometria atual — por isso acompanha a forma
// se ela for editada depois). Usado só por cotas "edgeDistance".
function resolveEdgeRefSegment(
  ref: EdgeRef,
  shapes: SketchShape[],
  points: Record<string, SketchPoint>
): { a: Point; b: Point } | null {
  if (ref.kind === "line") {
    const line = shapes.find((s): s is Extract<SketchShape, { type: "line" }> => s.type === "line" && s.id === ref.lineId);
    const p1 = line ? points[line.p1] : null;
    const p2 = line ? points[line.p2] : null;
    if (!p1 || !p2) return null;
    return { a: { x: p1.x, y: p1.y }, b: { x: p2.x, y: p2.y } };
  }

  if (ref.kind === "rectEdge") {
    const rect = shapes.find((s): s is RectShape => s.type === "rect" && s.id === ref.rectId);
    const p1 = rect ? points[rect.p1] : null;
    const p2 = rect ? points[rect.p2] : null;
    if (!p1 || !p2) return null;
    if (ref.axis === "width") {
      const y = ref.edge === "p1" ? p1.y : p2.y;
      return { a: { x: p1.x, y }, b: { x: p2.x, y } };
    }
    const x = ref.edge === "p1" ? p1.x : p2.x;
    return { a: { x, y: p1.y }, b: { x, y: p2.y } };
  }

  // slotTangent
  const slot = shapes.find((s): s is SlotShape => s.type === "slot" && s.id === ref.slotId);
  const c1 = slot ? points[slot.center1] : null;
  const c2 = slot ? points[slot.center2] : null;
  if (!slot || !c1 || !c2) return null;
  const dx = c2.x - c1.x;
  const dy = c2.y - c1.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * ref.side;
  const ny = (dx / len) * ref.side;
  return {
    a: { x: c1.x + nx * slot.radius, y: c1.y + ny * slot.radius },
    b: { x: c2.x + nx * slot.radius, y: c2.y + ny * slot.radius },
  };
}

export function resolveDimension(
  dim: DimensionAnnotation,
  shapes: SketchShape[],
  points: Record<string, SketchPoint>
): DimensionRender | null {
  if (dim.kind === "radius") {
    const circle = shapes.find((s): s is CircleShape => s.type === "circle" && s.id === dim.circleId);
    const center = circle ? points[circle.center] : null;
    if (!circle || !center) return null;
    return { kind: "radius", cx: center.x, cy: center.y, r: circle.radius };
  }

  if (dim.kind === "arcRadius") {
    const arc = shapes.find((s): s is ArcShape => s.type === "arc" && s.id === dim.arcId);
    const center = arc ? points[arc.center] : null;
    const p1 = arc ? points[arc.p1] : null;
    if (!arc || !center || !p1) return null;
    // arco não guarda raio próprio — sempre derivado de center/p1, igual
    // resolveShape faz pra desenhar a geometria em si.
    return { kind: "radius", cx: center.x, cy: center.y, r: Math.hypot(p1.x - center.x, p1.y - center.y) };
  }

  if (dim.kind === "slotRadius") {
    const slot = shapes.find((s): s is SlotShape => s.type === "slot" && s.id === dim.slotId);
    const center = slot ? points[slot.center1] : null;
    if (!slot || !center) return null;
    return { kind: "radius", cx: center.x, cy: center.y, r: slot.radius };
  }

  if (dim.kind === "width" || dim.kind === "height") {
    const rect = shapes.find((s): s is RectShape => s.type === "rect" && s.id === dim.rectId);
    const p1 = rect ? points[rect.p1] : null;
    const p2 = rect ? points[rect.p2] : null;
    if (!p1 || !p2) return null;
    // desenha a cota ao longo da aresta correspondente (não da diagonal)
    return dim.kind === "width"
      ? { kind: "distance", x1: p1.x, y1: p1.y, x2: p2.x, y2: p1.y }
      : { kind: "distance", x1: p1.x, y1: p1.y, x2: p1.x, y2: p2.y };
  }

  if (dim.kind === "edgeDistance") {
    const segA = resolveEdgeRefSegment(dim.a, shapes, points);
    const segB = resolveEdgeRefSegment(dim.b, shapes, points);
    if (!segA || !segB) return null;

    // Ponto médio de A, projetado na reta INFINITA de B — exato quando as
    // 2 arestas são paralelas (o caso normal: 2 tangentes de rasgo, ou 2
    // arestas de largura/altura de retângulo), uma aproximação razoável
    // quando não são.
    const midA = { x: (segA.a.x + segA.b.x) / 2, y: (segA.a.y + segA.b.y) / 2 };
    const dx = segB.b.x - segB.a.x;
    const dy = segB.b.y - segB.a.y;
    const lenSq = dx * dx + dy * dy;
    const proj =
      lenSq < 1e-9
        ? segB.a
        : {
            x: segB.a.x + ((midA.x - segB.a.x) * dx + (midA.y - segB.a.y) * dy) * (dx / lenSq),
            y: segB.a.y + ((midA.x - segB.a.x) * dx + (midA.y - segB.a.y) * dy) * (dy / lenSq),
          };
    return { kind: "distance", x1: midA.x, y1: midA.y, x2: proj.x, y2: proj.y };
  }

  const p1 = points[dim.p1];
  const p2 = points[dim.p2];
  if (!p1 || !p2) return null;
  return { kind: "distance", x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y };
}

// Cota com seta e linha de extensão, deslocável — mesma matemática já usada
// na folha de desenho (DimensionSvg em DrawingSheetWorkspace.tsx), portada
// pra cá pra dar o mesmo tratamento visual às cotas do esboço. Constantes em
// mm no espaço LOCAL do sketch (não em pixels de tela) — um pouco maiores
// que as da folha porque o esboço costuma ser visto de mais perto/com zoom
// livre em 3D, não numa folha impressa em escala fixa.
export const DIM_GAP_MM = 1.5;
export const DIM_OVERSHOOT_MM = 2.5;
export const ARROW_LENGTH_MM = 3;
export const ARROW_HALF_WIDTH_MM = 1.1;
// Cota sem offset salvo (projeto antigo, ou recém-criada) usa essa distância
// padrão em vez de 0 — uma cota "em cima" da própria geometria (offset 0)
// não é o padrão de desenho técnico que a folha já segue, e a seta ficaria
// degenerada (comprimento zero) pra cota de raio nesse caso.
export const DEFAULT_DIM_OFFSET = 4;

export function arrowheadTriangle(tip: Point, dirX: number, dirY: number): [Point, Point, Point] {
  const baseX = tip.x - dirX * ARROW_LENGTH_MM;
  const baseY = tip.y - dirY * ARROW_LENGTH_MM;
  const px = -dirY;
  const py = dirX;
  return [
    tip,
    { x: baseX + px * ARROW_HALF_WIDTH_MM, y: baseY + py * ARROW_HALF_WIDTH_MM },
    { x: baseX - px * ARROW_HALF_WIDTH_MM, y: baseY - py * ARROW_HALF_WIDTH_MM },
  ];
}

export type DimensionLineGeometry = {
  dimA: Point;
  dimB: Point;
  mid: Point;
  extAStart: Point;
  extAEnd: Point;
  extBStart: Point;
  extBEnd: Point;
  arrowA: [Point, Point, Point];
  arrowB: [Point, Point, Point];
  length: number;
  // Direção canônica perpendicular ao segmento a→b — quem chama usa isso
  // pra converter um delta de arrasto (em coordenadas locais) numa mudança
  // de offset (ver DimensionOffsetHandle em SketchOverlay3D.tsx).
  nx: number;
  ny: number;
};

// Geometria completa de uma cota linear (distância entre `a` e `b`), já
// deslocada por `offset` — linhas de extensão saindo da própria geometria
// até a linha de cota, e uma seta em cada ponta apontando uma pra outra.
export function computeDimensionLineGeometry(a: Point, b: Point, offset: number): DimensionLineGeometry | null {
  const length = distance(a, b);
  if (length < 1e-6) return null;

  const ux = (b.x - a.x) / length;
  const uy = (b.y - a.y) / length;
  const nx = -uy;
  const ny = ux;
  const gap = offset >= 0 ? DIM_GAP_MM : -DIM_GAP_MM;
  const overshoot = offset >= 0 ? DIM_OVERSHOOT_MM : -DIM_OVERSHOOT_MM;

  const dimA = { x: a.x + nx * offset, y: a.y + ny * offset };
  const dimB = { x: b.x + nx * offset, y: b.y + ny * offset };
  const mid = { x: (dimA.x + dimB.x) / 2, y: (dimA.y + dimB.y) / 2 };

  const extAStart = { x: a.x + nx * gap, y: a.y + ny * gap };
  const extAEnd = { x: a.x + nx * (offset + overshoot), y: a.y + ny * (offset + overshoot) };
  const extBStart = { x: b.x + nx * gap, y: b.y + ny * gap };
  const extBEnd = { x: b.x + nx * (offset + overshoot), y: b.y + ny * (offset + overshoot) };

  return {
    dimA,
    dimB,
    mid,
    extAStart,
    extAEnd,
    extBStart,
    extBEnd,
    arrowA: arrowheadTriangle(dimA, -ux, -uy),
    arrowB: arrowheadTriangle(dimB, ux, uy),
    length,
    nx,
    ny,
  };
}

// Direção fixa (45°) da cota de raio/diâmetro — a mesma que o rótulo já
// usava antes dessa cota ganhar seta/offset (edge = cx+r·√2/2, cy+r·√2/2).
export const RADIUS_DIM_DIR: Point = { x: Math.SQRT1_2, y: Math.SQRT1_2 };

export type RadiusDimensionGeometry = {
  edge: Point; // ponto na borda do círculo/arco/rasgo — onde a seta encosta
  tip: Point; // ponta externa (borda + offset) — onde o rótulo fica
  arrow: [Point, Point, Point];
};

// Linha reta do centro até a borda (raio em si) + uma extensão deslocável
// além da borda com seta encostando nela, ao estilo de cota de raio de
// desenho técnico — offset negativo puxa o rótulo pra dentro do círculo.
export function computeRadiusDimensionGeometry(cx: number, cy: number, r: number, offset: number): RadiusDimensionGeometry {
  const edge = { x: cx + RADIUS_DIM_DIR.x * r, y: cy + RADIUS_DIM_DIR.y * r };
  const tip = { x: cx + RADIUS_DIM_DIR.x * (r + offset), y: cy + RADIUS_DIM_DIR.y * (r + offset) };
  return { edge, tip, arrow: arrowheadTriangle(edge, -RADIUS_DIM_DIR.x, -RADIUS_DIM_DIR.y) };
}

// Forma "resolvida" pronta pra desenhar — usada tanto pros shapes de
// verdade (depois de ler o pool de pontos) quanto pro preview do arrasto
// (que nunca vira ponto/shape de fato se for cancelado). Descrição pura de
// geometria — cada view (SVG 2D, Three.js 3D) decide como desenhar isso.
export type RenderableShape =
  | { kind: "line"; x1: number; y1: number; x2: number; y2: number }
  | { kind: "centerline"; x1: number; y1: number; x2: number; y2: number }
  | { kind: "rect"; x1: number; y1: number; x2: number; y2: number }
  | { kind: "circle"; cx: number; cy: number; r: number }
  | { kind: "point"; cx: number; cy: number }
  | { kind: "arc"; cx: number; cy: number; r: number; x1: number; y1: number; x2: number; y2: number }
  | { kind: "slot"; c1x: number; c1y: number; c2x: number; c2y: number; r: number };

export function resolveShape(
  shape: SketchShape,
  points: Record<string, SketchPoint>
): RenderableShape | null {
  if (shape.type === "circle") {
    const center = points[shape.center];
    if (!center) return null;
    return { kind: "circle", cx: center.x, cy: center.y, r: shape.radius };
  }
  if (shape.type === "point") {
    const p = points[shape.pointId];
    if (!p) return null;
    return { kind: "point", cx: p.x, cy: p.y };
  }
  if (shape.type === "arc") {
    const p1 = points[shape.p1];
    const p2 = points[shape.p2];
    const center = points[shape.center];
    if (!p1 || !p2 || !center) return null;
    const r = Math.hypot(p1.x - center.x, p1.y - center.y);
    return { kind: "arc", cx: center.x, cy: center.y, r, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y };
  }
  if (shape.type === "slot") {
    const c1 = points[shape.center1];
    const c2 = points[shape.center2];
    if (!c1 || !c2) return null;
    return { kind: "slot", c1x: c1.x, c1y: c1.y, c2x: c2.x, c2y: c2.y, r: shape.radius };
  }
  const p1 = points[shape.p1];
  const p2 = points[shape.p2];
  if (!p1 || !p2) return null;
  if (shape.type === "line" && shape.isCenterLine) {
    return { kind: "centerline", x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y };
  }
  return { kind: shape.type, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y };
}

// Amostra pontos ao longo do arco MENOR (<180°) entre (x1,y1) e (x2,y2) num
// círculo de centro (cx,cy) raio r — convenção de todo ArcShape (sempre o
// arco curto, é geometricamente o único caso possível num fillet de canto).
// Usada tanto pra desenhar (polilinha) quanto pra hit-test por distância.
export function sampleMinorArc(
  cx: number,
  cy: number,
  r: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  segments = 20
): Point[] {
  const a1 = Math.atan2(y1 - cy, x1 - cx);
  const a2 = Math.atan2(y2 - cy, x2 - cx);
  let delta = a2 - a1;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta < -Math.PI) delta += 2 * Math.PI;

  const pts: Point[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = a1 + (delta * i) / segments;
    pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return pts;
}

// Amostra o arco de `from` até o ponto diametralmente oposto, passando por
// `via` — feito pra tampas de rasgo (sempre exatamente 180°), onde
// sampleMinorArc não serve: um arco de 180° exato é ambíguo só com start/end
// (poderia curvar pra qualquer lado), precisa de um 3º ponto pra desempatar.
// `via` é angularmente o meio do arco por construção (mesma convenção usada
// em profileToDrawing, geometry.ts), então o delta até ele, dobrado, dá a
// volta completa até o ponto oposto.
export function sampleArcViaPoint(
  center: Point,
  r: number,
  from: Point,
  via: Point,
  segments = 16
): Point[] {
  const a0 = Math.atan2(from.y - center.y, from.x - center.x);
  const aVia = Math.atan2(via.y - center.y, via.x - center.x);
  let delta = aVia - a0;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta < -Math.PI) delta += 2 * Math.PI;
  const fullDelta = delta * 2;
  const pts: Point[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = a0 + (fullDelta * i) / segments;
    pts.push({ x: center.x + r * Math.cos(a), y: center.y + r * Math.sin(a) });
  }
  return pts;
}

// Contorno do rasgo (stadium): 2 tangentes + 2 tampas semicirculares — mesma
// convenção geométrica de profileToDrawing (lib/replicad/geometry.ts), só
// que como polilinha em vez de arco nativo do replicad. Compartilhado pelo
// preview do viewer 3D e pela exportação DXF, pra não divergir.
export function slotOutline(c1x: number, c1y: number, c2x: number, c2y: number, r: number): Point[] {
  const c1 = { x: c1x, y: c1y };
  const c2 = { x: c2x, y: c2y };
  const dx = c2.x - c1.x;
  const dy = c2.y - c1.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;
  const p1 = { x: c1.x + nx * r, y: c1.y + ny * r };
  const p2 = { x: c2.x + nx * r, y: c2.y + ny * r };
  const p4 = { x: c1.x - nx * r, y: c1.y - ny * r };
  const apex2 = { x: c2.x + ux * r, y: c2.y + uy * r };
  const apex1 = { x: c1.x - ux * r, y: c1.y - uy * r };
  const cap2 = sampleArcViaPoint(c2, r, p2, apex2);
  const cap1 = sampleArcViaPoint(c1, r, p4, apex1);
  return [p1, ...cap2, ...cap1];
}

export function draftPreviewFor(tool: SketchTool, start: Point, end: Point): RenderableShape | null {
  if (tool === "circle") {
    return { kind: "circle", cx: start.x, cy: start.y, r: distance(start, end) };
  }
  if (tool === "centerline") {
    return { kind: "centerline", x1: start.x, y1: start.y, x2: end.x, y2: end.y };
  }
  if (tool === "rect" || tool === "line") {
    return { kind: tool, x1: start.x, y1: start.y, x2: end.x, y2: end.y };
  }
  return null;
}

export function edgeHitToDimension(hit: EdgeHit, shapes: SketchShape[]): DimensionAnnotation | null {
  if (hit.kind === "line") {
    const line = shapes.find((s) => s.id === hit.shapeId);
    if (!line || line.type !== "line") return null;
    return { id: createId(), kind: "distance", p1: line.p1, p2: line.p2 };
  }
  if (hit.kind === "rectWidth") {
    return { id: createId(), kind: "width", rectId: hit.shapeId };
  }
  if (hit.kind === "rectHeight") {
    return { id: createId(), kind: "height", rectId: hit.shapeId };
  }
  if (hit.kind === "arcRadius") {
    return { id: createId(), kind: "arcRadius", arcId: hit.shapeId };
  }
  if (hit.kind === "slotRadius") {
    return { id: createId(), kind: "slotRadius", slotId: hit.shapeId };
  }
  if (hit.kind === "slotLength") {
    // Comprimento do rasgo = distância comum entre os 2 centros — já são
    // pontos de verdade, não precisa de kind própria (ver DimensionAnnotation).
    const slot = shapes.find((s): s is SlotShape => s.type === "slot" && s.id === hit.shapeId);
    if (!slot) return null;
    return { id: createId(), kind: "distance", p1: slot.center1, p2: slot.center2 };
  }
  return { id: createId(), kind: "radius", circleId: hit.shapeId };
}
