import type { Point, SketchPoint, SketchShape } from "./types";
import { findNearestPointOnShapes, findNearestPointOnSegments, findNearbyLineMidpoint } from "./hitTest";

export function snapToGrid(point: Point, gridSize: number): Point {
  return {
    x: Math.round(point.x / gridSize) * gridSize,
    y: Math.round(point.y / gridSize) * gridSize,
  };
}

function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function findNearbyPoint(
  point: Point,
  points: SketchPoint[],
  toleranceWorld: number
): SketchPoint | null {
  let closest: SketchPoint | null = null;
  let closestDist = toleranceWorld;

  for (const candidate of points) {
    const d = distance(point, candidate);
    if (d < closestDist) {
      closestDist = d;
      closest = candidate;
    }
  }

  return closest;
}

export type ResolvedSnap = { point: Point; existingId: string | null };

// Se o clique cair perto de um ponto já existente no pool, gruda nele
// (existingId aponta pra ele — é assim que a coincidência acontece: quem
// chamar isso reaproveita o id em vez de criar um ponto novo no mesmo
// lugar). Senão cai pro grid e devolve existingId: null.
export function resolveSnap(
  raw: Point,
  points: SketchPoint[],
  gridSize: number,
  toleranceWorld: number
): ResolvedSnap {
  const nearby = findNearbyPoint(raw, points, toleranceWorld);
  if (nearby) {
    return { point: { x: nearby.x, y: nearby.y }, existingId: nearby.id };
  }
  return { point: snapToGrid(raw, gridSize), existingId: null };
}

export type ResolvedEdgeSnap = ResolvedSnap & {
  // true quando o ponto veio de uma coincidência/aresta/referência real, não
  // só do grid — usado pra mostrar o indicador visual de snap (o "ponto
  // verde" ao estilo Inventor).
  snapped: boolean;
};

// Camada extra além de resolveSnap: também tenta encostar num ponto sobre
// uma ARESTA existente do sketch (linha/retângulo) ou sobre a geometria de
// referência projetada do sólido 3D — dá a sensação de "a linha reconhece
// a outra e junta", ao estilo Inventor, e também é o mecanismo que torna a
// geometria de referência utilizável (não só visual).
//
// O MEIO de uma aresta (findNearbyLineMidpoint) é checado com PRIORIDADE
// sobre "ponto mais próximo na aresta" (onShape) — não como mais um
// candidato competindo por distância: onShape, por construção, é SEMPRE o
// ponto da própria aresta mais perto do cursor, então numa disputa por
// "quem fica mais perto do raw" ele ganharia de qualquer outro ponto FIXO
// na mesma aresta (o meio incluso) quase sempre, e o "ponto" pareceria só
// deslizar em cima da linha em vez de grudar firme no centro. Por isso o
// meio tem sua PRÓPRIA zona de captura (perto o bastante do centro de
// verdade) e, se acertar essa zona, vence na hora — só cai pro
// deslizamento genérico de onShape se o cursor estiver longe o bastante do
// meio.
export function resolveSnapWithEdges(
  raw: Point,
  points: Record<string, SketchPoint>,
  shapes: SketchShape[],
  referenceGeometry: { x1: number; y1: number; x2: number; y2: number }[],
  gridSize: number,
  toleranceWorld: number
): ResolvedEdgeSnap {
  const nearby = findNearbyPoint(raw, Object.values(points), toleranceWorld);
  if (nearby) {
    return { point: { x: nearby.x, y: nearby.y }, existingId: nearby.id, snapped: true };
  }

  const onMidpoint = findNearbyLineMidpoint(raw, shapes, points, toleranceWorld);
  if (onMidpoint) {
    return { point: onMidpoint, existingId: null, snapped: true };
  }

  const onShape = findNearestPointOnShapes(raw, shapes, points, toleranceWorld);
  const onReference = findNearestPointOnSegments(raw, referenceGeometry, toleranceWorld);

  const candidates = [onShape, onReference].filter((p): p is Point => p !== null);
  if (candidates.length > 0) {
    candidates.sort((a, b) => distance(raw, a) - distance(raw, b));
    return { point: candidates[0], existingId: null, snapped: true };
  }

  return { point: snapToGrid(raw, gridSize), existingId: null, snapped: false };
}
