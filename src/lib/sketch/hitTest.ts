import type { CircleShape, Point, RectShape, SketchPoint, SketchShape } from "./types";

export function projectOntoSegment(p: Point, a: Point, b: Point): { t: number; distance: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq < 1e-9) return { t: 0, distance: Math.hypot(p.x - a.x, p.y - a.y) };

  const rawT = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq;
  const t = Math.max(0, Math.min(1, rawT));
  const distance = Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
  return { t, distance };
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  return projectOntoSegment(p, a, b).distance;
}

// Distância de p até a curva do arco MENOR (<180°) entre from/to em torno de
// center — dentro do "leque" angular do arco conta a distância até a
// circunferência (igual círculo); fora dele, cai pra distância até a ponta
// mais próxima (mesmo espírito de projectOntoSegment, mas em ângulo).
function distanceToArc(p: Point, center: Point, r: number, from: Point, to: Point): number {
  const a1 = Math.atan2(from.y - center.y, from.x - center.x);
  const a2 = Math.atan2(to.y - center.y, to.x - center.x);
  let delta = a2 - a1;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta < -Math.PI) delta += 2 * Math.PI;

  const ap = Math.atan2(p.y - center.y, p.x - center.x);
  let t = ap - a1;
  while (t > Math.PI) t -= 2 * Math.PI;
  while (t < -Math.PI) t += 2 * Math.PI;

  const within = delta >= 0 ? t >= 0 && t <= delta : t <= 0 && t >= delta;
  if (within) {
    return Math.abs(Math.hypot(p.x - center.x, p.y - center.y) - r);
  }
  return Math.min(Math.hypot(p.x - from.x, p.y - from.y), Math.hypot(p.x - to.x, p.y - to.y));
}

// "edge"/"side" desambiguam QUAL das 2 arestas paralelas foi clicada — um
// retângulo tem 2 arestas de largura (uma em y=p1.y, outra em y=p2.y) e um
// rasgo tem 2 tangentes (uma de cada lado do eixo center1→center2). Sem
// isso, clicar as 2 arestas de um mesmo par pareceria "a mesma aresta" pro
// fluxo de cota relacional (linha a linha) — precisa saber que são
// fisicamente diferentes pra calcular a distância entre elas.
export type EdgeHit =
  | { kind: "line"; shapeId: string }
  | { kind: "rectWidth"; shapeId: string; edge: "p1" | "p2" }
  | { kind: "rectHeight"; shapeId: string; edge: "p1" | "p2" }
  | { kind: "circleRadius"; shapeId: string }
  | { kind: "arcRadius"; shapeId: string }
  | { kind: "slotLength"; shapeId: string; side: 1 | -1 }
  | { kind: "slotRadius"; shapeId: string }
  // Clique mais perto do CENTRO do círculo que da borda — desambiguado pelo
  // mesmo critério de distância relativa usado em handleRawDown/
  // bestCircleEdge (store.ts) pra redimensionar vs mover. Deixa cotar
  // distância do centro até OUTRA coisa (linha, outro ponto) — ver
  // dimensionPick1/PickableEdgeHit em store.ts — em vez de sempre cair na
  // cota de raio instantânea.
  | { kind: "point"; shapeId: string; pointId: string };

// Acha a aresta/círculo mais próxima do clique (dentro da tolerância) — é o
// que permite clicar numa linha existente pra cotar o comprimento dela
// inteiro, em vez de precisar arrastar ponto a ponto. Um retângulo só tem
// p1/p2 (cantos diagonais), então as 4 arestas visuais são derivadas na
// hora só pra esse teste de distância.
export function findEdgeHit(
  raw: Point,
  shapes: SketchShape[],
  points: Record<string, SketchPoint>,
  tolerance: number
): EdgeHit | null {
  let best: EdgeHit | null = null;
  let bestDist = tolerance;

  for (let i = shapes.length - 1; i >= 0; i--) {
    const shape = shapes[i];

    if (shape.type === "line") {
      const p1 = points[shape.p1];
      const p2 = points[shape.p2];
      if (!p1 || !p2) continue;
      const d = distanceToSegment(raw, p1, p2);
      if (d < bestDist) {
        bestDist = d;
        best = { kind: "line", shapeId: shape.id };
      }
      continue;
    }

    if (shape.type === "rect") {
      const p1 = points[shape.p1];
      const p2 = points[shape.p2];
      if (!p1 || !p2) continue;

      const corners = {
        a: p1,
        b: { x: p2.x, y: p1.y },
        c: p2,
        d: { x: p1.x, y: p2.y },
      };
      const edges: [Point, Point, "rectWidth" | "rectHeight", "p1" | "p2"][] = [
        [corners.a, corners.b, "rectWidth", "p1"],
        [corners.b, corners.c, "rectHeight", "p2"],
        [corners.c, corners.d, "rectWidth", "p2"],
        [corners.d, corners.a, "rectHeight", "p1"],
      ];
      for (const [ea, eb, kind, edge] of edges) {
        const d = distanceToSegment(raw, ea, eb);
        if (d < bestDist) {
          bestDist = d;
          best = { kind, shapeId: shape.id, edge };
        }
      }
      continue;
    }

    // ponto solto não tem "aresta" pra clicar — cotar distância a partir
    // dele continua possível arrastando (ver handleRawUp), só não pelo
    // clique único aqui.
    if (shape.type === "point") continue;

    if (shape.type === "arc") {
      const p1 = points[shape.p1];
      const p2 = points[shape.p2];
      const center = points[shape.center];
      if (!p1 || !p2 || !center) continue;
      const r = Math.hypot(p1.x - center.x, p1.y - center.y);
      const d = distanceToArc(raw, center, r, p1, p2);
      if (d < bestDist) {
        bestDist = d;
        best = { kind: "arcRadius", shapeId: shape.id };
      }
      continue;
    }

    if (shape.type === "slot") {
      const c1 = points[shape.center1];
      const c2 = points[shape.center2];
      if (!c1 || !c2) continue;
      const dx = c2.x - c1.x;
      const dy = c2.y - c1.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      const r = shape.radius;
      const t1a = { x: c1.x + nx * r, y: c1.y + ny * r };
      const t1b = { x: c2.x + nx * r, y: c2.y + ny * r };
      const t2a = { x: c1.x - nx * r, y: c1.y - ny * r };
      const t2b = { x: c2.x - nx * r, y: c2.y - ny * r };

      const dSide1 = distanceToSegment(raw, t1a, t1b);
      const dSide2 = distanceToSegment(raw, t2a, t2b);
      const dTangent = Math.min(dSide1, dSide2);
      if (dTangent < bestDist) {
        bestDist = dTangent;
        best = { kind: "slotLength", shapeId: shape.id, side: dSide1 <= dSide2 ? 1 : -1 };
      }

      const dCap1 = Math.abs(Math.hypot(raw.x - c1.x, raw.y - c1.y) - r);
      const dCap2 = Math.abs(Math.hypot(raw.x - c2.x, raw.y - c2.y) - r);
      const dRadius = Math.min(dCap1, dCap2);
      if (dRadius < bestDist) {
        bestDist = dRadius;
        best = { kind: "slotRadius", shapeId: shape.id };
      }
      continue;
    }

    // circle: perto do centro OU da circunferência conta — desambiguado por
    // distância RELATIVA (qual dos dois está mais perto), mesmo critério do
    // redimensionar/mover em handleRawDown (store.ts): mais perto da borda
    // continua cotando o raio na hora (kind "circleRadius", como sempre
    // foi); mais perto do centro vira um hit de PONTO, pra poder cotar a
    // distância dele até outra coisa (ver dimensionPick1 em store.ts).
    const center = points[shape.center];
    if (!center) continue;
    const dCenter = Math.hypot(raw.x - center.x, raw.y - center.y);
    const dEdge = Math.abs(dCenter - shape.radius);
    const d = Math.min(dCenter, dEdge);
    if (d < bestDist) {
      bestDist = d;
      best =
        dEdge <= dCenter
          ? { kind: "circleRadius", shapeId: shape.id }
          : { kind: "point", shapeId: shape.id, pointId: shape.center };
    }
  }

  return best;
}

// Variante de findEdgeHit usada SÓ pela ferramenta Cota: além do que
// findEdgeHit já acha (linha/aresta/raio/centro de círculo), também
// reconhece QUALQUER outro ponto já existente no pool — ponta de linha,
// canto de retângulo, ponto solto, ou a própria origem — como uma
// referência "point" cotável (distância até uma linha ou outro ponto
// qualquer, ver dimensionPick1 em store.ts). NÃO é o findEdgeHit padrão
// (usado também por Selecionar/Perpendicular/Tangente/Coincidente) porque
// essas outras ferramentas dependem de pegar a ARESTA (não o vértice) perto
// de uma ponta — dar prioridade a ponto ali quebraria, por exemplo,
// escolher uma linha pela Tangente clicando perto da extremidade dela.
// Centro de círculo fica de fora do "qualquer outro ponto" (mantém o
// critério relativo de findEdgeHit — perto do centro X perto da borda —
// intocado); checado ANTES do resto (não como mais um candidato competindo
// por distância): perto de um vértice, a aresta que o contém fica a uma
// distância quase idêntica (a ponta É o ponto mais próximo dela), então
// competir por distância seria instável — mesma lição do meio de linha em
// resolveSnapWithEdges (snap.ts).
export function findEdgeOrPointHit(
  raw: Point,
  shapes: SketchShape[],
  points: Record<string, SketchPoint>,
  tolerance: number
): EdgeHit | null {
  const circleCenterIds = new Set(
    shapes.filter((s): s is CircleShape => s.type === "circle").map((s) => s.center)
  );
  let closestId: string | null = null;
  let closestDist = tolerance;
  for (const p of Object.values(points)) {
    if (circleCenterIds.has(p.id)) continue;
    const d = Math.hypot(raw.x - p.x, raw.y - p.y);
    if (d < closestDist) {
      closestDist = d;
      closestId = p.id;
    }
  }
  if (closestId) {
    return { kind: "point", shapeId: closestId, pointId: closestId };
  }

  return findEdgeHit(raw, shapes, points, tolerance);
}

type RectRegion =
  | { region: "edge"; axis: "x" | "y"; corner: "p1" | "p2" }
  | { region: "interior" };

export type RectRegionHit =
  | { region: "edge"; shapeId: string; axis: "x" | "y"; corner: "p1" | "p2" }
  | { region: "interior"; shapeId: string };

// Diferencia clicar numa aresta específica do retângulo (redimensiona só
// aquele lado — corner.axis é qual coordenada de p1/p2 vai mudar) de
// clicar dentro do corpo (move o retângulo inteiro). Usado só pela
// ferramenta Selecionar — o findEdgeHit acima serve outro propósito (cotar)
// e não distingue qual aresta específica, só width vs height.
export function findRectRegion(
  raw: Point,
  shapes: SketchShape[],
  points: Record<string, SketchPoint>,
  edgeTolerance: number
): RectRegionHit | null {
  for (let i = shapes.length - 1; i >= 0; i--) {
    const shape = shapes[i];
    if (shape.type !== "rect") continue;

    const region = hitTestRect(raw, shape, points, edgeTolerance);
    if (region) return { ...region, shapeId: shape.id };
  }
  return null;
}

function hitTestRect(
  raw: Point,
  shape: RectShape,
  points: Record<string, SketchPoint>,
  edgeTolerance: number
): RectRegion | null {
  const p1 = points[shape.p1];
  const p2 = points[shape.p2];
  if (!p1 || !p2) return null;

  const minX = Math.min(p1.x, p2.x);
  const maxX = Math.max(p1.x, p2.x);
  const minY = Math.min(p1.y, p2.y);
  const maxY = Math.max(p1.y, p2.y);

  if (
    raw.x < minX - edgeTolerance ||
    raw.x > maxX + edgeTolerance ||
    raw.y < minY - edgeTolerance ||
    raw.y > maxY + edgeTolerance
  ) {
    return null; // fora da bounding box (+ margem de tolerância)
  }

  const distLeft = Math.abs(raw.x - minX);
  const distRight = Math.abs(raw.x - maxX);
  const distBottom = Math.abs(raw.y - minY);
  const distTop = Math.abs(raw.y - maxY);
  const minDist = Math.min(distLeft, distRight, distBottom, distTop);

  if (minDist > edgeTolerance) {
    return { region: "interior" };
  }

  if (minDist === distLeft) {
    return { region: "edge", axis: "x", corner: p1.x === minX ? "p1" : "p2" };
  }
  if (minDist === distRight) {
    return { region: "edge", axis: "x", corner: p1.x === maxX ? "p1" : "p2" };
  }
  if (minDist === distBottom) {
    return { region: "edge", axis: "y", corner: p1.y === minY ? "p1" : "p2" };
  }
  return { region: "edge", axis: "y", corner: p1.y === maxY ? "p1" : "p2" };
}

export type LineRegionHit =
  | { region: "end"; shapeId: string; movingPointId: string; anchorPointId: string }
  | { region: "middle"; shapeId: string; pointIds: [string, string] };

// Zona perto de cada ponta (em fração do comprimento) que conta como
// "ponta" — o resto (o meio) é "corpo" e move a linha inteira.
const LINE_END_ZONE = 0.3;

// Mesma ideia do retângulo, adaptada pra uma linha: perto de uma ponta
// estica/encolhe só aquele lado (ao longo da direção da própria linha);
// perto do meio move a linha inteira.
export function findLineRegion(
  raw: Point,
  shapes: SketchShape[],
  points: Record<string, SketchPoint>,
  tolerance: number
): LineRegionHit | null {
  for (let i = shapes.length - 1; i >= 0; i--) {
    const shape = shapes[i];
    if (shape.type !== "line") continue;

    const p1 = points[shape.p1];
    const p2 = points[shape.p2];
    if (!p1 || !p2) continue;

    const { t, distance } = projectOntoSegment(raw, p1, p2);
    if (distance > tolerance) continue;

    if (t < LINE_END_ZONE) {
      return { region: "end", shapeId: shape.id, movingPointId: shape.p1, anchorPointId: shape.p2 };
    }
    if (t > 1 - LINE_END_ZONE) {
      return { region: "end", shapeId: shape.id, movingPointId: shape.p2, anchorPointId: shape.p1 };
    }
    return { region: "middle", shapeId: shape.id, pointIds: [shape.p1, shape.p2] };
  }
  return null;
}

// Decompõe uma forma "parecida com linha reta" (linha solta, ou o
// retângulo primitivo antigo — 4 arestas derivadas dos 2 cantos, ver
// RectShape em types.ts) nos segmentos que a formam — compartilhado por
// findNearestPointOnShapes e findNearbyLineMidpoint, que precisam da mesma
// lista de arestas.
function lineLikeSegments(shape: SketchShape, points: Record<string, SketchPoint>): [Point, Point][] {
  if (shape.type === "line") {
    const p1 = points[shape.p1];
    const p2 = points[shape.p2];
    return p1 && p2 ? [[p1, p2]] : [];
  }
  if (shape.type === "rect") {
    const p1 = points[shape.p1];
    const p2 = points[shape.p2];
    if (!p1 || !p2) return [];
    const b = { x: p2.x, y: p1.y };
    const d = { x: p1.x, y: p2.y };
    return [
      [p1, b],
      [b, p2],
      [p2, d],
      [d, p1],
    ];
  }
  return [];
}

// Encosta um novo ponto numa ARESTA existente (não só nos endpoints dela) —
// é o que dá a sensação de "a linha reconhece a outra e junta", ao estilo
// Inventor. Não faz split topológico da aresta existente (isso exigiria
// remapear a forma antiga em duas + qualquer cota que a referencie); o novo
// ponto só nasce numa posição exatamente sobre a aresta, visualmente
// encostado. Círculo fica de fora (ponto sobre um arco não é tão direto).
export function findNearestPointOnShapes(
  raw: Point,
  shapes: SketchShape[],
  points: Record<string, SketchPoint>,
  tolerance: number
): Point | null {
  let best: Point | null = null;
  let bestDist = tolerance;

  for (const shape of shapes) {
    // Rasgo fica de fora por ora (mesmo espírito do círculo: "encostar" numa
    // aresta reta faz sentido, num arco/rasgo não tão direto).
    if (shape.type === "circle" || shape.type === "point" || shape.type === "arc" || shape.type === "slot")
      continue;

    for (const [a, b] of lineLikeSegments(shape, points)) {
      const { t, distance } = projectOntoSegment(raw, a, b);
      if (distance < bestDist) {
        bestDist = distance;
        best = { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
      }
    }
  }

  return best;
}

// Ponto MÉDIO de uma aresta reta — snap específico, ao estilo Inventor (o
// glifo triangular que aparece exatamente no meio de uma aresta ao passar
// perto, distinto de "ponto mais próximo nela" acima, que gruda em
// QUALQUER posição ao longo dela). Gira sobre distância até o PRÓPRIO
// MEIO (não até a aresta em geral) — pra ter prioridade sobre "ponto mais
// próximo na aresta" em resolveSnapWithEdges (senão esse outro sempre
// ganharia, por construção, e o "ponto" só pareceria deslizar em cima da
// linha em vez de grudar firme no centro). Devolve também o id da forma
// (não só a coordenada) — usado pela ferramenta Coincidente pra saber
// qual LINHA pegar o meio, quando o clique não caiu perto de um ponto
// real já existente (ver handleConstraintClick em store.ts).
export function findNearbyLineMidpointShape(
  raw: Point,
  shapes: SketchShape[],
  points: Record<string, SketchPoint>,
  tolerance: number
): { shapeId: string; midpoint: Point } | null {
  let best: { shapeId: string; midpoint: Point } | null = null;
  let bestDist = tolerance;

  for (const shape of shapes) {
    if (shape.type === "circle" || shape.type === "point" || shape.type === "arc" || shape.type === "slot")
      continue;

    for (const [a, b] of lineLikeSegments(shape, points)) {
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const d = Math.hypot(raw.x - mid.x, raw.y - mid.y);
      if (d < bestDist) {
        bestDist = d;
        best = { shapeId: shape.id, midpoint: mid };
      }
    }
  }

  return best;
}

export function findNearbyLineMidpoint(
  raw: Point,
  shapes: SketchShape[],
  points: Record<string, SketchPoint>,
  tolerance: number
): Point | null {
  return findNearbyLineMidpointShape(raw, shapes, points, tolerance)?.midpoint ?? null;
}

// Mesma ideia, pra geometria de referência (arestas do sólido 3D projetadas
// no plano do sketch) — permite "encaixar" um novo ponto exatamente sobre a
// borda da peça, o uso prático de Project Geometry sem precisar promover a
// aresta inteira a geometria de verdade primeiro.
export function findNearestPointOnSegments(
  raw: Point,
  segments: { x1: number; y1: number; x2: number; y2: number }[],
  tolerance: number
): Point | null {
  let best: Point | null = null;
  let bestDist = tolerance;

  for (const seg of segments) {
    const a = { x: seg.x1, y: seg.y1 };
    const b = { x: seg.x2, y: seg.y2 };
    const { t, distance } = projectOntoSegment(raw, a, b);
    if (distance < bestDist) {
      bestDist = distance;
      best = { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
    }
  }

  return best;
}
