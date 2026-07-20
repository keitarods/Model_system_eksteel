import type { ArcShape, LineShape, Point, SketchPoint, SketchShape } from "./types";
import { createId } from "./render";

function sub(a: Point, b: Point): Point {
  return { x: a.x - b.x, y: a.y - b.y };
}
function add(a: Point, b: Point): Point {
  return { x: a.x + b.x, y: a.y + b.y };
}
function scale(v: Point, s: number): Point {
  return { x: v.x * s, y: v.y * s };
}
function norm(v: Point): Point {
  const len = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / len, y: v.y / len };
}

export type Corner = { vertexId: string; lineA: LineShape; lineB: LineShape };

// Acha o vértice mais próximo do clique que é compartilhado por exatamente
// duas linhas (não linhas de centro) — o "canto" candidato a receber
// fillet/chamfer. Um vértice com 1 ou 3+ linhas não tem um canto único bem
// definido, então fica de fora.
export function findCornerNear(
  raw: Point,
  shapes: SketchShape[],
  points: Record<string, SketchPoint>,
  tolerance: number
): Corner | null {
  let bestVertex: string | null = null;
  let bestDist = tolerance;

  for (const id in points) {
    const p = points[id];
    const d = Math.hypot(raw.x - p.x, raw.y - p.y);
    if (d < bestDist) {
      bestDist = d;
      bestVertex = id;
    }
  }
  if (!bestVertex) return null;

  const lines = shapes.filter(
    (s): s is LineShape =>
      s.type === "line" && !s.isCenterLine && (s.p1 === bestVertex || s.p2 === bestVertex)
  );
  if (lines.length !== 2) return null;

  return { vertexId: bestVertex, lineA: lines[0], lineB: lines[1] };
}

type CornerResult = {
  newPoints: SketchPoint[];
  updatedLineA: LineShape;
  updatedLineB: LineShape;
  newShape: SketchShape;
} | null;

function otherEnd(line: LineShape, vertexId: string): string {
  return line.p1 === vertexId ? line.p2 : line.p1;
}

function replaceEnd(line: LineShape, vertexId: string, newId: string): LineShape {
  return line.p1 === vertexId ? { ...line, p1: newId } : { ...line, p2: newId };
}

// Corta os dois lados do canto a `radius` de distância (medida ao longo de
// cada linha) e liga os dois pontos de corte por um arco tangente às duas —
// a mesma construção de qualquer fillet 2D: os pontos de corte ficam a
// radius/tan(θ/2) do vértice, o centro do arco fica na bissetriz a
// radius/sin(θ/2).
export function computeFillet(
  corner: Corner,
  points: Record<string, SketchPoint>,
  radius: number
): CornerResult {
  const { vertexId, lineA, lineB } = corner;
  const V = points[vertexId];
  const A = points[otherEnd(lineA, vertexId)];
  const B = points[otherEnd(lineB, vertexId)];
  if (!V || !A || !B || radius <= 0) return null;

  const dA = norm(sub(A, V));
  const dB = norm(sub(B, V));
  const cosTheta = Math.max(-1, Math.min(1, dA.x * dB.x + dA.y * dB.y));
  const theta = Math.acos(cosTheta);
  if (theta < 1e-3 || theta > Math.PI - 1e-3) return null; // colineares, sem canto de verdade

  const trimDist = radius / Math.tan(theta / 2);
  const lenA = Math.hypot(A.x - V.x, A.y - V.y);
  const lenB = Math.hypot(B.x - V.x, B.y - V.y);
  if (trimDist >= lenA || trimDist >= lenB) return null; // raio grande demais pras linhas

  const T1 = add(V, scale(dA, trimDist));
  const T2 = add(V, scale(dB, trimDist));

  const bisector = norm(add(dA, dB));
  const centerDist = radius / Math.sin(theta / 2);
  const C = add(V, scale(bisector, centerDist));

  const t1: SketchPoint = { id: createId(), x: T1.x, y: T1.y };
  const t2: SketchPoint = { id: createId(), x: T2.x, y: T2.y };
  const center: SketchPoint = { id: createId(), x: C.x, y: C.y };

  const updatedLineA = replaceEnd(lineA, vertexId, t1.id);
  const updatedLineB = replaceEnd(lineB, vertexId, t2.id);
  const arc: ArcShape = { id: createId(), type: "arc", p1: t1.id, p2: t2.id, center: center.id };

  return { newPoints: [t1, t2, center], updatedLineA, updatedLineB, newShape: arc };
}

// Mesma ideia do fillet, mas liga os dois pontos de corte com uma linha
// reta em vez de um arco — nesse caso os dois lados usam a MESMA distância
// (chanfro simétrico; um chanfro assimétrico com 2 distâncias distintas
// ficaria para uma iteração futura).
export function computeChamfer(
  corner: Corner,
  points: Record<string, SketchPoint>,
  distance: number
): CornerResult {
  const { vertexId, lineA, lineB } = corner;
  const V = points[vertexId];
  const A = points[otherEnd(lineA, vertexId)];
  const B = points[otherEnd(lineB, vertexId)];
  if (!V || !A || !B || distance <= 0) return null;

  const dA = norm(sub(A, V));
  const dB = norm(sub(B, V));
  const lenA = Math.hypot(A.x - V.x, A.y - V.y);
  const lenB = Math.hypot(B.x - V.x, B.y - V.y);
  if (distance >= lenA || distance >= lenB) return null;

  const T1 = add(V, scale(dA, distance));
  const T2 = add(V, scale(dB, distance));

  const t1: SketchPoint = { id: createId(), x: T1.x, y: T1.y };
  const t2: SketchPoint = { id: createId(), x: T2.x, y: T2.y };

  const updatedLineA = replaceEnd(lineA, vertexId, t1.id);
  const updatedLineB = replaceEnd(lineB, vertexId, t2.id);
  const chamferLine: LineShape = { id: createId(), type: "line", p1: t1.id, p2: t2.id };

  return { newPoints: [t1, t2], updatedLineA, updatedLineB, newShape: chamferLine };
}
