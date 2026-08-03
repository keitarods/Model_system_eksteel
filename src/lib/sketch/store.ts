import { create } from "zustand";
import { BASE_SKETCH_PLANE, ORIGIN_POINT, ORIGIN_POINT_ID } from "./types";
import type {
  ArcShape,
  CircleShape,
  DimensionAnnotation,
  EdgeRef,
  LineShape,
  NewSketchConstraint,
  Point,
  SketchConstraint,
  SketchPlane,
  SketchPoint,
  SketchShape,
  SketchTool,
} from "./types";
import { findNearbyPoint, resolveSnapWithEdges } from "./snap";
import { findEdgeHit, findEdgeOrPointHit, findLineRegion, findRectRegion, findNearbyLineMidpointShape, projectOntoSegment, type EdgeHit } from "./hitTest";
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
} from "./render";
import { findCornerNear, computeFillet, computeChamfer } from "./filletChamfer";
import { DRAG_TOOLS, CLICK_TOOLS, SLOT_TOOLS } from "./tools";
import { evaluateFormula, extractParamNames } from "./formula";

// Tolerâncias em mm (unidades de mundo do plano do sketch) — as mesmas,
// independente de quem gerou o "raw" (SVG 2D via CTM, ou raycast num plano
// 3D via worldToLocalPoint), por isso moraram aqui e não numa view.
const SNAP_TOLERANCE = 6;
const EDGE_SELECT_TOLERANCE = 8;
const SELECT_POINT_TOLERANCE = 8;
const CLICK_VS_DRAG_THRESHOLD = 4;

// Ferramentas cujo 1º clique resolve um PONTO (ver resolvePointAt/
// previewSnap) — mostram o indicador de snap ao passar o mouse por perto,
// ANTES do 1º clique, ao estilo Inventor (dimension/SLOT_TOOLS já têm seu
// próprio tratamento de hover, tratado à parte em handleRawMove). Fora
// dessa lista ficam as ferramentas de clique único que resolvem uma
// ARESTA/forma inteira em vez de um ponto (horizontal/vertical/
// perpendicular/tangente/fillet2d/chamfer2d/projectGeometry) — o mesmo
// indicador de ponto não faria sentido pra elas.
const HOVER_SNAP_TOOLS = new Set<SketchTool>(["line", "centerline", "rect", "circle", "measure", "point", "joinPoints"]);

// Default de propagateAxisLocks/reapplyConstraints quando ninguém passa um
// fixedPointIds de verdade (ver comentário de propagateAxisLocks) — uma
// constante módulo-level em vez de `new Set()` inline no default param só
// pra não recriar um Set vazio a cada chamada sem necessidade.
const EMPTY_FIXED_SET: ReadonlySet<string> = new Set();

export type ReferenceSegment = { x1: number; y1: number; x2: number; y2: number };

// Qual segmento de referência (aresta real do sólido/plano, já projetada em
// 2D local — ver referenceGeometry em ModeladorWorkspace.tsx) está mais
// perto do clique — usado só pela ferramenta Projetar Geometria.
function findNearestReferenceSegment(
  raw: Point,
  referenceGeometry: ReferenceSegment[],
  tolerance: number
): ReferenceSegment | null {
  let best: ReferenceSegment | null = null;
  let bestDist = tolerance;
  for (const seg of referenceGeometry) {
    const { distance: d } = projectOntoSegment(raw, { x: seg.x1, y: seg.y1 }, { x: seg.x2, y: seg.y2 });
    if (d < bestDist) {
      bestDist = d;
      best = seg;
    }
  }
  return best;
}

// Recorte de copiar/colar: uma forma + os pontos que ela referencia,
// clonados (não é uma referência viva pro shape/pontos originais — copiar,
// apagar o original e colar continua funcionando). pasteCount conta quantas
// vezes já colou desde a última cópia, pra cada colagem subsequente
// deslocar um pouco mais (evita empilhar exatamente em cima da anterior).
type SketchClipboard = { shape: SketchShape; points: SketchPoint[]; pasteCount: number };

// Ids de ponto que uma forma referencia — central pra copiar/colar (clonar
// só os pontos realmente usados) e reaproveitável se mais operações em lote
// precisarem disso no futuro.
export function pointIdsOfShape(shape: SketchShape): string[] {
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

// Acha o CONJUNTO de ids de forma do contorno fechado (linhas/arcos, sem
// linha de centro) que contém startShapeId — anda por igualdade de id de
// ponto, só resolve loops SIMPLES (cada ponto tocado por exatamente 2
// arestas do caminho; ramificação devolve null). Usado só por
// toggleProfileSelection pra decidir com qual "id representante" amarrar o
// Ctrl+clique numa aresta solta (ex.: um dos 4 lados de um retângulo
// desenhado como 4 linhas, ver handleRawUp) — precisa ser puro id, sem
// coordenadas, DE PROPÓSITO: replicad/geometry.ts tem uma versão irmã
// (findClosedLoopContaining) que resolve coordenadas de verdade pra montar
// o profile de Extrudar, mas geometry.ts importa o pacote replicad (WASM) —
// puxar isso pra dentro do sketch/store.ts faria até abrir/editar um
// esboço carregar o replicad à toa, então essa versão fica deliberadamente
// duplicada (menor, só ids) em vez de compartilhada.
function findLoopShapeIds(shapes: SketchShape[], startShapeId: string): string[] | null {
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
  const usedIds = new Set<string>([start.id]);
  const orderedIds = [start.id];

  while (currentId !== startId) {
    const candidates = (touching.get(currentId) ?? []).filter((e) => !usedIds.has(e.id));
    if (candidates.length !== 1) return null; // ramificação ou ponta solta — não é loop simples
    const next = candidates[0];
    usedIds.add(next.id);
    orderedIds.push(next.id);
    currentId = next.p1 === currentId ? next.p2 : next.p1;
    if (orderedIds.length > edges.length) return null; // guarda contra loop mal formado
  }

  return orderedIds.length >= 3 ? orderedIds : null;
}

// Expande um conjunto de movimentos de ponto em cascata: qualquer LineShape
// com axisLock que TOQUE um ponto que está sendo movido precisa que a PONTA
// OPOSTA acompanhe SÓ no eixo travado (X pra vertical, Y pra horizontal) —
// senão o canto compartilhado com o lado vizinho fica pra trás e o
// retângulo desconecta. É isso que mantém um retângulo desenhado com a
// ferramenta Retângulo (ou convertido de um antigo, ver convertRectToLines)
// reto tanto arrastando um canto (Selecionar) quanto editando uma cota que
// mexe num dos pontos (updateDistanceDimension etc.) — TODO caminho que move
// ponto passa por aqui, não só o arrasto direto (ver movePoints, que aplica
// isso sempre, e os 3 modos de selectDrag em handleRawMove, que aplicam pro
// PREVIEW ao vivo mostrar a propagação antes de soltar). Roda em fila (BFS):
// uma ponta que se move pode por sua vez "puxar" outra ponta de OUTRA linha
// travada, e assim por diante, até nada mais mudar — cobre não só o caso de
// 1 retângulo isolado, mas cadeias mais longas de linhas H/V conectadas.
// Não é um solver de verdade (sem sistema de equações simultâneas) — só
// essa propagação em cascata, suficiente pro caso comum; geometrias com um
// ponto compartilhado por 3+ linhas travadas também propagam, mas sem
// garantia de resultado "certo" fora do caso simples retângulo/polilinha.
// fixedPointIds só é passado de verdade pelo preview de arrasto AO VIVO
// (computeDragPreview) — movePoints (o choke-point também usado por
// edição de cota/ferramentas de restrição) chama isso SEM esse argumento
// de propósito: "Fixo" (ver toggleFixedShape) deve impedir ARRASTAR a
// geometria manualmente (já bloqueado antes mesmo de chegar aqui, ver os
// checks em handleRawDown), mas não deve travar uma edição DELIBERADA de
// cota — travar os dois deixaria "editar a cota não faz nada" sem
// explicação nenhuma pro usuário.
//
// cascadeBlocked (opcional, default nenhum filtro): NUNCA filtra o(s)
// ponto(s) SEED (o alvo direto/deliberado da chamada), só os pontos
// alcançados por CASCATA (a ponta oposta de uma linha axisLock vizinha).
// Passado só por updateDistanceDimension/updateEdgeDistanceDimension (via
// movePoints), pra impedir que editar UMA cota arraste, de carona via
// axisLock, um ponto que já pertence a OUTRA cota não-referência já
// definida — ao estilo Inventor, um valor já travado só muda se a PRÓPRIA
// cota for editada. Uma tentativa anterior de aplicar isso em TODA chamada
// de movePoints (inclusive commit de arrasto manual) quebrava a rigidez
// H/V de qualquer retângulo que tivesse alguma cota nele — por isso fica
// de fora por padrão, só entra em cena nesses 2 chamadores específicos.
function propagateAxisLocks(
  initialUpdates: Record<string, Point>,
  shapes: SketchShape[],
  points: Record<string, SketchPoint>,
  fixedPointIds: ReadonlySet<string> = EMPTY_FIXED_SET,
  cascadeBlocked: (pointId: string) => boolean = () => false
): Record<string, Point> {
  const updates: Record<string, Point> = {};
  const queue: string[] = [];
  for (const [id, pos] of Object.entries(initialUpdates)) {
    if (id === ORIGIN_POINT_ID || fixedPointIds.has(id)) continue;
    updates[id] = pos;
    queue.push(id);
  }
  const processed = new Set<string>();

  while (queue.length > 0) {
    const pointId = queue.shift()!;
    if (processed.has(pointId)) continue;
    processed.add(pointId);
    const newPos = updates[pointId];
    if (!newPos) continue;

    for (const shape of shapes) {
      if (shape.type !== "line" || !shape.axisLock) continue;
      if (shape.p1 !== pointId && shape.p2 !== pointId) continue;
      const otherId = shape.p1 === pointId ? shape.p2 : shape.p1;
      // otherId nunca é um seed (só chega aqui via cascata), então
      // cascadeBlocked pode recusar ele sem nunca travar a própria edição
      // que originou a chamada.
      if (otherId === ORIGIN_POINT_ID || fixedPointIds.has(otherId) || cascadeBlocked(otherId)) continue;
      const other = updates[otherId] ?? points[otherId];
      if (!other) continue;
      const nextPos = shape.axisLock === "horizontal" ? { x: other.x, y: newPos.y } : { x: newPos.x, y: other.y };
      const current = updates[otherId];
      if (!current || current.x !== nextPos.x || current.y !== nextPos.y) {
        updates[otherId] = nextPos;
        queue.push(otherId);
      }
    }
  }

  return updates;
}

// Ângulo-alvo (a 90° de lineA, o lado — +90 ou -90 — mais perto do ângulo
// ATUAL de lineB) pra deixar lineB perpendicular a lineA, girando em
// torno do ponto que ela compartilha com lineA (se houver — senão em
// torno do próprio p1 de lineB). Compartilhado entre o clique da
// ferramenta Perpendicular (makePerpendicular) e reapplyConstraints (que
// reforça o resultado sempre que a geometria mudar de novo) — mesma conta,
// só a origem dos `points` muda (get().points no clique, o snapshot já em
// progresso na cascata de reapplyConstraints).
function computePerpendicularTarget(
  lineA: LineShape,
  lineB: LineShape,
  points: Record<string, SketchPoint>
): { movingId: string; pos: Point } | null {
  const pA1 = points[lineA.p1];
  const pA2 = points[lineA.p2];
  if (!pA1 || !pA2) return null;
  const angleA = Math.atan2(pA2.y - pA1.y, pA2.x - pA1.x);

  let pivotId = lineB.p1;
  let movingId = lineB.p2;
  if (lineB.p2 === lineA.p1 || lineB.p2 === lineA.p2) {
    pivotId = lineB.p2;
    movingId = lineB.p1;
  }

  const pivot = points[pivotId];
  const moving = points[movingId];
  if (!pivot || !moving) return null;

  const length = Math.hypot(moving.x - pivot.x, moving.y - pivot.y);
  if (length < 1e-6) return null;

  const currentAngle = Math.atan2(moving.y - pivot.y, moving.x - pivot.x);
  const target1 = angleA + Math.PI / 2;
  const target2 = angleA - Math.PI / 2;
  const normalize = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
  const targetAngle =
    Math.abs(normalize(target1 - currentAngle)) <= Math.abs(normalize(target2 - currentAngle))
      ? target1
      : target2;

  return {
    movingId,
    pos: { x: pivot.x + Math.cos(targetAngle) * length, y: pivot.y + Math.sin(targetAngle) * length },
  };
}

// Translação (mesmo delta nas 2 pontas) que deixa `line` tangente a
// `circle`, mantendo o lado em que ela já está — devolve null se já está
// tangente (evita reaplicar um "ajuste" de ponto flutuante infinitesimal
// toda hora). Compartilhado entre makeTangent e reapplyConstraints.
function computeTangentTarget(
  line: LineShape,
  circle: CircleShape,
  points: Record<string, SketchPoint>
): { p1: Point; p2: Point } | null {
  const p1 = points[line.p1];
  const p2 = points[line.p2];
  const center = points[circle.center];
  if (!p1 || !p2 || !center) return null;

  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return null;

  const perpX = -dy / len;
  const perpY = dx / len;

  const toCx = center.x - p1.x;
  const toCy = center.y - p1.y;
  const signedDist = toCx * perpX + toCy * perpY;
  const side = signedDist >= 0 ? 1 : -1;
  const adjustment = circle.radius * side - signedDist;
  if (Math.abs(adjustment) < 1e-9) return null;

  return {
    p1: { x: p1.x + perpX * adjustment, y: p1.y + perpY * adjustment },
    p2: { x: p2.x + perpX * adjustment, y: p2.y + perpY * adjustment },
  };
}

// Projeção perpendicular de `pointId` em cima de `line`, presa ao próprio
// SEGMENTO (0..1) — devolve null se já é ponta da linha ou se não há o que
// projetar. Compartilhado entre makePointCoincidentWithLine e
// reapplyConstraints.
function computePointOnLineTarget(
  pointId: string,
  line: LineShape,
  points: Record<string, SketchPoint>
): Point | null {
  if (pointId === line.p1 || pointId === line.p2) return null;
  const point = points[pointId];
  const p1 = points[line.p1];
  const p2 = points[line.p2];
  if (!point || !p1 || !p2) return null;

  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-9) return null;

  const t = Math.max(0, Math.min(1, ((point.x - p1.x) * dx + (point.y - p1.y) * dy) / lenSq));
  return { x: p1.x + t * dx, y: p1.y + t * dy };
}

// Translação (mesmo delta nas 2 pontas) que leva o MEIO de `line` até
// `target` — devolve null se a linha já toca a origem (não dá pra
// transladar só uma ponta) ou se o meio já coincide. Compartilhado entre
// makeLineMidpointCoincidentWithPoint e reapplyConstraints.
function computeLineMidpointOnPointTarget(
  line: LineShape,
  target: Point,
  points: Record<string, SketchPoint>
): { p1: Point; p2: Point } | null {
  if (line.p1 === ORIGIN_POINT_ID || line.p2 === ORIGIN_POINT_ID) return null;
  const p1 = points[line.p1];
  const p2 = points[line.p2];
  if (!p1 || !p2) return null;

  const midX = (p1.x + p2.x) / 2;
  const midY = (p1.y + p2.y) / 2;
  const dx = target.x - midX;
  const dy = target.y - midY;
  if (Math.hypot(dx, dy) < 1e-9) return null;

  return {
    p1: { x: p1.x + dx, y: p1.y + dy },
    p2: { x: p2.x + dx, y: p2.y + dy },
  };
}

// Id da forma/ponto "dependente" de uma restrição — o lado que É AJUSTADO
// pra satisfazer ela (lineB em perpendicular, a própria linha em
// tangente/meio-de-linha, o ponto em pointOnLine). Usado por
// upsertConstraint pra substituir qualquer restrição ANTERIOR que já
// controlasse esse mesmo dependente (uma forma não deveria ter 2
// restrições relacionais disputando o mesmo grau de liberdade ao mesmo
// tempo — o resultado não seria previsível).
function constraintDependentId(c: NewSketchConstraint): string {
  switch (c.kind) {
    case "perpendicular":
      return c.lineBId;
    case "tangent":
      return c.lineId;
    case "pointOnLine":
      return c.pointId;
    case "lineMidpointOnPoint":
      return c.lineId;
  }
}

// Reforça toda restrição relacional persistente (perpendicular/tangente/
// pointOnLine/lineMidpointOnPoint — ver SketchConstraint em types.ts)
// contra a geometria ATUAL, numa única passada na ORDEM da lista — não é
// um solver de verdade (sistema de equações simultâneas): se a restrição B
// depende de algo que a restrição A (mais cedo na lista) acabou de mudar,
// B já vê o resultado de A (a passada é sequencial), mas não há iteração
// até convergir nem detecção de conflito entre restrições concorrentes.
// Suficiente pro caso comum (cadeias curtas tipo "perpendicular usando uma
// linha que por sua vez é tangente a um círculo"), chamado sempre que
// qualquer ponto se move (ver movePoints) pra manter o resultado de pé em
// vez de só valer no instante em que a ferramenta foi usada. Cada updates
// aplicado passa por propagateAxisLocks também, igual qualquer outro
// movimento de ponto — mexer numa linha pra satisfazer uma restrição pode
// perfeitamente puxar um lado vizinho travado em H/V junto.
function reapplyConstraints(
  constraints: SketchConstraint[],
  shapes: SketchShape[],
  points: Record<string, SketchPoint>,
  fixedPointIds: ReadonlySet<string> = EMPTY_FIXED_SET,
  cascadeBlocked: (pointId: string) => boolean = () => false
): Record<string, SketchPoint> {
  if (constraints.length === 0) return points;
  let current = points;

  const applyPointUpdates = (updates: Record<string, Point>) => {
    const expanded = propagateAxisLocks(updates, shapes, current, fixedPointIds, cascadeBlocked);
    const next = { ...current };
    for (const [id, pos] of Object.entries(expanded)) {
      if (!next[id] || id === ORIGIN_POINT_ID) continue;
      next[id] = { id, x: pos.x, y: pos.y };
    }
    current = next;
  };

  for (const c of constraints) {
    if (c.kind === "perpendicular") {
      const lineA = shapes.find((sh) => sh.id === c.lineAId);
      const lineB = shapes.find((sh) => sh.id === c.lineBId);
      if (!lineA || lineA.type !== "line" || !lineB || lineB.type !== "line") continue;
      const target = computePerpendicularTarget(lineA, lineB, current);
      if (target) applyPointUpdates({ [target.movingId]: target.pos });
    } else if (c.kind === "tangent") {
      const line = shapes.find((sh) => sh.id === c.lineId);
      const circle = shapes.find((sh) => sh.id === c.circleId);
      if (!line || line.type !== "line" || !circle || circle.type !== "circle") continue;
      const target = computeTangentTarget(line, circle, current);
      if (target) applyPointUpdates({ [line.p1]: target.p1, [line.p2]: target.p2 });
    } else if (c.kind === "pointOnLine") {
      if (c.pointId === ORIGIN_POINT_ID) continue;
      const line = shapes.find((sh) => sh.id === c.lineId);
      if (!line || line.type !== "line") continue;
      const target = computePointOnLineTarget(c.pointId, line, current);
      if (target) applyPointUpdates({ [c.pointId]: target });
    } else if (c.kind === "lineMidpointOnPoint") {
      const line = shapes.find((sh) => sh.id === c.lineId);
      const targetPoint = current[c.pointId];
      if (!line || line.type !== "line" || !targetPoint) continue;
      const target = computeLineMidpointOnPointTarget(line, targetPoint, current);
      if (target) applyPointUpdates({ [line.p1]: target.p1, [line.p2]: target.p2 });
    }
  }

  return current;
}

// Mesma ideia de reapplyConstraints, mas pro PREVIEW ao vivo de arrasto
// (dragPreview) — que é um mapa de OVERRIDE parcial (só os ids que
// mudaram, mesclados por cima do pool real na hora de desenhar, ver
// renderPoints em SketchOverlay3D.tsx/SketchEditor), não o pool inteiro
// como reapplyConstraints devolve. Monta um pool "virtual" com os
// overrides já aplicados só pra alimentar propagateAxisLocks/
// reapplyConstraints, sem commitar nada na store, e devolve de volta só o
// DIFF contra o pool real.
function computeDragPreview(
  updates: Record<string, Point>,
  shapes: SketchShape[],
  points: Record<string, SketchPoint>,
  constraints: SketchConstraint[],
  fixedPointIds: ReadonlySet<string>
): Record<string, Point> {
  const expanded = propagateAxisLocks(updates, shapes, points, fixedPointIds);
  const merged: Record<string, SketchPoint> = { ...points };
  for (const [id, pos] of Object.entries(expanded)) {
    if (!merged[id] || id === ORIGIN_POINT_ID) continue;
    merged[id] = { id, x: pos.x, y: pos.y };
  }
  const reapplied = reapplyConstraints(constraints, shapes, merged, fixedPointIds);

  const diff: Record<string, Point> = {};
  for (const [id, p] of Object.entries(reapplied)) {
    const original = points[id];
    if (!original || original.x !== p.x || original.y !== p.y) {
      diff[id] = { x: p.x, y: p.y };
    }
  }
  return diff;
}

// Ids de ponto que uma referência de aresta (a ou b de uma cota
// "edgeDistance") toca — "line"/"rectEdge" resolvem pras pontas de
// verdade da forma; "point" é o próprio ponto; "slotTangent" nunca
// referencia um ponto próprio (o raio do rasgo não é a posição de um
// ponto), devolve lista vazia.
function edgeRefPointIds(ref: EdgeRef, shapes: SketchShape[]): string[] {
  if (ref.kind === "line") {
    const line = shapes.find((sh) => sh.id === ref.lineId);
    return line && line.type === "line" ? [line.p1, line.p2] : [];
  }
  if (ref.kind === "point") return [ref.pointId];
  if (ref.kind === "rectEdge") {
    const rect = shapes.find((sh) => sh.id === ref.rectId);
    return rect && rect.type === "rect" ? [rect.p1, rect.p2] : [];
  }
  return [];
}

function edgeRefIncludesPoint(ref: EdgeRef, pointId: string, shapes: SketchShape[]): boolean {
  return edgeRefPointIds(ref, shapes).includes(pointId);
}

// Ao estilo Inventor: uma vez que uma cota (não-referência, ver
// isReference em types.ts) mede uma geometria, essa geometria só pode
// mudar editando a PRÓPRIA cota (ou uma fórmula que a alimente) — nunca
// arrastando o ponto/aresta direto com a ferramenta Selecionar. Cota de
// referência ("driven dimension") é o oposto: só relata a medida, a
// geometria continua livre pra arrastar. Essas funções são consultadas em
// handleRawDown, ANTES de armar um selectDrag — se travado, o clique ainda
// seleciona a forma (ver cada chamador), só não arma arrasto nenhum, então
// a geometria simplesmente não se move (igual um sketch totalmente
// restringido no Inventor: o clique "pega" mas arrastar não faz nada).
// excludeDimensionId pula UMA cota específica na varredura — usado por
// updateDistanceDimension/updateEdgeDistanceDimension pra perguntar "esse
// ponto já pertence a OUTRA cota (que não essa que estou editando agora)?"
// sem a cota se auto-travar (ela SEMPRE referencia os próprios pontos).
function isPointDrivenByDimension(
  pointId: string,
  dimensions: DimensionAnnotation[],
  shapes: SketchShape[],
  excludeDimensionId?: string
): boolean {
  for (const d of dimensions) {
    if (d.id === excludeDimensionId) continue;
    if (d.isReference) continue;
    if (
      d.kind === "distance" &&
      (d.p1 === pointId || d.p2 === pointId || d.patternFollowers?.some((f) => f.pointId === pointId))
    ) {
      return true;
    }
    if (d.kind === "arcRadius") {
      const arc = shapes.find((sh) => sh.id === d.arcId);
      if (arc && arc.type === "arc" && (arc.p1 === pointId || arc.p2 === pointId)) return true;
    }
    if (d.kind === "width" || d.kind === "height") {
      // p1 (âncora) ou p2 (canto que updateWidthDimension/updateHeightDimension
      // move) — arrastar QUALQUER um livremente em 2D (ver o modo "point"
      // genérico em handleRawDown, que atende um clique bem em cima do
      // canto ANTES do findRectRegion específico de aresta) mudaria a
      // largura/altura já cotada.
      const rect = shapes.find((sh) => sh.id === d.rectId);
      if (rect && rect.type === "rect" && (rect.p1 === pointId || rect.p2 === pointId)) return true;
    }
    if (d.kind === "edgeDistance" && (edgeRefIncludesPoint(d.a, pointId, shapes) || edgeRefIncludesPoint(d.b, pointId, shapes))) {
      return true;
    }
  }
  return false;
}

// "Restritivo" pro propósito de updateDistanceDimension/
// updateEdgeDistanceDimension escolherem qual lado mover: OU já medido
// por outra cota não-referência (ver isPointDrivenByDimension) OU tem a
// restrição "Fixo" (ver fixedPointIds/toggleFixedShape — ex.: geometria
// projetada, que nasce fixa nas 2 pontas). Sem incluir "Fixo" aqui, editar
// a distância até uma linha PROJETADA movia a linha em vez do outro lado
// — "Fixo" bloqueia arrasto manual (ver handleRawDown) mas não passava
// pela checagem de isPointDrivenByDimension, que só olha outras cotas.
function isPointRestrictive(
  pointId: string,
  dimensions: DimensionAnnotation[],
  shapes: SketchShape[],
  fixedPointIds: ReadonlySet<string>,
  excludeDimensionId?: string
): boolean {
  return fixedPointIds.has(pointId) || isPointDrivenByDimension(pointId, dimensions, shapes, excludeDimensionId);
}

function isCircleRadiusDrivenByDimension(circleId: string, dimensions: DimensionAnnotation[]): boolean {
  return dimensions.some((d) => !d.isReference && d.kind === "radius" && d.circleId === circleId);
}

// axis "x" (aresta vertical, ver findRectRegion em hitTest.ts) corresponde
// à cota "width"; axis "y" (aresta horizontal) à cota "height" — mesma
// correlação usada por updateWidthDimension/updateHeightDimension.
function isRectAxisDrivenByDimension(
  rectId: string,
  axis: "x" | "y",
  dimensions: DimensionAnnotation[]
): boolean {
  return dimensions.some(
    (d) =>
      !d.isReference &&
      "rectId" in d &&
      d.rectId === rectId &&
      ((axis === "x" && d.kind === "width") || (axis === "y" && d.kind === "height"))
  );
}

// Valor numérico ATUAL de uma cota (raio ou distância), derivado da
// geometria de verdade via resolveDimension — usado por resolveFormulaParam
// pra resolver uma referência (dN) dentro da fórmula de OUTRA cota.
function dimensionCurrentValue(
  dim: DimensionAnnotation,
  shapes: SketchShape[],
  points: Record<string, SketchPoint>
): number | null {
  const render = resolveDimension(dim, shapes, points);
  if (!render) return null;
  return render.kind === "radius" ? render.r : Math.hypot(render.x2 - render.x1, render.y2 - render.y1);
}

// Cota clicada perto o bastante da sua PRÓPRIA linha de cota (já deslocada
// pelo offset/labelT ou offset/angle atuais, não a geometria medida) —
// usado só pela ferramenta Selecionar pra iniciar o arrasto. Roda ANTES do
// resto da cascata de seleção (ponto/retângulo/linha/círculo) pra uma cota
// não ficar "atrás" da geometria que ela mede, já que a linha de cota
// normalmente fica bem perto dela. Guarda a geometria de referência SEM
// offset (a/b do segmento, ou center/r do círculo) — nunca muda durante o
// arrasto, então handleRawMove recalcula offset+labelT (ou offset+angle)
// DIRETO da posição atual do mouse a cada frame, sem acumular delta (ver
// dimensionDrag/dimensionDragPreview no estado).
type DimensionHit =
  | { dimensionId: string; kind: "distance"; a: Point; b: Point }
  | { dimensionId: string; kind: "radius"; center: Point; r: number };

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
      const geo = computeRadiusDimensionGeometry(render.cx, render.cy, render.r, offset, dim.angle);
      const { distance: d } = projectOntoSegment(raw, geo.edge, geo.tip);
      if (d < bestDist) {
        bestDist = d;
        best = { dimensionId: dim.id, kind: "radius", center: { x: render.cx, y: render.cy }, r: render.r };
      }
      continue;
    }

    const geo = computeDimensionLineGeometry({ x: render.x1, y: render.y1 }, { x: render.x2, y: render.y2 }, offset, dim.labelT);
    if (!geo) continue;
    const { distance: d } = projectOntoSegment(raw, geo.dimA, geo.dimB);
    if (d < bestDist) {
      bestDist = d;
      best = { dimensionId: dim.id, kind: "distance", a: { x: render.x1, y: render.y1 }, b: { x: render.x2, y: render.y2 } };
    }
  }

  return best;
}

// Arestas retas E pontos soltos (ex.: centro de círculo, ver kind "point"
// em hitTest.ts) entram no fluxo de 2 cliques (cota relacional entre as 2
// referências) — raio de círculo/arco/rasgo continua cotando na hora, num
// clique só (ver handleRawUp). dimensionPick1 guarda sempre esse tipo
// restrito (nunca um hit de raio), garantido pelo type guard abaixo em todo
// ponto que escreve nesse campo.
type LineLikeEdgeHit = Extract<EdgeHit, { kind: "line" | "rectWidth" | "rectHeight" | "slotLength" }>;
type PointEdgeHit = Extract<EdgeHit, { kind: "point" }>;
type PickableEdgeHit = LineLikeEdgeHit | PointEdgeHit;

function isLineLikeHit(hit: EdgeHit): hit is LineLikeEdgeHit {
  return hit.kind === "line" || hit.kind === "rectWidth" || hit.kind === "rectHeight" || hit.kind === "slotLength";
}

function isPickableHit(hit: EdgeHit): hit is PickableEdgeHit {
  return isLineLikeHit(hit) || hit.kind === "point";
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
function sameEdgeHit(a: PickableEdgeHit, b: EdgeHit): boolean {
  if (a.kind !== b.kind || a.shapeId !== b.shapeId) return false;
  if (a.kind === "rectWidth" && b.kind === "rectWidth") return a.edge === b.edge;
  if (a.kind === "rectHeight" && b.kind === "rectHeight") return a.edge === b.edge;
  if (a.kind === "slotLength" && b.kind === "slotLength") return a.side === b.side;
  if (a.kind === "point" && b.kind === "point") return a.pointId === b.pointId;
  return true;
}

function edgeHitToEdgeRef(hit: PickableEdgeHit): EdgeRef {
  if (hit.kind === "line") return { kind: "line", lineId: hit.shapeId };
  if (hit.kind === "rectWidth") return { kind: "rectEdge", rectId: hit.shapeId, axis: "width", edge: hit.edge };
  if (hit.kind === "rectHeight") return { kind: "rectEdge", rectId: hit.shapeId, axis: "height", edge: hit.edge };
  if (hit.kind === "point") return { kind: "point", pointId: hit.pointId };
  return { kind: "slotTangent", slotId: hit.shapeId, side: hit.side };
}

function edgeRefReferencesShape(ref: EdgeRef, shapeId: string): boolean {
  if (ref.kind === "line") return ref.lineId === shapeId;
  if (ref.kind === "rectEdge") return ref.rectId === shapeId;
  // "point" referencia um PONTO (ex.: centro de círculo), não uma forma —
  // removeShape só apaga a forma, o ponto sobrevive solto no pool (mesmo
  // espírito de não recolher pontos órfãos que o resto do arquivo já segue),
  // então essa cota nunca é removida automaticamente junto com a forma.
  if (ref.kind === "point") return false;
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
// tangente anda de seu próprio eixo É o raio). O branch "points" devolve só
// os pontos QUE MUDARAM (não o record inteiro) — quem chama passa isso pra
// movePoints, que propaga sozinho pra qualquer linha vizinha com axisLock
// (ver propagateAxisLocks); sem isso, mover um lado inteiro de um
// retângulo (kind "line") desconectava os cantos dos lados adjacentes.
function translateEdgeRef(
  ref: EdgeRef,
  dx: number,
  dy: number,
  shapes: SketchShape[],
  points: Record<string, SketchPoint>
): { points: Record<string, Point> } | { shapes: SketchShape[] } | null {
  if (ref.kind === "line") {
    const line = shapes.find((s) => s.id === ref.lineId);
    if (!line || line.type !== "line") return null;
    const p1 = points[line.p1];
    const p2 = points[line.p2];
    if (!p1 || !p2) return null;
    return {
      points: {
        [p1.id]: { x: p1.x + dx, y: p1.y + dy },
        [p2.id]: { x: p2.x + dx, y: p2.y + dy },
      },
    };
  }

  if (ref.kind === "rectEdge") {
    const rect = shapes.find((s) => s.id === ref.rectId);
    if (!rect || rect.type !== "rect") return null;
    const cornerId = ref.edge === "p1" ? rect.p1 : rect.p2;
    const corner = points[cornerId];
    if (!corner) return null;
    return { points: { [cornerId]: { x: corner.x + dx, y: corner.y + dy } } };
  }

  if (ref.kind === "point") {
    const p = points[ref.pointId];
    if (!p || ref.pointId === ORIGIN_POINT_ID) return null;
    return { points: { [p.id]: { x: p.x + dx, y: p.y + dy } } };
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
// Tangente, Coincidente) — nenhuma delas é um solver: o segundo clique
// aplica a mudança uma vez só e o estado é descartado.
// "joinPoints" (rótulo "Coincidente" na paleta, ao estilo Inventor) aceita
// 3 combinações — firstKind guarda qual foi o 1º clique pra saber como
// despachar o 2º:
// - ponto+ponto → funde os dois (joinPoints)
// - ponto+linha (clique em QUALQUER trecho da linha, fora do meio) → o
//   ponto pula pra cima da linha (makePointCoincidentWithLine)
// - ponto+meio-de-linha (clique perto o bastante do centro de uma aresta,
//   ver findNearbyLineMidpointShape) → a linha INTEIRA translada (as 2
//   pontas juntas) até o meio dela cair exatamente em cima do ponto
//   (makeLineMidpointCoincidentWithPoint) — é o que deixa "pegar o centro
//   do lado de um retângulo e unir com a origem" mover o retângulo até lá.
export type PendingConstraint =
  | { kind: "perpendicular"; firstId: string }
  | { kind: "tangent"; firstId: string; firstShapeKind: "line" | "circle" }
  | { kind: "joinPoints"; firstId: string; firstKind: "point" | "line" | "lineMidpoint" };

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
  // Restrições relacionais persistentes (Perpendicular/Tangente/
  // Coincidente ponto+linha ou meio-de-linha+ponto — ver SketchConstraint
  // em types.ts). Horizontal/Vertical NÃO entram aqui: usam axisLock,
  // embutido na própria LineShape (ver propagateAxisLocks). Reforçadas por
  // reapplyConstraints sempre que qualquer ponto se move (ver movePoints).
  constraints: SketchConstraint[];
  // Ids de ponto com restrição "Fixo" (ao estilo Inventor: ícone de fixar,
  // pino verde no ponto) — um ponto fixo nunca se move, nem por arrasto
  // direto nem por propagação de axisLock/constraints (ver
  // propagateAxisLocks/reapplyConstraints, que recebem esse conjunto pra
  // excluir esses ids da cascata inteira, não só do resultado final).
  // Aplicado AUTOMATICAMENTE nos 2 pontos de qualquer linha criada pela
  // ferramenta Projetar Geometria (ao estilo Inventor: geometria projetada
  // nasce vinculada/fixa à aresta de origem) — ver handleConstraintClick.
  // toggleFixedShape deixa o usuário remover essa restrição manualmente
  // (ou fixar qualquer outra linha/ponto por conta própria), igual o
  // Inventor permite apagar a restrição "Fix" depois de criada.
  fixedPointIds: string[];
  // Próximo número de paramName (d1, d2, d3...) a atribuir — nunca
  // decresce nem reaproveita números de cotas apagadas (ver addDimension/
  // ensureParamName), pra um nome continuar significando a MESMA cota
  // mesmo depois de outras serem criadas/removidas no meio.
  nextParamNumber: number;
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
  dimensionPick1: PickableEdgeHit | null;
  snapIndicator: Point | null;
  selectDrag: SelectDrag | null;
  dragPreview: Record<string, Point>;
  dragRadiusPreview: { shapeId: string; radius: number } | null;
  selectedShapeId: string | null;
  // Arrasto de uma cota (offset — pra longe/perto da geometria medida — e
  // também labelT ao longo da linha, ou angle em volta do círculo pra cota
  // de raio) — independente de selectDrag (que é sobre pontos/formas), mas
  // roteado pelos MESMOS handleRawDown/Move/Up, então não precisa de
  // nenhum mesh 3D próprio pra captar o clique (ver findDimensionHit) —
  // reaproveita o InteractivePlane que já existe. dimensionDrag guarda a
  // geometria de referência (fixa durante o arrasto todo); dimensionDragPreview
  // é recalculado DIRETO da posição do mouse a cada handleRawMove (não
  // acumula delta), só confirmado no store via handleRawUp.
  dimensionDrag: DimensionHit | null;
  dimensionDragPreview: { offset: number; labelT: number } | { offset: number; angle: number } | null;
  // Seleção múltipla de perfis (Ctrl+clique com a ferramenta Selecionar) —
  // só ids de formas fecháveis em perfil (rect/circle/slot, ver
  // profileSourceForShape em replicad/geometry.ts). Lida por
  // findProfileSources no lugar de findProfileSource sempre que não estiver
  // vazia; ModeladorWorkspace limpa depois de cada Extrudar/Face/Revolução
  // bem-sucedido.
  multiProfileSelection: string[];
  pendingConstraint: PendingConstraint | null;
  pendingSlot: PendingSlot | null;
  // Guia de alinhamento ao vivo (ao estilo Inventor), ligado só enquanto a
  // ferramenta de Rasgo/Oblongo está posicionando um ponto — ver
  // findAlignmentGuides/AlignmentGuideLines em SketchOverlay3D.tsx. x/y
  // podem vir de referências DIFERENTES (uma cota alinha em X com um ponto,
  // em Y com outro).
  alignmentGuides: { x: { at: number; ref: Point } | null; y: { at: number; ref: Point } | null } | null;
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
  // cascadeBlocked opcional (ver propagateAxisLocks): só
  // updateDistanceDimension/updateEdgeDistanceDimension passam um de
  // verdade, pra a cascata de axisLock não vazar pra dentro de OUTRA cota
  // já definida; todo resto (arrasto manual, makeLineHorizontal etc.) usa
  // o padrão (sem filtro), preservando a rigidez H/V normal.
  movePoints: (updates: Record<string, Point>, cascadeBlocked?: (pointId: string) => boolean) => void;
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
  // Posição do rótulo ao longo da linha de cota (0..1) — cotas lineares
  // (distance/width/height/edgeDistance) só, ver labelT em types.ts.
  updateDimensionLabelT: (id: string, labelT: number) => void;
  // Ângulo em volta do círculo pra onde a cota de raio aponta — cotas de
  // raio/arco/rasgo só, ver angle em types.ts.
  updateDimensionAngle: (id: string, angle: number) => void;
  // Arma dimensionDrag pra UMA cota já identificada (sem precisar de
  // findDimensionHit, que faz uma busca por proximidade) — usado pelo
  // arrasto iniciado no PRÓPRIO rótulo da cota (ver onDragStart em
  // SketchOverlay3D.tsx), que já sabe exatamente qual dim é. Dali em
  // diante, o arrasto continua pelo MESMO handleRawMove/handleRawUp que o
  // arrasto iniciado na linha (via InteractivePlane) usa.
  armDimensionDrag: (dimension: DimensionAnnotation) => void;
  // Cancela um dimensionDrag em andamento sem aplicar nada — usado se o
  // raycast do arrasto iniciado pelo rótulo não acertar o plano (câmera
  // olhando quase de raspão, caso raríssimo).
  cancelDimensionDrag: () => void;
  // Despacha pra ação de update certa conforme o tipo da cota — usado pela
  // edição INLINE (ver DimensionLabel em SketchOverlay3D.tsx, um <input>
  // que aparece em cima da própria cota, sem popup nativo do navegador).
  // rawText é o texto CRU digitado — um número puro ("25.4") vira valor
  // direto (comportamento de sempre); qualquer coisa citando outra cota
  // (ex.: "d9*2") vira fórmula (ver isFormula/evaluateFormula em
  // formula.ts). Ignora entrada inválida (não é número nem fórmula válida,
  // ou formaria ciclo) sem aplicar nada — mesma postura que a validação
  // antiga já tinha pra número inválido.
  updateDimensionValue: (dimension: DimensionAnnotation, rawText: string) => void;
  // Cota de referência (ao estilo Inventor "driven dimension") — alterna
  // isReference; enquanto true, updateDimensionValue ignora tentativas de
  // editar essa cota diretamente (só relata a medida da geometria).
  toggleReferenceDimension: (id: string) => void;
  // Garante que a cota tenha um paramName (d1, d2...) — atribui um novo se
  // ainda não tiver (cota de projeto salvo antes desse campo existir) e
  // devolve o nome. Chamado ao clicar numa cota pra inserir ela numa
  // fórmula em andamento (ver pickingFormulaFor em SketchOverlay3D.tsx).
  ensureParamName: (id: string) => string;
  // Ctrl+clique com Selecionar chama isso pra cada forma (rect/circle/slot)
  // que virar profile — ver ctrlKey em handleRawDown.
  toggleProfileSelection: (id: string) => void;
  clearProfileSelection: () => void;
  // Ferramentas de restrição "ao estilo Inventor" — PERSISTENTES: uma vez
  // aplicadas, o resultado é reforçado de novo toda vez que a geometria
  // envolvida mudar (arrastar, editar cota, etc.), não só no instante em
  // que a ferramenta foi usada. Horizontal/Vertical fazem isso setando
  // axisLock na própria linha (reforçado por propagateAxisLocks, ver
  // movePoints); Perpendicular/Tangente/Coincidente (ponto+linha ou
  // meio-de-linha+ponto) registram uma entrada em `constraints` via
  // upsertConstraint (reforçada por reapplyConstraints). Não é um solver
  // de verdade — ver o comentário de reapplyConstraints pras limitações.
  makeLineHorizontal: (lineId: string) => void;
  makeLineVertical: (lineId: string) => void;
  makePerpendicular: (lineAId: string, lineBId: string) => void;
  makeTangent: (lineId: string, circleId: string) => void;
  // Insere (ou substitui, se já houver uma pro MESMO dependente — ver
  // constraintDependentId) uma restrição relacional persistente. Chamado
  // pelas próprias ações (makePerpendicular/makeTangent/
  // makePointCoincidentWithLine/makeLineMidpointCoincidentWithPoint) logo
  // depois de aplicar o ajuste inicial via movePoints.
  upsertConstraint: (constraint: NewSketchConstraint) => void;
  // Alterna a restrição "Fixo" (ver fixedPointIds) em TODOS os pontos da
  // forma de uma vez (nunca "meio fixa") — se já estiver tudo fixo,
  // desafixa tudo; senão fixa tudo. Ignora a origem (já é fixa por
  // natureza, nem entra em fixedPointIds).
  toggleFixedShape: (shapeId: string) => void;
  // Funde removeId em keepId em todo mundo que referencia (shapes + cotas);
  // a posição final fica sendo a de keepId. Já é persistente por natureza
  // (os 2 pontos viram literalmente o MESMO ponto — não precisa de uma
  // entrada em `constraints`, não tem como "descoincidir" sozinho).
  joinPoints: (keepId: string, removeId: string) => void;
  // Coincidente ponto+linha (ao estilo Inventor): move pointId pra cima da
  // linha (projeção perpendicular, presa ao próprio segmento — não à reta
  // infinita), via movePoints, então propaga sozinho pra qualquer linha
  // vizinha com axisLock (ver propagateAxisLocks). Registra uma restrição
  // "pointOnLine" persistente (ver upsertConstraint) — se a linha for
  // movida/editada depois, o ponto é reprojetado de novo automaticamente.
  makePointCoincidentWithLine: (pointId: string, lineId: string) => void;
  // Coincidente MEIO-de-linha + ponto (ao estilo Inventor): translada a
  // linha INTEIRA (as 2 pontas juntas, mesmo delta) até o meio dela cair
  // exatamente em cima de targetPointId — ex.: pegar o centro de um lado
  // de retângulo e unir com a origem move o retângulo até lá (via
  // movePoints, propaga sozinho pra qualquer linha vizinha com axisLock —
  // as outras 3 linhas do retângulo acompanham, ver propagateAxisLocks).
  // Recusa se a própria linha já tocar a origem (não dá pra transladar só
  // uma ponta — a origem nunca se move, ver movePoints). Registra uma
  // restrição "lineMidpointOnPoint" persistente (ver upsertConstraint).
  makeLineMidpointCoincidentWithPoint: (lineId: string, targetPointId: string) => void;
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
  // ctrlKey: só importa com tool "select" — Ctrl+clique numa forma
  // perfilável alterna ela em multiProfileSelection em vez de armar arrasto
  // (ver bloco no topo do branch "select").
  handleRawDown: (raw: Point, referenceGeometry?: ReferenceSegment[], ctrlKey?: boolean) => void;
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
  // Despacha pro updateXDimension certo, dado só o kind + id — usado por
  // updateDimensionValue (edição direta ou fórmula) E
  // cascadeFormulaDependents (reavaliação em cadeia), pra não duplicar
  // esse switch nos dois lugares.
  function applyDimensionValueByKind(kind: DimensionAnnotation["kind"], id: string, value: number) {
    if (kind === "radius") get().updateRadiusDimension(id, value);
    else if (kind === "arcRadius") get().updateArcRadiusDimension(id, value);
    else if (kind === "slotRadius") get().updateSlotRadiusDimension(id, value);
    else if (kind === "width") get().updateWidthDimension(id, value);
    else if (kind === "height") get().updateHeightDimension(id, value);
    else if (kind === "edgeDistance") get().updateEdgeDistanceDimension(id, value);
    else get().updateDistanceDimension(id, value);
  }

  // Resolve uma referência (d1, d2...) dentro de uma fórmula pro valor
  // ATUAL da cota com esse paramName — passado como callback pro
  // evaluateFormula puro (formula.ts), que não conhece a store.
  function resolveFormulaParam(name: string): number | null {
    const { dimensions, shapes, points } = get();
    const dim = dimensions.find((d) => d.paramName === name);
    if (!dim) return null;
    return dimensionCurrentValue(dim, shapes, points);
  }

  // A fórmula que se está prestes a salvar em targetDimId formaria um ciclo
  // se, seguindo as referências dela (e as referências DAS referências,
  // recursivamente), voltasse a citar o próprio paramName de targetDimId —
  // recusa salvar nesse caso (ver updateDimensionValue).
  function wouldCreateFormulaCycle(targetDimId: string, referencedParamNames: string[]): boolean {
    const { dimensions } = get();
    const targetParam = dimensions.find((d) => d.id === targetDimId)?.paramName;
    if (!targetParam) return false;
    const visited = new Set<string>();
    const stack = [...referencedParamNames];
    while (stack.length > 0) {
      const name = stack.pop()!;
      if (name === targetParam) return true;
      if (visited.has(name)) continue;
      visited.add(name);
      const dim = dimensions.find((d) => d.paramName === name);
      if (dim?.formula) stack.push(...extractParamNames(dim.formula));
    }
    return false;
  }

  // Ao estilo Inventor: reavalia e reaplica a fórmula de toda cota que
  // referencia o paramName da cota que acabou de mudar de valor (edição
  // direta OU sua própria fórmula reavaliada) — recursivo, pra uma cadeia
  // A→B→C se propagar inteira. `visited` (por id) evita loop infinito numa
  // cadeia circular que porventura tenha escapado de
  // wouldCreateFormulaCycle (ex.: dado salvo por fora do app).
  function cascadeFormulaDependents(sourceId: string, visited: Set<string>) {
    const { dimensions } = get();
    const sourceParam = dimensions.find((d) => d.id === sourceId)?.paramName;
    if (!sourceParam) return;
    const dependents = dimensions.filter(
      (d) => d.formula && !visited.has(d.id) && extractParamNames(d.formula).includes(sourceParam)
    );
    for (const dep of dependents) {
      if (!dep.formula) continue;
      const value = evaluateFormula(dep.formula, resolveFormulaParam);
      if (value === null || value <= 0) continue;
      visited.add(dep.id);
      applyDimensionValueByKind(dep.kind, dep.id, value);
      cascadeFormulaDependents(dep.id, visited);
    }
  }

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

    if (tool === "projectGeometry") {
      const hit = findNearestReferenceSegment(raw, referenceGeometry, EDGE_SELECT_TOLERANCE);
      if (!hit) return;
      // resolvePointAt já encosta em ponto/aresta/referência existente
      // (ver resolveSnapWithEdges) — clicar a mesma aresta 2x, ou uma que
      // encoste noutra já projetada, reaproveita os pontos em vez de
      // duplicar.
      const p1 = get().resolvePointAt({ x: hit.x1, y: hit.y1 }, SNAP_TOLERANCE, referenceGeometry);
      const p2 = get().resolvePointAt({ x: hit.x2, y: hit.y2 }, SNAP_TOLERANCE, referenceGeometry);
      if (p1 === p2) return;
      get().addShape({ id: createId(), type: "line", p1, p2, isProjected: true });
      // Ao estilo Inventor: geometria projetada nasce com uma restrição
      // "Fixo" nas 2 pontas (vinculada à aresta 3D de origem, não solta
      // pra arrastar por engano) — ver fixedPointIds. toggleFixedShape
      // deixa o usuário apagar essa restrição depois, se quiser editar a
      // linha livremente (mesmo "excluir restrição" que o Inventor tem).
      set((s) => ({
        fixedPointIds: Array.from(new Set([...s.fixedPointIds, p1, p2].filter((id) => id !== ORIGIN_POINT_ID))),
      }));
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
      // Coincidente (ao estilo Inventor): testa ponto real primeiro (mesma
      // prioridade do resto do arquivo); senão, testa o MEIO de uma aresta
      // (clique perto o bastante do centro dela, ver
      // findNearbyLineMidpointShape — mesma prioridade que
      // resolveSnapWithEdges já dá ao meio sobre "qualquer trecho da
      // aresta"); só então cai pro clique genérico em QUALQUER outro
      // trecho da linha.
      const nearby = findNearbyPoint(raw, Object.values(points), SELECT_POINT_TOLERANCE);
      const midpointHit = !nearby ? findNearbyLineMidpointShape(raw, shapes, points, EDGE_SELECT_TOLERANCE) : null;
      const edgeHit = !nearby && !midpointHit ? findEdgeHit(raw, shapes, points, EDGE_SELECT_TOLERANCE) : null;
      const lineHit = edgeHit?.kind === "line" ? edgeHit : null;
      if (!nearby && !midpointHit && !lineHit) return;

      const pickedId = nearby ? nearby.id : midpointHit ? midpointHit.shapeId : lineHit!.shapeId;
      const pickedKind: "point" | "line" | "lineMidpoint" = nearby ? "point" : midpointHit ? "lineMidpoint" : "line";

      if (!pendingConstraint || pendingConstraint.kind !== "joinPoints") {
        set({ pendingConstraint: { kind: "joinPoints", firstId: pickedId, firstKind: pickedKind } });
        return;
      }
      if (pendingConstraint.firstId === pickedId) return; // mesmo elemento clicado 2x, ignora

      const firstKind = pendingConstraint.firstKind;
      if (firstKind === "point" && pickedKind === "point") {
        get().joinPoints(pendingConstraint.firstId, pickedId);
      } else if (firstKind === "point" && pickedKind === "line") {
        get().makePointCoincidentWithLine(pendingConstraint.firstId, pickedId);
      } else if (firstKind === "line" && pickedKind === "point") {
        get().makePointCoincidentWithLine(pickedId, pendingConstraint.firstId);
      } else if (firstKind === "point" && pickedKind === "lineMidpoint") {
        get().makeLineMidpointCoincidentWithPoint(pickedId, pendingConstraint.firstId);
      } else if (firstKind === "lineMidpoint" && pickedKind === "point") {
        get().makeLineMidpointCoincidentWithPoint(pendingConstraint.firstId, pickedId);
      } else {
        // Combinação sem ação definida (linha+linha, meio+linha, etc.) —
        // recomeça a espera com o elemento novo clicado, em vez de ficar
        // travada esperando algo que talvez nunca venha.
        set({ pendingConstraint: { kind: "joinPoints", firstId: pickedId, firstKind: pickedKind } });
        return;
      }
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

  // Guia de alinhamento ao estilo Inventor, usado ao posicionar os pontos
  // do Rasgo/Oblongo: compara o clique com todo ponto JÁ EXISTENTE no
  // sketch + o ponto MÉDIO entre cada par deles (é isso que permite
  // "centralizar" — colocar o novo ponto exatamente no meio de dois já
  // existentes, não só alinhar com um só) — acha a melhor correspondência
  // em X e em Y (podem vir de referências DIFERENTES, uma pra cada eixo)
  // dentro da tolerância, e devolve tanto o ponto "grudado" quanto a
  // referência de cada eixo pra desenhar a linha guia tracejada (ver
  // alignmentGuides no estado / AlignmentGuideLines em SketchOverlay3D.tsx).
  // extraCandidates cobre âncoras sintéticas que não são pontos de verdade
  // do pool (ex.: o ponto médio do modo "ponto central" do rasgo, guardado
  // só como coordenada, nunca virou PointShape).
  const ALIGN_TOLERANCE_MM = 6;
  const ALIGN_MAX_POINTS_FOR_MIDPOINTS = 60;

  function findAlignmentGuides(
    raw: Point,
    points: Record<string, SketchPoint>,
    extraCandidates: Point[] = []
  ): { point: Point; guideX: { at: number; ref: Point } | null; guideY: { at: number; ref: Point } | null } {
    const basePoints: Point[] = Object.values(points).map((p) => ({ x: p.x, y: p.y }));
    basePoints.push(...extraCandidates);

    const candidates: Point[] = [...basePoints];
    if (basePoints.length <= ALIGN_MAX_POINTS_FOR_MIDPOINTS) {
      for (let i = 0; i < basePoints.length; i++) {
        for (let j = i + 1; j < basePoints.length; j++) {
          candidates.push({ x: (basePoints[i].x + basePoints[j].x) / 2, y: (basePoints[i].y + basePoints[j].y) / 2 });
        }
      }
    }

    let guideX: { at: number; ref: Point } | null = null;
    let guideY: { at: number; ref: Point } | null = null;
    let bestXDist = ALIGN_TOLERANCE_MM;
    let bestYDist = ALIGN_TOLERANCE_MM;
    for (const c of candidates) {
      const dx = Math.abs(raw.x - c.x);
      if (dx < bestXDist) {
        bestXDist = dx;
        guideX = { at: c.x, ref: c };
      }
      const dy = Math.abs(raw.y - c.y);
      if (dy < bestYDist) {
        bestYDist = dy;
        guideY = { at: c.y, ref: c };
      }
    }

    return {
      point: { x: guideX ? guideX.at : raw.x, y: guideY ? guideY.at : raw.y },
      guideX,
      guideY,
    };
  }

  // Guia de alinhamento H/V do próprio eixo do Rasgo: se o eixo de `anchor`
  // até `raw` cair perto o bastante de horizontal ou vertical, gruda
  // exatamente nisso — usado como ÚLTIMO recurso, só quando
  // findAlignmentGuides acima não achou nenhum alinhamento com OUTRA
  // geometria do sketch (ver resolveSlotPoint). Não é uma restrição
  // permanente tipo makeLineHorizontal/Vertical — só facilita acertar
  // 0°/90° na hora de clicar, igual toda ferramenta de desenho já faz por
  // instinto.
  const AXIS_SNAP_TOLERANCE_DEG = 6;

  function applyAxisSnap(anchor: Point, raw: Point): Point {
    const dx = raw.x - anchor.x;
    const dy = raw.y - anchor.y;
    if (Math.hypot(dx, dy) < 1e-6) return raw;
    const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
    const nearestMultiple = Math.round(angleDeg / 90) * 90;
    if (Math.abs(angleDeg - nearestMultiple) > AXIS_SNAP_TOLERANCE_DEG) return raw;
    const isHorizontal = ((nearestMultiple % 180) + 180) % 180 === 0;
    return isHorizontal ? { x: raw.x, y: anchor.y } : { x: anchor.x, y: raw.y };
  }

  // Resolve o ponto de um clique/preview do Rasgo: tenta alinhar com OUTRA
  // geometria já existente no sketch primeiro (findAlignmentGuides — cobre
  // tanto "alinhar" quanto "centralizar" entre dois pontos); só cai pro
  // snap H/V relativo à própria âncora (applyAxisSnap) se NENHUM eixo achou
  // alinhamento externo. Usado igual em handleSlotDown (clique de verdade)
  // e handleRawMove (preview ao vivo), pra a linha pontilhada mostrar
  // exatamente o que vai acontecer ao clicar.
  function resolveSlotPoint(
    raw: Point,
    anchor: Point | null,
    points: Record<string, SketchPoint>,
    extraCandidates: Point[]
  ): { point: Point; guideX: { at: number; ref: Point } | null; guideY: { at: number; ref: Point } | null } {
    const alignment = findAlignmentGuides(raw, points, extraCandidates);
    if (alignment.guideX || alignment.guideY) return alignment;
    return { point: anchor ? applyAxisSnap(anchor, raw) : raw, guideX: null, guideY: null };
  }

  function handleSlotDown(tool: SketchTool, raw: Point, referenceGeometry: ReferenceSegment[]) {
    const { pendingSlot, points } = get();

    if (!pendingSlot) {
      if (tool === "slotCenterToCenter") {
        const { point: snapped } = resolveSlotPoint(raw, null, points, []);
        const center1Id = get().resolvePointAt(snapped, SNAP_TOLERANCE, referenceGeometry);
        set({ pendingSlot: { kind: "centerToCenter", center1Id }, alignmentGuides: null });
      } else {
        // "centerPoint": o ponto médio não é referenciado pelo SlotShape
        // final (só center1/center2 são), então não vira ponto persistente
        // — só a coordenada (com snap) fica guardada, usada na hora de
        // espelhar a extremidade oposta no 2º clique.
        const { point: snapped } = resolveSlotPoint(raw, null, points, []);
        const midpoint = previewSnap(snapped, referenceGeometry);
        set({ pendingSlot: { kind: "centerPoint", midpoint }, alignmentGuides: null });
      }
      return;
    }

    if (pendingSlot.kind === "centerToCenter") {
      const center1 = points[pendingSlot.center1Id];
      const { point: snapped } = resolveSlotPoint(raw, center1 ?? null, points, []);
      const center2Id = get().resolvePointAt(snapped, SNAP_TOLERANCE, referenceGeometry);
      if (center2Id === pendingSlot.center1Id) return; // eixo de comprimento zero, ignora
      set({ pendingSlot: { kind: "ready", center1Id: pendingSlot.center1Id, center2Id }, alignmentGuides: null });
      return;
    }

    if (pendingSlot.kind === "centerPoint") {
      const { midpoint } = pendingSlot;
      const { point: snapped } = resolveSlotPoint(raw, midpoint, points, [midpoint]);
      const endId = get().resolvePointAt(snapped, SNAP_TOLERANCE, referenceGeometry);
      const end = get().points[endId];
      if (!end) return;
      const mirrorPos = { x: 2 * midpoint.x - end.x, y: 2 * midpoint.y - end.y };
      const mirrorId = get().resolvePointAt(mirrorPos, SNAP_TOLERANCE, referenceGeometry);
      if (mirrorId === endId) return; // extremidade clicada em cima do ponto médio, ignora
      set({ pendingSlot: { kind: "ready", center1Id: endId, center2Id: mirrorId }, alignmentGuides: null });
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
    points: { [ORIGIN_POINT_ID]: ORIGIN_POINT },
    shapes: [],
    dimensions: [],
    constraints: [],
    fixedPointIds: [],
    nextParamNumber: 1,
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
    multiProfileSelection: [],
    pendingConstraint: null,
    pendingSlot: null,
    alignmentGuides: null,
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
        alignmentGuides: null,
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

    // Sempre expande as atualizações recebidas via propagateAxisLocks antes
    // de aplicar — ÚNICO ponto de aplicação de verdade (o preview ao vivo
    // em handleRawMove já expande pra mostrar a propagação antes de soltar,
    // mas expandir de novo aqui é barato/idempotente e garante que QUALQUER
    // chamador — inclusive updateDistanceDimension/updateEdgeDistanceDimension,
    // que não passam por handleRawMove — também respeite a trava de eixo).
    // SEM fixedPointIds de propósito (ver comentário de propagateAxisLocks)
    // — movePoints também é o caminho de edição de cota/ferramentas de
    // restrição, que devem continuar funcionando mesmo num ponto "Fixo";
    // só o arrasto manual (computeDragPreview, mais abaixo) respeita essa
    // restrição. cascadeBlocked só é passado de verdade por
    // updateDistanceDimension/updateEdgeDistanceDimension (ver assinatura
    // acima) — todo resto chama sem esse argumento, preservando a rigidez
    // H/V normal de qualquer retângulo cotado.
    movePoints: (updates, cascadeBlocked) =>
      set((s) => {
        const expanded = propagateAxisLocks(updates, s.shapes, s.points, EMPTY_FIXED_SET, cascadeBlocked);
        let nextPoints = { ...s.points };
        for (const [id, pos] of Object.entries(expanded)) {
          if (!nextPoints[id] || id === ORIGIN_POINT_ID) continue; // origem é fixa, nunca arrasta
          nextPoints[id] = { id, x: pos.x, y: pos.y };
        }
        // Reforça toda restrição relacional persistente (Perpendicular/
        // Tangente/Coincidente, ver reapplyConstraints) contra o resultado
        // acima — é isso que faz essas ferramentas continuarem "de pé"
        // depois de editar a geometria de novo, em vez de só valerem no
        // instante em que foram usadas.
        nextPoints = reapplyConstraints(s.constraints, s.shapes, nextPoints, EMPTY_FIXED_SET, cascadeBlocked);
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
      set((s) => {
        const survivors = s.dimensions.filter((d) => {
          if (d.kind === "radius") return d.circleId !== id;
          if (d.kind === "arcRadius") return d.arcId !== id;
          if (d.kind === "slotRadius") return d.slotId !== id;
          if (d.kind === "width" || d.kind === "height") return d.rectId !== id;
          if (d.kind === "edgeDistance") {
            return !edgeRefReferencesShape(d.a, id) && !edgeRefReferencesShape(d.b, id);
          }
          return true;
        });
        // Restrição relacional que citava a forma removida (de QUALQUER
        // lado — lineAId/lineBId/lineId/circleId) vira lixo sozinha, senão
        // reapplyConstraints ficaria tentando reforçar contra uma forma que
        // não existe mais.
        const remainingConstraints = s.constraints.filter((c) => {
          if (c.kind === "perpendicular") return c.lineAId !== id && c.lineBId !== id;
          if (c.kind === "tangent") return c.lineId !== id && c.circleId !== id;
          if (c.kind === "pointOnLine") return c.lineId !== id;
          return c.lineId !== id; // lineMidpointOnPoint
        });
        return {
          shapes: s.shapes.filter((shape) => shape.id !== id),
          dimensions: survivors,
          constraints: remainingConstraints,
          multiProfileSelection: s.multiProfileSelection.filter((existing) => existing !== id),
        };
      }),

    addDimension: (dimension) =>
      set((s) => ({
        dimensions: [...s.dimensions, dimension.paramName ? dimension : { ...dimension, paramName: `d${s.nextParamNumber}` }],
        nextParamNumber: dimension.paramName ? s.nextParamNumber : s.nextParamNumber + 1,
      })),

    // Cota removida cujo paramName alguma fórmula referenciava simplesmente
    // vira uma referência não resolvível (evaluateFormula devolve null pra
    // ela) — a(s) cota(s) que dependiam ficam paradas no último valor
    // válido, sem quebrar nada; não há necessidade de sair reescrevendo
    // fórmulas de outras cotas ao apagar essa.
    removeDimension: (id) =>
      set((s) => ({
        dimensions: s.dimensions.filter((d) => d.id !== id),
      })),

    // Move p2 em relação a p1 ao longo da direção atual entre eles — qualquer
    // shape que referencie esses ids (inclusive de outra aresta) acompanha na
    // hora, porque todo mundo lê do mesmo pool.
    // Por padrão move só p2 (p1 fica parado) — via movePoints, não um
    // set() direto, pra propagar sozinho pra qualquer linha com axisLock
    // que compartilhe esse ponto com um lado vizinho (ver
    // propagateAxisLocks): senão editar a cota de um lado do retângulo
    // desconectava o canto com o lado ao lado, já que só aquele ponto se
    // movia. Se p2 já for restritivo (ver isPointRestrictive — outra cota
    // não-referência já definida, OU a restrição "Fixo" de geometria
    // projetada), esse ponto não deve se mexer — move p1 no sentido
    // oposto em vez dele; se os dois forem restritivos, ignora (não dá
    // pra satisfazer o valor novo sem violar uma cota/restrição já
    // definida).
    updateDistanceDimension: (id, newLength) => {
      const { dimensions, points, shapes, fixedPointIds } = get();
      const dim = dimensions.find((d) => d.id === id);
      if (!dim || dim.kind !== "distance" || newLength <= 0) return;

      const p1 = points[dim.p1];
      const p2 = points[dim.p2];
      if (!p1 || !p2) return;

      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const currentLength = Math.hypot(dx, dy);
      if (currentLength < 1e-6) return;

      const ux = dx / currentLength;
      const uy = dy / currentLength;

      const fixed = new Set(fixedPointIds);
      // Também usado como cascadeBlocked de movePoints abaixo: além de
      // decidir qual lado é o SEED, impede que a propagação de axisLock
      // vaze pra dentro de um ponto que já pertence a OUTRA cota (nunca
      // filtra o próprio seed, ver propagateAxisLocks).
      const restrictive = (pid: string) => isPointRestrictive(pid, dimensions, shapes, fixed, dim.id);
      if (!restrictive(dim.p2)) {
        const newP2 = { x: p1.x + ux * newLength, y: p1.y + uy * newLength };
        const updates: Record<string, Point> = { [p2.id]: newP2 };
        // Cota de espaçamento do Padrão Retangular (ver
        // patternShapeRectangular): reposiciona a GRADE inteira junto,
        // cada seguidor escalado pelo próprio índice ao longo da direção
        // do padrão — mesmo delta que p2 recebeu, só multiplicado.
        if (dim.patternFollowers) {
          const deltaX = newP2.x - p2.x;
          const deltaY = newP2.y - p2.y;
          for (const follower of dim.patternFollowers) {
            const fp = points[follower.pointId];
            if (!fp) continue;
            updates[follower.pointId] = {
              x: fp.x + deltaX * follower.multiplier,
              y: fp.y + deltaY * follower.multiplier,
            };
          }
        }
        get().movePoints(updates, restrictive);
      } else if (!restrictive(dim.p1)) {
        get().movePoints({ [p1.id]: { x: p2.x - ux * newLength, y: p2.y - uy * newLength } }, restrictive);
      }
    },

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

    // Via movePoints (quando o patch é de pontos) — não um set() direto —
    // pra propagar sozinho pra qualquer linha vizinha com axisLock (ver
    // propagateAxisLocks): senão cotar a distância entre 2 lados de um
    // retângulo (ex.: a "largura") e editar o valor desconectava os cantos
    // do lado que se moveu com os lados adjacentes.
    // Por padrão translada só `b` (a 2ª referência escolhida) — mas se os
    // pontos de `b` já pertencem a OUTRA cota não-referência já definida
    // (ex.: a largura do retângulo, ver isPointDrivenByDimension), essa
    // geometria é restritiva e não deve se mexer por causa de uma cota
    // DIFERENTE — translada `a` no sentido oposto em vez disso (ex.:
    // "distância do centro do círculo até uma linha do retângulo": se a
    // linha já tem a própria largura cotada, quem anda é o círculo, não a
    // linha). Se os dois lados forem restritivos, ignora — não dá pra
    // satisfazer o valor novo sem violar uma cota já definida.
    updateEdgeDistanceDimension: (id, newValue) => {
      const { dimensions, shapes, points, fixedPointIds } = get();
      const dim = dimensions.find((d) => d.id === id);
      if (!dim || dim.kind !== "edgeDistance" || newValue <= 0) return;

      const render = resolveDimension(dim, shapes, points);
      if (!render || render.kind !== "distance") return;

      const dx = render.x2 - render.x1;
      const dy = render.y2 - render.y1;
      const curDist = Math.hypot(dx, dy);
      if (curDist < 1e-6) return;

      const delta = newValue - curDist;
      const ux = dx / curDist;
      const uy = dy / curDist;

      // "Restritivo" inclui a restrição "Fixo" (ver isPointRestrictive) —
      // sem isso, editar a distância até uma linha PROJETADA (que nasce
      // fixa, não com uma cota própria) movia a linha em vez do outro
      // lado, já que isPointDrivenByDimension sozinho não enxerga "Fixo".
      // Também usado como cascadeBlocked de movePoints abaixo, pra
      // propagação de axisLock não vazar pra dentro de outra cota já
      // definida (nunca filtra o próprio seed, ver propagateAxisLocks).
      const fixed = new Set(fixedPointIds);
      const restrictive = (pid: string) => isPointRestrictive(pid, dimensions, shapes, fixed, dim.id);
      const bLocked = edgeRefPointIds(dim.b, shapes).some(restrictive);
      const target = !bLocked
        ? { ref: dim.b, dx: delta * ux, dy: delta * uy }
        : { ref: dim.a, dx: -delta * ux, dy: -delta * uy };
      if (bLocked && edgeRefPointIds(dim.a, shapes).some(restrictive)) {
        return; // os dois lados são restritivos, nenhum pode se mover
      }

      const patch = translateEdgeRef(target.ref, target.dx, target.dy, shapes, points);
      if (!patch) return;
      if ("points" in patch) get().movePoints(patch.points, restrictive);
      else set({ shapes: patch.shapes });
    },

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

    updateDimensionLabelT: (id, labelT) =>
      set((s) => ({
        dimensions: s.dimensions.map((d) => (d.id === id ? { ...d, labelT: Math.max(0, Math.min(1, labelT)) } : d)),
      })),

    updateDimensionAngle: (id, angle) =>
      set((s) => ({
        dimensions: s.dimensions.map((d) => (d.id === id ? { ...d, angle } : d)),
      })),

    armDimensionDrag: (dimension) => {
      const { shapes, points } = get();
      const render = resolveDimension(dimension, shapes, points);
      if (!render) return;
      if (render.kind === "radius") {
        set({
          dimensionDrag: { dimensionId: dimension.id, kind: "radius", center: { x: render.cx, y: render.cy }, r: render.r },
        });
      } else {
        set({
          dimensionDrag: {
            dimensionId: dimension.id,
            kind: "distance",
            a: { x: render.x1, y: render.y1 },
            b: { x: render.x2, y: render.y2 },
          },
        });
      }
    },

    cancelDimensionDrag: () => set({ dimensionDrag: null, dimensionDragPreview: null, downRaw: null }),

    updateDimensionValue: (dimension, rawText) => {
      // Cota de referência só relata a medida (derivada da geometria) —
      // nunca aceita um valor digitado.
      if (dimension.isReference) return;

      const plain = Number(rawText.trim().replace(",", "."));
      const paramNames = extractParamNames(rawText);

      if (Number.isFinite(plain) && plain > 0 && paramNames.length === 0) {
        // Número puro — se essa cota tinha fórmula, digitar um valor
        // literal apaga ela (mesmo comportamento do Inventor ao
        // sobrescrever uma dimensão com fórmula por um número).
        if (dimension.formula) {
          set((s) => ({
            dimensions: s.dimensions.map((d) => (d.id === dimension.id ? { ...d, formula: undefined } : d)),
          }));
        }
        applyDimensionValueByKind(dimension.kind, dimension.id, plain);
        cascadeFormulaDependents(dimension.id, new Set([dimension.id]));
        return;
      }

      if (paramNames.length === 0) return; // nem número válido nem fórmula com referência — ignora

      if (wouldCreateFormulaCycle(dimension.id, paramNames)) return;
      const value = evaluateFormula(rawText, resolveFormulaParam);
      if (value === null || value <= 0) return;

      set((s) => ({
        dimensions: s.dimensions.map((d) => (d.id === dimension.id ? { ...d, formula: rawText.trim() } : d)),
      }));
      applyDimensionValueByKind(dimension.kind, dimension.id, value);
      cascadeFormulaDependents(dimension.id, new Set([dimension.id]));
    },

    toggleReferenceDimension: (id) =>
      set((s) => ({
        dimensions: s.dimensions.map((d) => (d.id === id ? { ...d, isReference: !d.isReference } : d)),
      })),

    ensureParamName: (id) => {
      const existing = get().dimensions.find((d) => d.id === id)?.paramName;
      if (existing) return existing;
      const name = `d${get().nextParamNumber}`;
      set((s) => ({
        dimensions: s.dimensions.map((d) => (d.id === id ? { ...d, paramName: name } : d)),
        nextParamNumber: s.nextParamNumber + 1,
      }));
      return name;
    },

    // Ctrl+clicar numa LINHA que faz parte de um contorno fechado (ex.: um
    // dos 4 lados de um retângulo desenhado como 4 linhas, ver
    // handleRawUp) alterna o CONTORNO INTEIRO junto — senão só aquele lado
    // entraria na seleção, e findProfileSources (replicad/geometry.ts)
    // ficaria sem os outros 3 pra fechar o perfil.
    toggleProfileSelection: (id) =>
      set((s) => {
        const shape = s.shapes.find((sh) => sh.id === id);
        const idsToToggle = shape?.type === "line" ? (findLoopShapeIds(s.shapes, id) ?? [id]) : [id];
        const anySelected = idsToToggle.some((i) => s.multiProfileSelection.includes(i));
        return {
          multiProfileSelection: anySelected
            ? s.multiProfileSelection.filter((existing) => !idsToToggle.includes(existing))
            : [...s.multiProfileSelection, ...idsToToggle.filter((i) => !s.multiProfileSelection.includes(i))],
        };
      }),

    clearProfileSelection: () => set({ multiProfileSelection: [] }),

    // Via movePoints (não um set() direto) nas duas — propaga sozinho pra
    // qualquer linha vizinha com axisLock (ver propagateAxisLocks), senão
    // alinhar um lado desconectava o canto compartilhado com o lado ao lado.
    // Também SETA axisLock na própria linha (persistente, ao estilo
    // Inventor) — sem isso, a linha alinhava uma vez só e nunca mais
    // reforçava se um dos dois pontos fosse movido de novo depois.
    makeLineHorizontal: (lineId) => {
      const { shapes, points } = get();
      const line = shapes.find((sh) => sh.id === lineId);
      if (!line || line.type !== "line") return;
      const p1 = points[line.p1];
      const p2 = points[line.p2];
      if (!p1 || !p2) return;
      get().movePoints({ [p2.id]: { x: p2.x, y: p1.y } });
      set((s) => ({
        shapes: s.shapes.map((sh) => (sh.id === lineId && sh.type === "line" ? { ...sh, axisLock: "horizontal" } : sh)),
      }));
    },

    makeLineVertical: (lineId) => {
      const { shapes, points } = get();
      const line = shapes.find((sh) => sh.id === lineId);
      if (!line || line.type !== "line") return;
      const p1 = points[line.p1];
      const p2 = points[line.p2];
      if (!p1 || !p2) return;
      get().movePoints({ [p2.id]: { x: p1.x, y: p2.y } });
      set((s) => ({
        shapes: s.shapes.map((sh) => (sh.id === lineId && sh.type === "line" ? { ...sh, axisLock: "vertical" } : sh)),
      }));
    },

    // Gira a linha B (em torno do ponto que ela compartilha com A, se
    // houver — senão em torno do próprio p1 de B) até ficar a 90° de A,
    // escolhendo o lado (+90 ou -90) mais próximo do ângulo atual de B pra
    // não "virar" a linha do avesso sem necessidade. Registra uma restrição
    // persistente (ver upsertConstraint) — se A girar depois, B é
    // reorientado de novo automaticamente (ver reapplyConstraints).
    makePerpendicular: (lineAId, lineBId) => {
      const { shapes, points } = get();
      const lineA = shapes.find((sh) => sh.id === lineAId);
      const lineB = shapes.find((sh) => sh.id === lineBId);
      if (!lineA || lineA.type !== "line" || !lineB || lineB.type !== "line") return;

      const target = computePerpendicularTarget(lineA, lineB, points);
      if (target) get().movePoints({ [target.movingId]: target.pos });
      get().upsertConstraint({ kind: "perpendicular", lineAId, lineBId });
    },

    // Translada a linha inteira perpendicularmente a ela mesma até a
    // distância até o centro do círculo virar exatamente o raio — mantém o
    // lado em que já estava (não pula pro outro lado do círculo). Registra
    // uma restrição persistente (ver upsertConstraint) — se o círculo mudar
    // de posição/raio depois, a linha acompanha (ver reapplyConstraints).
    makeTangent: (lineId, circleId) => {
      const { shapes, points } = get();
      const line = shapes.find((sh) => sh.id === lineId);
      const circle = shapes.find((sh) => sh.id === circleId);
      if (!line || line.type !== "line" || !circle || circle.type !== "circle") return;

      const target = computeTangentTarget(line, circle, points);
      if (target) {
        // As 2 pontas translatam juntas (mesmo delta) — isso já preserva o
        // ângulo da PRÓPRIA linha sozinho; movePoints ainda propaga pra
        // qualquer linha VIZINHA travada que compartilhe uma dessas pontas.
        get().movePoints({ [line.p1]: target.p1, [line.p2]: target.p2 });
      }
      get().upsertConstraint({ kind: "tangent", lineId, circleId });
    },

    // Insere/substitui (ver constraintDependentId) uma restrição
    // persistente na lista.
    upsertConstraint: (constraint) =>
      set((s) => {
        const dependentId = constraintDependentId(constraint);
        const filtered = s.constraints.filter(
          (c) => !(c.kind === constraint.kind && constraintDependentId(c) === dependentId)
        );
        return { constraints: [...filtered, { id: createId(), ...constraint }] };
      }),

    toggleFixedShape: (shapeId) =>
      set((s) => {
        const shape = s.shapes.find((sh) => sh.id === shapeId);
        if (!shape) return s;
        const ids = pointIdsOfShape(shape).filter((id) => id !== ORIGIN_POINT_ID);
        if (ids.length === 0) return s;
        const allFixed = ids.every((id) => s.fixedPointIds.includes(id));
        const next = new Set(s.fixedPointIds);
        for (const id of ids) {
          if (allFixed) next.delete(id);
          else next.add(id);
        }
        return { fixedPointIds: Array.from(next) };
      }),

    joinPoints: (keepId, removeId) =>
      set((s) => {
        if (keepId === removeId) return s;
        if (!s.points[keepId] || !s.points[removeId]) return s;
        // Origem nunca é o lado removido — ela precisa continuar existindo
        // no pool pra qualquer outro sketch reaberto/futuro clique de snap.
        if (removeId === ORIGIN_POINT_ID) return s;

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

    makePointCoincidentWithLine: (pointId, lineId) => {
      if (pointId === ORIGIN_POINT_ID) return; // origem é fixa
      const { shapes, points } = get();
      const line = shapes.find((sh) => sh.id === lineId);
      if (!line || line.type !== "line") return;
      if (pointId === line.p1 || pointId === line.p2) return; // já é ponta dessa linha

      const target = computePointOnLineTarget(pointId, line, points);
      if (target) get().movePoints({ [pointId]: target });
      get().upsertConstraint({ kind: "pointOnLine", pointId, lineId });
    },

    makeLineMidpointCoincidentWithPoint: (lineId, targetPointId) => {
      const { shapes, points } = get();
      const line = shapes.find((sh) => sh.id === lineId);
      const target = points[targetPointId];
      if (!line || line.type !== "line" || !target) return;
      // Não dá pra transladar uma linha que já tem uma ponta na origem —
      // a origem nunca se move (ver movePoints), então só a OUTRA ponta
      // andaria, distorcendo a linha em vez de deslocá-la inteira. Recusa a
      // restrição inteira nesse caso (nem registra), não só o movimento.
      if (line.p1 === ORIGIN_POINT_ID || line.p2 === ORIGIN_POINT_ID) return;

      const moveTarget = computeLineMidpointOnPointTarget(line, target, points);
      if (moveTarget) get().movePoints({ [line.p1]: moveTarget.p1, [line.p2]: moveTarget.p2 });
      get().upsertConstraint({ kind: "lineMidpointOnPoint", lineId, pointId: targetPointId });
    },

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
          { id: createId(), type: "line", p1: rect.p1, p2: topRightId, axisLock: "horizontal" },
          { id: createId(), type: "line", p1: topRightId, p2: rect.p2, axisLock: "vertical" },
          { id: createId(), type: "line", p1: rect.p2, p2: bottomLeftId, axisLock: "horizontal" },
          { id: createId(), type: "line", p1: bottomLeftId, p2: rect.p1, axisLock: "vertical" },
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
        constraints: [],
        fixedPointIds: [],
        nextParamNumber: 1,
        // Ponto de origem sempre presente num sketch novo/limpo — não {}
        // (ver ORIGIN_POINT em types.ts).
        points: { [ORIGIN_POINT_ID]: ORIGIN_POINT },
        selectedShapeId: null,
        pendingConstraint: null,
        pendingSlot: null,
        dimensionPick1: null,
        selectDrag: null,
        dragPreview: {},
        dragRadiusPreview: null,
        dimensionDrag: null,
        dimensionDragPreview: null,
        multiProfileSelection: [],
        alignmentGuides: null,
      }),

    handleRawDown: (raw, referenceGeometry = [], ctrlKey = false) => {
      const { tool, shapes, points, dimensions, fixedPointIds } = get();

      if (CLICK_TOOLS.has(tool)) {
        handleConstraintClick(tool, raw, referenceGeometry);
        return;
      }

      if (SLOT_TOOLS.has(tool)) {
        handleSlotDown(tool, raw, referenceGeometry);
        return;
      }

      if (tool === "select") {
        // Ctrl+clique: alterna a forma clicada (se for perfilável) na
        // seleção múltipla, sem arrastar nada — checado ANTES de tudo mais
        // nesse branch, senão o Ctrl seria ignorado e cairia num arrasto
        // normal de ponto/forma.
        if (ctrlKey) {
          const hit = findEdgeHit(raw, shapes, points, EDGE_SELECT_TOLERANCE);
          const PROFILE_HIT_KINDS = new Set(["circleRadius", "rectWidth", "rectHeight", "slotLength", "slotRadius"]);
          if (hit?.kind === "line") {
            // Só perfilável se fechar um contorno de verdade (ex.: um dos 4
            // lados de um retângulo desenhado como 4 linhas, ver
            // handleRawUp) — uma linha solta/aberta não vira perfil, então
            // nem entra na seleção (senão ficaria "marcada" sem contribuir
            // nada pro Extrudar, confuso).
            if (findLoopShapeIds(shapes, hit.shapeId)) {
              get().toggleProfileSelection(hit.shapeId);
            }
          } else if (hit && PROFILE_HIT_KINDS.has(hit.kind)) {
            get().toggleProfileSelection(hit.shapeId);
          }
          set({ downRaw: raw });
          return;
        }

        // Cota clicada perto da própria linha (já deslocada) arma o
        // arrasto — checado ANTES do resto (ponto/retângulo/linha/círculo),
        // já que a linha de cota normalmente fica por cima ou bem perto da
        // geometria que ela mede.
        const dimHit = findDimensionHit(raw, dimensions, shapes, points, EDGE_SELECT_TOLERANCE);
        if (dimHit) {
          set({ dimensionDrag: dimHit, downRaw: raw });
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
          // Raio já cotado (cota não-referência) trava o arrasto — só dá
          // pra mudar editando a própria cota (ver isCircleRadiusDrivenByDimension).
          const radiusLocked = isCircleRadiusDrivenByDimension(bestCircleEdge.shape.id, dimensions);
          set({
            selectedShapeId: bestCircleEdge.shape.id,
            selectDrag: radiusLocked
              ? null
              : { mode: "circleRadius", shapeId: bestCircleEdge.shape.id, center: bestCircleEdge.center },
            downRaw: raw,
          });
          return;
        }

        const nearbyPoint = findNearbyPoint(raw, Object.values(points), SELECT_POINT_TOLERANCE);
        if (nearbyPoint && nearbyPoint.id === ORIGIN_POINT_ID) {
          // Origem é fixa — nem arma arrasto (movePoints já ignora o id
          // dela, mas sem esse early-return o preview visual "arrastaria"
          // ela até soltar e ela pular de volta pro (0,0), o que pareceria
          // um bug em vez de uma restrição deliberada).
          set({ downRaw: raw, selectedShapeId: null });
          return;
        }
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
          // Ponto medido por uma cota não-referência (distance/arcRadius/
          // edgeDistance) trava o arrasto (ver isPointDrivenByDimension) —
          // ponto com restrição "Fixo" (ver fixedPointIds, ex.: geometria
          // projetada) também.
          const pointLocked =
            isPointDrivenByDimension(nearbyPoint.id, dimensions, shapes) || fixedPointIds.includes(nearbyPoint.id);
          set({
            selectDrag: pointLocked ? null : { mode: "point", pointId: nearbyPoint.id },
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
            // Largura/altura já cotada (cota não-referência) trava o
            // arrasto dessa aresta (ver isRectAxisDrivenByDimension) — o
            // canto arrastado tendo restrição "Fixo" (ver fixedPointIds)
            // também trava.
            const rectShape = shapes.find((sh) => sh.id === rectHit.shapeId);
            const cornerPointId =
              rectShape && rectShape.type === "rect" ? (rectHit.corner === "p1" ? rectShape.p1 : rectShape.p2) : null;
            const axisLocked =
              isRectAxisDrivenByDimension(rectHit.shapeId, rectHit.axis, dimensions) ||
              (cornerPointId ? fixedPointIds.includes(cornerPointId) : false);
            set({
              selectedShapeId: rectHit.shapeId,
              selectDrag: axisLocked
                ? null
                : {
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
            // Ponta medida por uma cota não-referência trava o arrasto
            // (ver isPointDrivenByDimension) — estica o comprimento, que é
            // exatamente o que uma cota de distância/raio de arco mede.
            // Ponta com restrição "Fixo" (ver fixedPointIds) também trava.
            const endLocked =
              isPointDrivenByDimension(lineHit.movingPointId, dimensions, shapes) ||
              fixedPointIds.includes(lineHit.movingPointId);
            set({
              selectedShapeId: lineHit.shapeId,
              selectDrag: endLocked
                ? null
                : {
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
        edgeHitCandidate: tool === "dimension" ? findEdgeOrPointHit(raw, shapes, points, EDGE_SELECT_TOLERANCE) : null,
      });
    },

    handleRawMove: (raw, referenceGeometry = []) => {
      const { selectDrag, downRaw, tool, shapes, points, dimensionDrag, constraints, fixedPointIds } = get();
      const fixedSet = new Set(fixedPointIds);

      if (dimensionDrag) {
        // Recalcula offset+labelT (ou offset+angle) DIRETO da posição atual
        // do mouse contra a geometria de referência (fixa, sem offset) —
        // não acumula delta, então não tem deriva por mais que o arrasto
        // dure. Dá pra mover a cota em QUALQUER direção (não só
        // perpendicular): pra longe/perto da geometria (offset) E ao longo
        // dela — do outro lado do segmento (labelT) ou girando em volta do
        // círculo (angle) — junto isso é o "dinamismo" de arrastar o texto
        // pra qualquer lugar que o Inventor tem.
        if (dimensionDrag.kind === "radius") {
          const { center, r } = dimensionDrag;
          const dx = raw.x - center.x;
          const dy = raw.y - center.y;
          const offset = Math.hypot(dx, dy) - r;
          const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
          set({ dimensionDragPreview: { offset, angle } });
        } else {
          const { a, b } = dimensionDrag;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const len = Math.hypot(dx, dy) || 1;
          const ux = dx / len;
          const uy = dy / len;
          const nx = -uy;
          const ny = ux;
          const offset = (raw.x - a.x) * nx + (raw.y - a.y) * ny;
          const rawT = ((raw.x - a.x) * ux + (raw.y - a.y) * uy) / len;
          const labelT = Math.max(0, Math.min(1, rawT));
          set({ dimensionDragPreview: { offset, labelT } });
        }
        return;
      }

      if (selectDrag) {
        if (selectDrag.mode === "point") {
          const snapped = previewSnap(raw, referenceGeometry);
          set({ dragPreview: computeDragPreview({ [selectDrag.pointId]: snapped }, shapes, points, constraints, fixedSet) });
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
          set({ dragPreview: computeDragPreview(preview, shapes, points, constraints, fixedSet) });
        } else if (selectDrag.mode === "lineEnd") {
          // Estica/encolhe só ao longo da direção original da linha — não
          // deixa o ângulo mudar, só o comprimento a partir dessa ponta.
          const { anchor, direction } = selectDrag;
          const projected = (raw.x - anchor.x) * direction.x + (raw.y - anchor.y) * direction.y;
          const clamped = Math.max(projected, 2);
          const newPos = { x: anchor.x + direction.x * clamped, y: anchor.y + direction.y * clamped };
          set({ dragPreview: computeDragPreview({ [selectDrag.movingPointId]: newPos }, shapes, points, constraints, fixedSet) });
        }
        return;
      }

      if (!downRaw) {
        if (tool === "dimension") {
          set({ hoverHit: findEdgeOrPointHit(raw, shapes, points, EDGE_SELECT_TOLERANCE) });
        } else if (SLOT_TOOLS.has(tool)) {
          // Passos 1/2 (antes do arrasto): sem downRaw ainda, mas o preview
          // ao vivo (linha de borracha até o cursor) reaproveita draftPoint
          // do mesmo jeito que o arrasto do raio faz mais adiante — com o
          // MESMO resolveSlotPoint do clique de verdade (findAlignmentGuides
          // primeiro, applyAxisSnap como último recurso), pra a linha
          // pontilhada + a(s) guia(s) de alinhamento já mostrarem exatamente
          // o que vai acontecer antes de clicar.
          const { pendingSlot: pending } = get();
          const anchor =
            pending?.kind === "centerToCenter" ? points[pending.center1Id] : pending?.kind === "centerPoint" ? pending.midpoint : null;
          const extra = pending?.kind === "centerPoint" ? [pending.midpoint] : [];
          const { point: target, guideX, guideY } = resolveSlotPoint(raw, anchor ?? null, points, extra);
          set({
            draftPoint: previewSnap(target, referenceGeometry),
            alignmentGuides: guideX || guideY ? { x: guideX, y: guideY } : null,
          });
        } else if (HOVER_SNAP_TOOLS.has(tool)) {
          // Ao estilo Inventor: passar o mouse perto de uma referência
          // reconhecível (ponto existente, meio de uma aresta — ver
          // findNearbyLineMidpoint em hitTest.ts —, aresta em si, geometria
          // de referência do sólido) já mostra o indicador de snap ANTES do
          // 1º clique, não só durante o arrasto do 2º ponto em diante.
          // previewSnap seta snapIndicator sozinho (efeito colateral de
          // propósito, ver comentário na própria função); aqui só interessa
          // isso, não precisa do valor de volta (ainda não existe nenhum
          // draftPoint pra desenhar sem 1º clique).
          previewSnap(raw, referenceGeometry);
        }
        return;
      }

      set({ draftPoint: previewSnap(raw, referenceGeometry), alignmentGuides: null });
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
        if (dimensionDragPreview) {
          get().updateDimensionOffset(dimensionDrag.dimensionId, dimensionDragPreview.offset);
          if ("labelT" in dimensionDragPreview) {
            get().updateDimensionLabelT(dimensionDrag.dimensionId, dimensionDragPreview.labelT);
          } else {
            get().updateDimensionAngle(dimensionDrag.dimensionId, dimensionDragPreview.angle);
          }
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
      // Arestas retas (linha/aresta de retângulo/tangente de rasgo) E
      // pontos soltos (ex.: centro de círculo, ver kind "point" em
      // hitTest.ts) passam por um 2º passo opcional, ao estilo Inventor:
      // clicar a 1ª referência só "arma" a seleção (dimensionPick1); clicar
      // uma 2ª referência diferente dá a distância ENTRE as duas — aresta a
      // aresta (ex.: as 2 tangentes de um rasgo = largura dele), ponto até
      // aresta (ex.: centro de um círculo até uma linha projetada — mede a
      // perpendicular de verdade, ver projectOnInfiniteLine em render.ts),
      // ou ponto até ponto (2 centros) — em vez da cota natural de cada uma
      // isolada. Raio de círculo/arco/rasgo continua instantâneo num clique
      // só, sem essa espera.
      if (tool === "dimension" && dragDistance < CLICK_VS_DRAG_THRESHOLD) {
        const { dimensionPick1 } = get();

        if (dimensionPick1) {
          if (!edgeHitCandidate || sameEdgeHit(dimensionPick1, edgeHitCandidate)) {
            const dimension = edgeHitToDimension(dimensionPick1, shapes);
            if (dimension) get().addDimension(dimension);
          } else if (isPickableHit(edgeHitCandidate)) {
            get().addDimension({
              id: createId(),
              kind: "edgeDistance",
              a: edgeHitToEdgeRef(dimensionPick1),
              b: edgeHitToEdgeRef(edgeHitCandidate),
            });
          } else {
            // 2º clique caiu num raio (círculo/arco/rasgo) — não dá pra
            // relacionar com a referência pendente, descarta a espera e
            // cota o raio na hora, comportamento instantâneo de sempre.
            const dimension = edgeHitToDimension(edgeHitCandidate, shapes);
            if (dimension) get().addDimension(dimension);
          }
          set({ dimensionPick1: null, downRaw: null, draftPoint: null, edgeHitCandidate: null });
          return;
        }

        if (edgeHitCandidate) {
          if (isPickableHit(edgeHitCandidate)) {
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
          // Círculo/arco/rasgo: reconhece o CENTRO com o mesmo critério
          // relativo (perto do centro X perto da borda) que o clique
          // único já usa em findEdgeHit — resolveSnapWithEdges sozinho usa
          // uma tolerância fixa pequena pro "ponto já existente" e círculo
          // fica de fora do "ponto mais próximo numa aresta" (ver
          // findNearestPointOnShapes), então um arrasto começado um pouco
          // fora do centro exato caía no ponto de GRID mais perto em vez
          // do centro de verdade — resultando numa cota torta/deslocada em
          // ângulo em vez de sair certinho do centro.
          const startCenterHit = findEdgeHit(downRaw, shs, pts, EDGE_SELECT_TOLERANCE);
          const startCenterId = startCenterHit?.kind === "point" ? startCenterHit.pointId : null;
          const startSnap = resolveSnapWithEdges(downRaw, pts, shs, referenceGeometry, gridSize, SNAP_TOLERANCE);
          if (startCenterId || startSnap.snapped) {
            const startId = startCenterId ?? startSnap.existingId ?? get().resolvePointAt(downRaw, SNAP_TOLERANCE, referenceGeometry);
            const circle = findCircleByCenter(get().shapes, startId);
            const arc = circle ? null : findArcByCenter(get().shapes, startId);
            const slot = circle || arc ? null : findSlotByCenter(get().shapes, startId);
            const centerShape = circle || arc || slot;

            // Só busca isso quando o arrasto começa num centro — pro caso
            // comum (arrasto ponto a ponto) é trabalho à toa. Mesma
            // melhoria pro FIM do arrasto: findEdgeOrPointHit já reconhece
            // ponto (incl. centro de OUTRO círculo) e linha com o critério
            // certo, num campo só, então cobre um alvo impreciso melhor
            // que resolveSnapWithEdges sozinho também cobriria.
            const endHit = centerShape ? findEdgeOrPointHit(rawEnd, get().shapes, get().points, EDGE_SELECT_TOLERANCE) : null;

            if (centerShape && endHit?.kind === "line") {
              // Arrastou o centro do círculo/arco/rasgo até uma LINHA —
              // mede a distância perpendicular de verdade até ela (mesma
              // cota "edgeDistance" que o clique único já cria), em vez do
              // atalho de raio abaixo, que ignorava pra onde o arrasto foi.
              get().addDimension({
                id: createId(),
                kind: "edgeDistance",
                a: { kind: "point", pointId: startId },
                b: { kind: "line", lineId: endHit.shapeId },
              });
            } else if (centerShape && endHit?.kind === "point" && endHit.pointId !== startId) {
              // Arrastou até OUTRO ponto de verdade (outro centro, vértice
              // etc.) — mede a distância até ele, mesma ideia acima.
              get().addDimension({ id: createId(), kind: "distance", p1: startId, p2: endHit.pointId });
            } else if (circle) {
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
          } else if (tool === "line" && startId !== endId) {
            get().addShape({ id: createId(), type: "line", p1: startId, p2: endId });
          } else if (tool === "rect" && startId !== endId) {
            // Ao estilo Inventor: a ferramenta Retângulo já cria 4 linhas de
            // verdade (com coincidência nos cantos, pelo pool de pontos
            // compartilhado), não 1 primitivo rígido — cada lado fica
            // selecionável/arrastável/cotável na hora (findRectRegion/
            // findEdgeHit continuam existindo só pra retângulos "rect" de
            // projetos salvos ANTES dessa mudança — convertRectToLines
            // também, como ação manual pra esses). findProfileSource já
            // sabe achar perfil num contorno fechado de linhas soltas (ver
            // findClosedLoop em replicad/geometry.ts), então Extrudar
            // continua funcionando igual num retângulo assim. Cada lado já
            // nasce H ou V por construção — axisLock marca isso de forma
            // PERSISTENTE (não só nesse instante), pra arrastar um canto
            // depois continuar reto em vez de virar um quadrilátero torto
            // (ver computeAxisLockFollowers).
            const p1 = get().points[startId];
            const p2 = get().points[endId];
            if (p1 && p2 && Math.abs(p2.x - p1.x) > 1e-6 && Math.abs(p2.y - p1.y) > 1e-6) {
              const cornerBId = get().resolvePointAt({ x: p2.x, y: p1.y }, SNAP_TOLERANCE, referenceGeometry);
              const cornerDId = get().resolvePointAt({ x: p1.x, y: p2.y }, SNAP_TOLERANCE, referenceGeometry);
              get().addShape({ id: createId(), type: "line", p1: startId, p2: cornerBId, axisLock: "horizontal" });
              get().addShape({ id: createId(), type: "line", p1: cornerBId, p2: endId, axisLock: "vertical" });
              get().addShape({ id: createId(), type: "line", p1: endId, p2: cornerDId, axisLock: "horizontal" });
              get().addShape({ id: createId(), type: "line", p1: cornerDId, p2: startId, axisLock: "vertical" });
            }
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
      // anchorId[i][j]: id do 1º ponto da instância (i,j) (mesmo ponto que
      // representa a posição de QUALQUER forma, ver pointIdsOfShape) — só
      // pra montar as cotas de espaçamento abaixo, editáveis depois (ver
      // patternFollowers em types.ts/updateDistanceDimension).
      const anchorId: string[][] = Array.from({ length: n1 }, () => new Array<string>(n2));
      anchorId[0][0] = sourcePoints[0].id;

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
          anchorId[i][j] = idMap.get(sourcePoints[0].id)!;
        }
      }

      set((s) => ({
        points: { ...s.points, ...newPoints },
        shapes: [...s.shapes, ...newShapes],
      }));

      // Cota de espaçamento por direção usada (ao estilo Inventor): p1/p2
      // são a origem e a 1ª instância nessa direção, medindo exatamente
      // o espaçamento; patternFollowers lista TODA instância além dessas
      // duas (de qualquer linha/coluna) que também precisa acompanhar,
      // escalada pelo próprio índice — editar o valor depois reposiciona
      // a grade inteira, não só a instância mais próxima. Só cria se
      // houver mais de 1 instância naquela direção (senão não tem
      // espaçamento nenhum pra cotar).
      if (n1 > 1) {
        const followers: { pointId: string; multiplier: number }[] = [];
        for (let i = 1; i < n1; i++) {
          for (let j = 0; j < n2; j++) {
            if (i === 1 && j === 0) continue; // é o próprio p2
            followers.push({ pointId: anchorId[i][j], multiplier: i });
          }
        }
        get().addDimension({
          id: createId(),
          kind: "distance",
          p1: anchorId[0][0],
          p2: anchorId[1][0],
          patternFollowers: followers,
        });
      }
      if (n2 > 1) {
        const followers: { pointId: string; multiplier: number }[] = [];
        for (let j = 1; j < n2; j++) {
          for (let i = 0; i < n1; i++) {
            if (i === 0 && j === 1) continue; // é o próprio p2
            followers.push({ pointId: anchorId[i][j], multiplier: j });
          }
        }
        get().addDimension({
          id: createId(),
          kind: "distance",
          p1: anchorId[0][0],
          p2: anchorId[0][1],
          patternFollowers: followers,
        });
      }
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
