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

// Igual findClosedLoop, mas achando o loop que CONTÉM uma aresta específica
// (startShapeId) em vez de exigir que TODAS as linhas/arcos do sketch
// formem um loop só — usado pelo Ctrl+clique de seleção múltipla de perfil
// numa aresta solta (ex.: um dos 4 lados de um retângulo desenhado como 4
// linhas independentes, ver handleRawUp em sketch/store.ts): precisa achar
// o CONTORNO INTEIRO daquela aresta, ignorando outras arestas soltas do
// sketch que não têm nada a ver com ela. Só resolve loops SIMPLES (cada
// ponto tocado por exatamente 2 arestas do caminho) — uma ramificação (3+
// arestas no mesmo ponto) devolve null.
export function findClosedLoopContaining(
  shapes: SketchShape[],
  points: Record<string, SketchPoint>,
  startShapeId: string
): { shapeIds: string[]; points: Point[]; arcCenters: (Point | null)[] } | null {
  const edges = shapes.filter(
    (s): s is LineShape | ArcShape => (s.type === "line" && !s.isCenterLine) || s.type === "arc"
  );
  const start = edges.find((e) => e.id === startShapeId);
  if (!start) return null;

  const touching = new Map<string, (LineShape | ArcShape)[]>();
  for (const e of edges) {
    if (!touching.has(e.p1)) touching.set(e.p1, []);
    if (!touching.has(e.p2)) touching.set(e.p2, []);
    touching.get(e.p1)!.push(e);
    touching.get(e.p2)!.push(e);
  }

  const startId = start.p1;
  let currentId = start.p2;
  const orderedEdges: (LineShape | ArcShape)[] = [start];
  const usedIds = new Set<string>([start.id]);

  while (currentId !== startId) {
    const candidates = (touching.get(currentId) ?? []).filter((e) => !usedIds.has(e.id));
    if (candidates.length !== 1) return null; // ramificação ou ponta solta — não é loop simples
    const next = candidates[0];
    usedIds.add(next.id);
    orderedEdges.push(next);
    currentId = next.p1 === currentId ? next.p2 : next.p1;
    if (orderedEdges.length > edges.length) return null; // guarda contra loop mal formado
  }

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

  return {
    shapeIds: orderedEdges.map((e) => e.id),
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
  | { kind: "slot"; c1: Point; c2: Point; r: number }
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

    if (shape.type === "slot") {
      const c1 = points[shape.center1];
      const c2 = points[shape.center2];
      if (!c1 || !c2) continue;
      return { kind: "slot", c1: { x: c1.x, y: c1.y }, c2: { x: c2.x, y: c2.y }, r: shape.radius };
    }
  }

  // linhas de centro não são contorno de perfil, só referência de eixo
  const edges = shapes.filter(
    (s): s is LineShape | ArcShape => (s.type === "line" && !s.isCenterLine) || s.type === "arc"
  );
  const loop = findClosedLoop(edges, points);
  return loop ? { kind: "loop", points: loop.points, arcCenters: loop.arcCenters } : null;
}

// Perfil de UMA forma específica — só rect/circle/slot; LINHA é tratada à
// parte em findProfileSources (precisa achar o contorno fechado INTEIRO
// que ela pertence, e ela sozinha não chega lá — ver findClosedLoopContaining).
function profileSourceForShape(
  shape: SketchShape,
  points: Record<string, SketchPoint>
): NonNullable<ProfileSource> | null {
  if (shape.type === "rect") {
    const p1 = points[shape.p1];
    const p2 = points[shape.p2];
    if (!p1 || !p2) return null;
    return { kind: "rect", x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y };
  }
  if (shape.type === "circle") {
    const center = points[shape.center];
    if (!center) return null;
    return { kind: "circle", cx: center.x, cy: center.y, r: shape.radius };
  }
  if (shape.type === "slot") {
    const c1 = points[shape.center1];
    const c2 = points[shape.center2];
    if (!c1 || !c2) return null;
    return { kind: "slot", c1: { x: c1.x, y: c1.y }, c2: { x: c2.x, y: c2.y }, r: shape.radius };
  }
  return null;
}

// Perfis a extrudar/revolucionar/etc — com seleção múltipla (Ctrl+clique
// com a ferramenta Selecionar, ver toggleProfileSelection em
// sketch/store.ts) usa exatamente essas formas; sem seleção, cai no
// comportamento de sempre (findProfileSource: a forma mais recente, ou o
// contorno fechado de linhas). Vários perfis são UNIDOS (fuse) antes de
// extrudar, ver profilesToDrawing — não há detecção de "ilha vira furo"
// aqui, perfis sobrepostos só se fundem num só. Ctrl+clicar em QUALQUER
// lado de um contorno de linhas (ex.: retângulo desenhado como 4 linhas,
// ver handleRawUp em sketch/store.ts) marca as 4 na seleção (ver
// toggleProfileSelection) — dedup pelo seenLoopKeys abaixo, senão as 4
// virariam o MESMO perfil repetido 4x (profilesToDrawing tentaria fundir a
// mesma geometria consigo mesma).
export function findProfileSources(
  shapes: SketchShape[],
  points: Record<string, SketchPoint>,
  selectedIds: string[]
): NonNullable<ProfileSource>[] {
  if (selectedIds.length === 0) {
    const single = findProfileSource(shapes, points);
    return single ? [single] : [];
  }

  const byId = new Map(shapes.map((s) => [s.id, s]));
  const seenLoopKeys = new Set<string>();
  const results: NonNullable<ProfileSource>[] = [];
  for (const id of selectedIds) {
    const shape = byId.get(id);
    if (!shape) continue;
    if (shape.type === "line") {
      const loop = findClosedLoopContaining(shapes, points, id);
      if (!loop) continue;
      const loopKey = [...loop.shapeIds].sort().join(",");
      if (seenLoopKeys.has(loopKey)) continue;
      seenLoopKeys.add(loopKey);
      results.push({ kind: "loop", points: loop.points, arcCenters: loop.arcCenters });
      continue;
    }
    const profile = profileSourceForShape(shape, points);
    if (profile) results.push(profile);
  }
  return results;
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

// Caminho de Varredura: cadeia de linhas/arcos conectados que NÃO precisa
// fechar (ao contrário do perfil) — anda a partir de uma ponta livre (grau
// 1, ou seja, um vértice usado por só 1 aresta) se existir, senão de
// qualquer aresta (cadeia fechada também serve como caminho, só não é o
// caso comum). Linhas de centro não entram (mesma regra do perfil).
function findPathChain(
  shapes: SketchShape[],
  points: Record<string, SketchPoint>
): { points: Point[]; arcCenters: (Point | null)[] } | null {
  const edges = shapes.filter(
    (s): s is LineShape | ArcShape => (s.type === "line" && !s.isCenterLine) || s.type === "arc"
  );
  if (edges.length === 0) return null;

  const degree = new Map<string, number>();
  for (const e of edges) {
    degree.set(e.p1, (degree.get(e.p1) ?? 0) + 1);
    degree.set(e.p2, (degree.get(e.p2) ?? 0) + 1);
  }
  const freeEnd = [...degree.entries()].find(([, d]) => d === 1)?.[0];

  const remaining = edges.slice();
  let startId: string;
  let first: LineShape | ArcShape;
  if (freeEnd !== undefined) {
    const idx = remaining.findIndex((e) => e.p1 === freeEnd || e.p2 === freeEnd);
    [first] = remaining.splice(idx, 1);
    startId = freeEnd;
  } else {
    first = remaining.shift()!;
    startId = first.p1;
  }

  let currentId = first.p1 === startId ? first.p2 : first.p1;
  const orderedEdges: (LineShape | ArcShape)[] = [first];
  while (remaining.length > 0) {
    const idx = remaining.findIndex((e) => e.p1 === currentId || e.p2 === currentId);
    if (idx === -1) break; // pedaços soltos além da cadeia principal são ignorados
    const [edge] = remaining.splice(idx, 1);
    currentId = edge.p1 === currentId ? edge.p2 : edge.p1;
    orderedEdges.push(edge);
  }

  const vertexIds: string[] = [startId];
  const arcCenterIds: (string | null)[] = [];
  let walkId = startId;
  for (const edge of orderedEdges) {
    const nextId = edge.p1 === walkId ? edge.p2 : edge.p1;
    arcCenterIds.push(edge.type === "arc" ? edge.center : null);
    vertexIds.push(nextId);
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

// Desenha o caminho de Varredura como um Drawing ABERTO (.done(), não
// .close()) — mesma construção ponto-a-ponto de profileToDrawing pro caso
// "loop", só sem fechar de volta pro início.
export function pathToDrawing(shapes: SketchShape[], points: Record<string, SketchPoint>): Drawing | null {
  const chain = findPathChain(shapes, points);
  if (!chain || chain.points.length < 2) return null;

  const { points: pts, arcCenters } = chain;
  const [firstPoint, ...rest] = pts;
  let pen = draw([firstPoint.x, firstPoint.y]);
  let current = firstPoint;

  rest.forEach((point, i) => {
    const center = arcCenters[i];
    if (center) {
      const radius = Math.hypot(current.x - center.x, current.y - center.y);
      const inner = arcInnerPoint(center, current, point, radius);
      pen = pen.threePointsArcTo([point.x, point.y], [inner.x, inner.y]);
    } else {
      pen = pen.lineTo([point.x, point.y]);
    }
    current = point;
  });

  return pen.done();
}

// Ponto de referência do perfil (centroide aproximado) — usado só pela
// Espiral pra achar a distância até o eixo (o "raio" da hélice, nunca
// escolhido à parte, igual Revolução não pede raio).
export function profileReferencePoint(profile: ProfileSource): Point | null {
  if (!profile) return null;
  if (profile.kind === "rect") return { x: (profile.x1 + profile.x2) / 2, y: (profile.y1 + profile.y2) / 2 };
  if (profile.kind === "circle") return { x: profile.cx, y: profile.cy };
  if (profile.kind === "slot") return { x: (profile.c1.x + profile.c2.x) / 2, y: (profile.c1.y + profile.c2.y) / 2 };
  const n = profile.points.length;
  const sx = profile.points.reduce((a, p) => a + p.x, 0) / n;
  const sy = profile.points.reduce((a, p) => a + p.y, 0) / n;
  return { x: sx, y: sy };
}

// Distância perpendicular de um ponto até uma reta (2D, local ao plano do
// sketch) — origin+direction definem a reta, direction assumida unitária
// (mesma convenção de findCenterLine, que já normaliza).
export function pointToLineDistance2D(p: Point, origin: Point, direction: Point): number {
  const dx = p.x - origin.x;
  const dy = p.y - origin.y;
  return Math.abs(dx * direction.y - dy * direction.x);
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

  if (profile.kind === "slot") {
    const { c1, c2, r } = profile;
    if (r < 1e-6) return null;
    const dx = c2.x - c1.x;
    const dy = c2.y - c1.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return null;
    const ux = dx / len;
    const uy = dy / len;
    // Normal (perpendicular ao eixo center1→center2) dá as 2 retas
    // tangentes; o próprio eixo (u) dá o ápice de cada tampa — os 2 pontos
    // tangentes em cada centro são diametralmente opostos (180°), então
    // arcInnerPoint (feito pra arcos < 180°, ver seu comentário) não serve
    // aqui: o ápice tem que vir explicitamente do eixo, não do ponto médio
    // da corda (que cairia em cima do próprio centro).
    const nx = -uy;
    const ny = ux;
    const p1 = { x: c1.x + nx * r, y: c1.y + ny * r };
    const p2 = { x: c2.x + nx * r, y: c2.y + ny * r };
    const p3 = { x: c2.x - nx * r, y: c2.y - ny * r };
    const p4 = { x: c1.x - nx * r, y: c1.y - ny * r };
    const apex2 = { x: c2.x + ux * r, y: c2.y + uy * r };
    const apex1 = { x: c1.x - ux * r, y: c1.y - uy * r };
    return draw([p1.x, p1.y])
      .lineTo([p2.x, p2.y])
      .threePointsArcTo([p3.x, p3.y], [apex2.x, apex2.y])
      .lineTo([p4.x, p4.y])
      .threePointsArcTo([p1.x, p1.y], [apex1.x, apex1.y])
      .close();
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

// Aceita 1 perfil OU vários (seleção múltipla, ver findProfileSources) e
// devolve um Drawing só, unindo (fuse) um a um — extrude/revolução/etc não
// precisam saber se veio de 1 forma ou de várias, só recebem um Drawing
// pronto igual sempre receberam.
export function profilesToDrawing(profiles: NonNullable<ProfileSource> | NonNullable<ProfileSource>[]): Drawing | null {
  const list = Array.isArray(profiles) ? profiles : [profiles];
  let combined: Drawing | null = null;
  for (const p of list) {
    const d = profileToDrawing(p);
    if (!d) continue;
    combined = combined ? combined.fuse(d) : d;
  }
  return combined;
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
