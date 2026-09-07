import { measureArea } from "replicad";
import type { Edge, Solid } from "replicad";

// Tolerância pra reencontrar, num sólido RECONSTRUÍDO do zero, as mesmas
// arestas escolhidas antes — mais apertada que a de clique (findClickedEdge)
// porque aqui a geometria deveria bater quase exatamente (mesmos parâmetros
// de construção), só a reconstrução do WASM muda.
const EDGE_MATCH_TOLERANCE = 0.75;
// Tolerância de clique: bem mais generosa, já que o alvo é uma linha fina
// (não uma face), e o ponto de acerto vem de um raycast contra a malha de
// triângulos, não da própria aresta.
const EDGE_CLICK_TOLERANCE = 5;

// 20 amostras, não 5: com poucas amostras, clicar perto do MEIO de uma
// aresta comprida (longe de qualquer uma das 5) podia ficar mais longe da
// amostra mais próxima do que a tolerância de clique, mesmo clicando bem
// em cima da aresta de verdade — curva/reta genérica aqui, então amostragem
// (não dá pra usar distância ponto-segmento exata como listLinearEdges faz,
// que só vale pra retas).
function sampleEdgePoints(edge: Edge): [number, number, number][] {
  const segments = 20;
  const points: [number, number, number][] = [];
  for (let i = 0; i <= segments; i++) {
    const p = edge.pointAt(i / segments);
    points.push([p.x, p.y, p.z]);
    p.delete();
  }
  return points;
}

// Acha a aresta do sólido mais próxima de um ponto (o hit de um raycast
// contra a MALHA/face, não contra a própria linha do wireframe — não
// precisamos de picking direto na linha, clicar perto o bastante de uma
// aresta na face já basta, como em qualquer CAD). Devolve um ponto de
// referência sobre essa aresta — usado tanto pra destacar visualmente qual
// foi escolhida quanto pra guardar na feature e reencontrá-la depois de
// reconstruir o sólido do zero (ver findEdgesByPoints).
export function findClickedEdge(
  solid: Solid,
  point: [number, number, number]
): { point: [number, number, number] } | null {
  let bestPoint: [number, number, number] | null = null;
  let bestDist = Infinity;

  for (const edge of solid.edges) {
    for (const sample of sampleEdgePoints(edge)) {
      const d = Math.hypot(sample[0] - point[0], sample[1] - point[1], sample[2] - point[2]);
      if (d < bestDist) {
        bestDist = d;
        bestPoint = sample;
      }
    }
  }

  return bestPoint && bestDist <= EDGE_CLICK_TOLERANCE ? { point: bestPoint } : null;
}

type Vec3 = [number, number, number];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);

// Circuncentro de 3 pontos no espaço 3D (fórmula vetorial padrão) — usada
// pra achar centro/raio/plano de uma aresta CIRCULAR a partir de 3 amostras
// dela, sem precisar assumir que a aresta está alinhada a nenhum eixo.
function circumcircle(a: Vec3, b: Vec3, c: Vec3): { center: Vec3; radius: number; normal: Vec3 } | null {
  const ab = sub(b, a);
  const ac = sub(c, a);
  const abXac = cross(ab, ac);
  const abXacLenSq = dot(abXac, abXac);
  if (abXacLenSq < 1e-12) return null; // pontos quase colineares

  const toCenter = scale(
    add(scale(cross(abXac, ab), dot(ac, ac)), scale(cross(ac, abXac), dot(ab, ab))),
    1 / (2 * abXacLenSq)
  );
  const center = add(a, toCenter);
  const radius = norm(toCenter);
  const normalLen = norm(abXac) || 1;
  const normal: Vec3 = [abXac[0] / normalLen, abXac[1] / normalLen, abXac[2] / normalLen];
  return { center, radius, normal };
}

// Acha a aresta CIRCULAR (rebordo de um furo, ao estilo Inventor: dá pra
// restringir "Inserir"/Concêntrico clicando direto na borda do furo, sem
// precisar mirar na parede cilíndrica fina por dentro) mais próxima de um
// ponto clicado — mesma ideia de findClickedEdge, mas só entre arestas
// CIRCLE, devolvendo já o centro/raio/normal do círculo (não só um ponto
// de referência).
export function findClickedCircularEdge(
  solid: Solid,
  point: [number, number, number]
): { origin: [number, number, number]; normal: [number, number, number]; radius: number } | null {
  let best: { origin: Vec3; normal: Vec3; radius: number; dist: number } | null = null;

  for (const edge of solid.edges) {
    if (edge.geomType !== "CIRCLE") continue;

    const samples = sampleEdgePoints(edge);
    const closest = samples.reduce((acc, s) => {
      const d = Math.hypot(s[0] - point[0], s[1] - point[1], s[2] - point[2]);
      return d < acc.dist ? { sample: s, dist: d } : acc;
    }, { sample: samples[0], dist: Infinity });
    if (closest.dist > EDGE_CLICK_TOLERANCE) continue;

    const p0 = edge.pointAt(0);
    const p1 = edge.pointAt(1 / 3);
    const p2 = edge.pointAt(2 / 3);
    const fit = circumcircle([p0.x, p0.y, p0.z], [p1.x, p1.y, p1.z], [p2.x, p2.y, p2.z]);
    p0.delete();
    p1.delete();
    p2.delete();
    if (!fit) continue;

    if (!best || closest.dist < best.dist) {
      best = { origin: fit.center, normal: fit.normal, radius: fit.radius, dist: closest.dist };
    }
  }

  return best ? { origin: best.origin, normal: best.normal, radius: best.radius } : null;
}

// Lista TODAS as arestas retas (LINE) do sólido com seus dois extremos —
// usada pra desenhar a camada de linhas clicáveis do Flange (ver
// LinearEdgePicker3D em Viewer3D.tsx). Ao estilo Inventor: o usuário clica
// direto na LINHA da aresta (raycasting contra a própria geometria da
// aresta, com um limiar de distância pequeno), não mais numa FACE seguida
// de busca da aresta mais próxima do ponto — isso é o que causava dobras
// nascendo na aresta errada/deslocada perto de cantos ou de arestas curtas
// vizinhas (o "caco fino" e o "deslocada" relatados).
export function listLinearEdges(
  solid: Solid
): { start: [number, number, number]; end: [number, number, number] }[] {
  const result: { start: [number, number, number]; end: [number, number, number] }[] = [];
  for (const edge of solid.edges) {
    if (edge.geomType !== "LINE") continue;
    const startVec = edge.startPoint;
    const endVec = edge.endPoint;
    result.push({
      start: [startVec.x, startVec.y, startVec.z],
      end: [endVec.x, endVec.y, endVec.z],
    });
    startVec.delete();
    endVec.delete();
  }
  return result;
}

// Acha a face PLANA "principal" que contém a aresta dada — a que a Flange
// deve considerar como origem da dobra. Uma aresta reta do contorno de uma
// chapa sempre faz fronteira com duas faces planas coplanares a ela: a face
// grande (topo/base do painel) e a parede fina da espessura — sem precisar
// de nenhuma normal escolhida por clique (a Flange agora nasce só da aresta,
// clicada como linha), a face certa é sempre a de MAIOR área entre as que
// contêm a aresta no seu próprio plano; a parede fina nunca vence esse
// desempate, já que sua área é da ordem da espessura × comprimento da
// aresta, sempre muito menor que a face principal.
export function findMainFaceForEdge(
  solid: Solid,
  edgeStart: [number, number, number],
  edgeEnd: [number, number, number]
): { center: [number, number, number]; normal: [number, number, number] } | null {
  const edgeMid: [number, number, number] = [
    (edgeStart[0] + edgeEnd[0]) / 2,
    (edgeStart[1] + edgeEnd[1]) / 2,
    (edgeStart[2] + edgeEnd[2]) / 2,
  ];

  const PLANE_TOLERANCE = 0.5;
  let best: { center: [number, number, number]; normal: [number, number, number]; area: number } | null = null;
  // Reserva do candidato mais próximo do plano mesmo fora da tolerância —
  // uma rede de segurança pra planificação de dobra-sobre-dobra, onde a
  // posição desfeita da aresta pode ficar com um pouco de erro numérico
  // residual (arredondamento acumulado na cadeia de FlattenLink); melhor
  // usar a face mais próxima do que travar a reconstrução inteira.
  let fallback: { center: [number, number, number]; normal: [number, number, number]; planeDist: number } | null =
    null;

  for (const face of solid.faces) {
    if (face.geomType !== "PLANE") continue;

    const centerVec = face.center;
    const center: [number, number, number] = [centerVec.x, centerVec.y, centerVec.z];
    centerVec.delete();

    const normalVec = face.normalAt(center);
    const faceNormal: [number, number, number] = [normalVec.x, normalVec.y, normalVec.z];
    normalVec.delete();

    const toEdge: [number, number, number] = [edgeMid[0] - center[0], edgeMid[1] - center[1], edgeMid[2] - center[2]];
    const planeDist = Math.abs(toEdge[0] * faceNormal[0] + toEdge[1] * faceNormal[1] + toEdge[2] * faceNormal[2]);

    if (!fallback || planeDist < fallback.planeDist) {
      fallback = { center, normal: faceNormal, planeDist };
    }
    if (planeDist > PLANE_TOLERANCE) continue; // aresta não está no plano dessa face

    const area = measureArea(face);
    if (!best || area > best.area) {
      best = { center, normal: faceNormal, area };
    }
  }

  if (best) return { center: best.center, normal: best.normal };
  if (fallback) {
    console.warn(
      `findMainFaceForEdge: nenhuma face dentro da tolerância (${PLANE_TOLERANCE}mm) — usando a mais próxima (${fallback.planeDist.toFixed(3)}mm).`
    );
    return { center: fallback.center, normal: fallback.normal };
  }
  return null;
}

// Reencontra, num sólido reconstruído do zero, as arestas mais próximas dos
// pontos de referência guardados numa feature de fillet/chamfro — mesmo
// princípio geométrico já usado em findClickedFace/findClickedAxis (nunca
// dá pra confiar em identidade de objeto entre reconstruções). De propósito
// não chama .delete() nas arestas não usadas (mesmo cuidado de sempre com
// WASM) — as escolhidas são devolvidas vivas, prontas pra passar direto
// pro .fillet()/.chamfer() do replicad (EdgeFinder.inList).
export function findEdgesByPoints(solid: Solid, points: [number, number, number][]): Edge[] {
  const matched: Edge[] = [];
  for (const edge of solid.edges) {
    const samples = sampleEdgePoints(edge);
    const isMatch = points.some((p) =>
      samples.some((s) => Math.hypot(s[0] - p[0], s[1] - p[1], s[2] - p[2]) < EDGE_MATCH_TOLERANCE)
    );
    if (isMatch) matched.push(edge);
  }
  return matched;
}
