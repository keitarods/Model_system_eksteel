import type { EdgeHit } from "./hitTest";
import type {
  CircleShape,
  DimensionAnnotation,
  Point,
  RectShape,
  SketchPoint,
  SketchShape,
  SketchTool,
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

export function findCircleByCenter(shapes: SketchShape[], centerId: string): CircleShape | null {
  return (
    shapes.find((s): s is CircleShape => s.type === "circle" && s.center === centerId) ?? null
  );
}

export type DimensionRender =
  | { kind: "distance"; x1: number; y1: number; x2: number; y2: number }
  | { kind: "radius"; cx: number; cy: number; r: number };

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

  const p1 = points[dim.p1];
  const p2 = points[dim.p2];
  if (!p1 || !p2) return null;
  return { kind: "distance", x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y };
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
  | { kind: "arc"; cx: number; cy: number; r: number; x1: number; y1: number; x2: number; y2: number };

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
  return { id: createId(), kind: "radius", circleId: hit.shapeId };
}
