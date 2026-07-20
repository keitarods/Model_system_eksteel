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
