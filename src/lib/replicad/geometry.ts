import { draw, drawCircle, drawRoundedRectangle } from "replicad";
import type { Drawing, Solid } from "replicad";
import type {
  ArcShape,
  LineShape,
  Point,
  SketchPlane,
  SketchPoint,
  SketchShape,
} from "@/lib/sketch/types";
import { negate, offsetOrigin, toReplicadPlane } from "./plane";

// Sentido do Extrudar em relação à normal do plano do sketch, ao estilo
// Inventor: "normal" segue a normal, "flipped" vai pro lado oposto,
// "symmetric" sai metade pra cada lado (fica centrado no plano).
export type ExtrudeDirection = "normal" | "flipped" | "symmetric";

// Encaixa as linhas (+ arcos de fillet) soltas numa cadeia fechada usando
// igualdade de id de ponto (não mais distância/epsilon) — como pontos
// coincidentes agora são literalmente o mesmo ponto do pool, a
// conectividade é exata. Devolve, junto com os vértices em ordem, o centro
// do arco de cada segmento (arcCenters[i] liga points[i] a points[i+1],
// com wraparound pro último voltar ao início) — null nessa posição quando
// o segmento é reto.
function findClosedLoop(
  edges: (LineShape | ArcShape)[],
  points: Record<string, SketchPoint>
): { points: Point[]; arcCenters: (Point | null)[] } | null {
  if (edges.length < 3) return null;

  const remaining = edges.slice(1);
  const first = edges[0];
  const startId = first.p1;
  let currentId = first.p2;
  const orderedEdges: (LineShape | ArcShape)[] = [first];

  while (remaining.length > 0) {
    const idx = remaining.findIndex(
      (e) => e.p1 === currentId || e.p2 === currentId
    );
    if (idx === -1) return null;

    const [edge] = remaining.splice(idx, 1);
    const nextId = edge.p1 === currentId ? edge.p2 : edge.p1;
    orderedEdges.push(edge);
    currentId = nextId;
  }

  if (currentId !== startId) return null;
  if (orderedEdges.length < 3) return null;

  const vertexIds: string[] = [startId];
  const arcCenterIds: (string | null)[] = [];
  let walkId = startId;
  for (const edge of orderedEdges) {
    const nextId = edge.p1 === walkId ? edge.p2 : edge.p1;
    arcCenterIds.push(edge.type === "arc" ? edge.center : null);
    if (nextId !== startId) vertexIds.push(nextId);
    walkId = nextId;
  }

  const resolvedPoints = vertexIds.map((id) => points[id]);
  if (resolvedPoints.some((p) => !p)) return null;

  const resolvedArcCenters = arcCenterIds.map((id) => (id ? points[id] : null));
  if (arcCenterIds.some((id, i) => id && !resolvedArcCenters[i])) return null;

  return {
    points: resolvedPoints.map((p) => ({ x: p.x, y: p.y })),
    arcCenters: resolvedArcCenters.map((p) => (p ? { x: p.x, y: p.y } : null)),
  };
}

// Perfil já resolvido (coordenadas concretas, não mais ids de ponto) — é o
// que fica congelado dentro de uma feature, independente do sketch (que é
// limpo logo depois de a feature ser criada). arcCenters é opcional e
// aditivo (ausente = perfil 100% reto) só pra manter compatibilidade com
// projetos .eks3d salvos antes da ferramenta de fillet existir.
export type ProfileSource =
  | { kind: "rect"; x1: number; y1: number; x2: number; y2: number }
  | { kind: "circle"; cx: number; cy: number; r: number }
  | { kind: "loop"; points: Point[]; arcCenters?: (Point | null)[] }
  | null;

// Escolhe o perfil a extrudar/revolucionar: o retângulo/círculo mais
// recente ou, na ausência de um, um contorno fechado formado pelas linhas
// (e arcos de fillet, se houver).
export function findProfileSource(
  shapes: SketchShape[],
  points: Record<string, SketchPoint>
): ProfileSource {
  for (let i = shapes.length - 1; i >= 0; i--) {
    const shape = shapes[i];

    if (shape.type === "rect") {
      const p1 = points[shape.p1];
      const p2 = points[shape.p2];
      if (!p1 || !p2) continue;
      return { kind: "rect", x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y };
    }

    if (shape.type === "circle") {
      const center = points[shape.center];
      if (!center) continue;
      return { kind: "circle", cx: center.x, cy: center.y, r: shape.radius };
    }
  }

  // linhas de centro não são contorno de perfil, só referência de eixo
  const edges = shapes.filter(
    (s): s is LineShape | ArcShape => (s.type === "line" && !s.isCenterLine) || s.type === "arc"
  );
  const loop = findClosedLoop(edges, points);
  return loop ? { kind: "loop", points: loop.points, arcCenters: loop.arcCenters } : null;
}

// Independente do perfil escolhido pra extrudar/revolucionar, o Furo sempre
// usa o círculo mais recente do sketch (ele é a própria ferramenta de
// corte, não "o perfil geral").
export function findLastCircle(
  shapes: SketchShape[],
  points: Record<string, SketchPoint>
): { cx: number; cy: number; r: number } | null {
  for (let i = shapes.length - 1; i >= 0; i--) {
    const shape = shapes[i];
    if (shape.type === "circle") {
      const center = points[shape.center];
      if (!center) return null;
      return { cx: center.x, cy: center.y, r: shape.radius };
    }
  }
  return null;
}

// Revolução (ao estilo Inventor) precisa de uma linha de centro explícita no
// sketch — sem ela, não tem eixo definido e a operação não deve ficar
// disponível. Origin/direction ficam em coordenadas locais do plano do
// sketch (mesma convenção do profile).
export function findCenterLine(
  shapes: SketchShape[],
  points: Record<string, SketchPoint>
): { origin: Point; direction: Point } | null {
  for (let i = shapes.length - 1; i >= 0; i--) {
    const shape = shapes[i];
    if (shape.type !== "line" || !shape.isCenterLine) continue;

    const p1 = points[shape.p1];
    const p2 = points[shape.p2];
    if (!p1 || !p2) continue;

    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const length = Math.hypot(dx, dy);
    if (length < 1e-6) continue;

    return { origin: { x: p1.x, y: p1.y }, direction: { x: dx / length, y: dy / length } };
  }
  return null;
}

// Ponto sobre o arco (menor, <180°) de p1 pra p2, a `radius` de `center` —
// o "ponto interno" que threePointsArcTo pede pra desenhar um arco sem
// ambiguidade de sentido (equivalente ao ponto médio do fillet, mas
// derivado do centro em vez de guardado à parte).
function arcInnerPoint(center: Point, from: Point, to: Point, radius: number): Point {
  const midX = (from.x + to.x) / 2;
  const midY = (from.y + to.y) / 2;
  const dx = midX - center.x;
  const dy = midY - center.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: center.x + (dx / len) * radius, y: center.y + (dy / len) * radius };
}

export function profileToDrawing(profile: ProfileSource): Drawing | null {
  if (!profile) return null;

  if (profile.kind === "rect") {
    const { x1, y1, x2, y2 } = profile;
    const width = Math.abs(x2 - x1);
    const height = Math.abs(y2 - y1);
    if (width < 1e-6 || height < 1e-6) return null;
    return drawRoundedRectangle(width, height, 0).translate(
      (x1 + x2) / 2,
      (y1 + y2) / 2
    );
  }

  if (profile.kind === "circle") {
    const { cx, cy, r } = profile;
    if (r < 1e-6) return null;
    return drawCircle(r).translate(cx, cy);
  }

  const { points: pts, arcCenters } = profile;
  const [firstPoint, ...rest] = pts;
  let pen = draw([firstPoint.x, firstPoint.y]);
  let current = firstPoint;

  rest.forEach((point, i) => {
    const center = arcCenters?.[i];
    if (center) {
      const radius = Math.hypot(current.x - center.x, current.y - center.y);
      const inner = arcInnerPoint(center, current, point, radius);
      pen = pen.threePointsArcTo([point.x, point.y], [inner.x, inner.y]);
    } else {
      pen = pen.lineTo([point.x, point.y]);
    }
    current = point;
  });

  // Fecha de volta pro início — pode ser reto (comportamento de sempre,
  // pen.close() desenha a linha) ou arco também (desenhado explicitamente
  // aqui; close() então só finaliza, já que o pen já estará de volta no
  // ponto inicial).
  const closingCenter = arcCenters?.[pts.length - 1];
  if (closingCenter) {
    const radius = Math.hypot(current.x - closingCenter.x, current.y - closingCenter.y);
    const inner = arcInnerPoint(closingCenter, current, firstPoint, radius);
    pen = pen.threePointsArcTo([firstPoint.x, firstPoint.y], [inner.x, inner.y]);
  }

  return pen.close();
}

// Um perfil fechado único (retângulo, círculo ou contorno de linhas) sempre
// extruda para um Solid — os outros membros de AnyShape só aparecem com
// entradas que este módulo não produz (ex.: sketches compostos).
//
// "symmetric" não tem suporte nativo no replicad (só extrusionDirection +
// distância) — o truque é o mesmo já usado no furo passante: começa a
// extrusão numa cópia do plano deslocada pra trás por metade da distância,
// aí a extrusão inteira fica centrada no plano original.
export function extrudeProfile(
  drawing: Drawing,
  depth: number,
  plane: SketchPlane,
  direction: ExtrudeDirection = "normal"
): Solid {
  if (direction === "symmetric") {
    const centeredPlane: SketchPlane = {
      origin: offsetOrigin(plane, -depth / 2),
      normal: plane.normal,
      xDir: plane.xDir,
    };
    const sketch = drawing.sketchOnPlane(toReplicadPlane(centeredPlane));
    return sketch.extrude(depth) as unknown as Solid;
  }

  const sketch = drawing.sketchOnPlane(toReplicadPlane(plane));
  if (direction === "flipped") {
    return sketch.extrude(depth, { extrusionDirection: negate(plane.normal) }) as unknown as Solid;
  }
  return sketch.extrude(depth) as unknown as Solid;
}
