import { draw, drawRoundedRectangle, measureVolume } from "replicad";
import type { Solid } from "replicad";
import type { SketchPlane } from "@/lib/sketch/types";
import type { Feature } from "@/lib/features/types";
import { extrudeProfile } from "./geometry";
import { findMainFaceForEdge } from "./edgeTools";

type Vec3 = [number, number, number];
type Vec2 = [number, number];

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
function scale(v: Vec3, s: number): Vec3 {
  return [v[0] * s, v[1] * s, v[2] * s];
}
function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function norm(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}
function mid(a: Vec3, b: Vec3): Vec3 {
  return scale(add(a, b), 0.5);
}
function negate(v: Vec3): Vec3 {
  return [-v[0], -v[1], -v[2]];
}

// Rotação de Rodrigues: gira v em torno do eixo unitário axisDir por
// angleDeg graus — usada só pra desfazer a ORIENTAÇÃO (não a posição) de um
// ancestral dobrado, ver undoLinkDir abaixo.
function rotateVector(v: Vec3, axisDir: Vec3, angleDeg: number): Vec3 {
  const k = norm(axisDir);
  const angleRad = (angleDeg * Math.PI) / 180;
  const cosA = Math.cos(angleRad);
  const sinA = Math.sin(angleRad);
  const kCrossV = cross(k, v);
  const kDotV = dot(k, v);
  return add(add(scale(v, cosA), scale(kCrossV, sinA)), scale(k, kDotV * (1 - cosA)));
}

// Fator K = 0,5 (eixo neutro no meio da espessura) — a convenção padrão
// "de livro-texto" quando não há tabela de dobra específica do material/
// processo (K real varia por material e processo de dobra).
const K_FACTOR = 0.5;

// Desenvolvimento da dobra (bend allowance): quanto material o arco da
// dobra "consome" quando planificado — soma no comprimento total da aba no
// padrão plano.
export function bendAllowance(angleDeg: number, innerRadius: number, thickness: number): number {
  const angleRad = (angleDeg * Math.PI) / 180;
  return angleRad * (innerRadius + K_FACTOR * thickness);
}

// Um "elo" da cadeia de planificação: descreve a dobra de UM ancestral
// (Flange) com parâmetros suficientes pra desfazer EXATAMENTE a dobra real
// (arco + trecho reto), não só uma rotação rígida aproximada — guarda a
// mesma base local (axisDir=aresta, outDir/yDir=eixos do plano da seção,
// n=normal real) e os mesmos parâmetros (raio, espessura, comprimento,
// ângulo, vSign) usados pra CONSTRUIR a dobra em bendCrossSection, pra poder
// reaplicar a mesmíssima matemática ao contrário.
export type FlattenLink = {
  axisPoint: Vec3; // início da aresta original (linha de dobra)
  axisDir: Vec3; // unitário, ao longo da aresta
  outDir: Vec3; // unitário, "pra fora do corpo" no plano da face de origem (v=0 do perfil)
  yDir: Vec3; // unitário, cross(axisDir, outDir) — eixo "y" local do plano de extrusão da dobra
  n: Vec3; // unitário, normal real da face de origem — direção da espessura no padrão plano
  vSign: 1 | -1;
  angleDeg: number;
  radius: number; // raio interno (= espessura no momento da construção)
  thickness: number;
  length: number; // comprimento reto da aba (dobrada)
  allowance: number; // bendAllowance(angleDeg, radius, thickness)
};

// Desfaz UM elo com a inversa EXATA da construção de bendCrossSection — não
// uma rotação rígida aproximada em torno do eixo (que só é exata pra pontos
// na aresta BEM no fim da aba, paralela à linha de dobra; pra pontos ao
// longo de uma aresta LATERAL — que atravessa o arco da dobra — precisa
// saber, ponto a ponto, se ele caiu dentro do arco ou já no trecho reto).
//
// 1. Decompõe p em coordenadas locais da dobra: u (ao longo da aresta,
//    nunca muda com a dobra), v2d/w2d (no plano da seção transversal, exatos
//    nas mesmas coordenadas 2D que bendCrossSection usa pra desenhar).
// 2. Se (v2d,w2d) cai dentro do arco (ângulo local entre 0 e o ângulo da
//    dobra): o comprimento planificado equivalente é proporcional ao ângulo
//    já varrido (mesma premissa do fator K usada em bendAllowance), e a
//    profundidade na espessura vem do raio local.
// 3. Senão (já no trecho reto, depois do fim do arco): decompõe relativo ao
//    fim do arco interno na base (dirFlange, perpInward) — a mesma base que
//    bendCrossSection usa pra desenhar essa parte — dando comprimento e
//    profundidade exatos.
function undoLink(link: FlattenLink, p: Vec3): Vec3 {
  const rel = sub(p, link.axisPoint);
  const u = dot(rel, link.axisDir);
  const v2d = dot(rel, link.outDir);
  const w2d = dot(rel, link.yDir);

  const angleRad = (link.angleDeg * Math.PI) / 180;
  const cosA = Math.cos(angleRad);
  const sinA = Math.sin(angleRad);
  const centerV = link.radius * link.vSign;

  const relV = v2d;
  const relW = w2d - centerV;
  const rLocal = Math.hypot(relV, relW);
  const ARC_SLACK = 0.05; // rad de folga na borda do arco, por segurança numérica
  const phi = angleRad > 1e-6 ? Math.atan2(relV, -relW * link.vSign) : angleRad + 1;

  let flatS: number;
  let wFlat: number;
  if (angleRad > 1e-6 && phi >= -ARC_SLACK && phi <= angleRad + ARC_SLACK) {
    const clampedPhi = Math.max(0, Math.min(angleRad, phi));
    flatS = (clampedPhi / angleRad) * link.allowance;
    wFlat = link.radius - rLocal;
  } else {
    const dirFlange: Vec2 = [cosA, sinA * link.vSign];
    const perpInward: Vec2 = [-sinA, cosA * link.vSign];
    const innerEnd: Vec2 = [
      link.radius * Math.sin(angleRad),
      centerV - link.radius * Math.cos(angleRad) * link.vSign,
    ];
    const relToInnerEnd: Vec2 = [v2d - innerEnd[0], w2d - innerEnd[1]];
    const t = relToInnerEnd[0] * dirFlange[0] + relToInnerEnd[1] * dirFlange[1];
    const k = relToInnerEnd[0] * perpInward[0] + relToInnerEnd[1] * perpInward[1];
    flatS = link.allowance + t;
    wFlat = k;
  }

  return add(add(add(link.axisPoint, scale(link.axisDir, u)), scale(link.outDir, flatS)), scale(link.n, wFlat));
}

// Desfaz a cadeia inteira, do elo mais recente pro mais antigo (a aresta foi
// capturada com TODOS os ancestrais já dobrados, então desfazer precisa ir
// na ordem inversa de como as dobras foram se acumulando).
export function undoFlattenChain(chain: FlattenLink[], p: Vec3): Vec3 {
  let result = p;
  for (let i = chain.length - 1; i >= 0; i--) result = undoLink(chain[i], result);
  return result;
}

// Desfaz só a ORIENTAÇÃO de um elo (não a posição) — uma rotação rígida
// pelo ângulo INTEIRO da dobra em torno do eixo. Ao contrário de undoLink
// (que precisa saber se o ponto caiu dentro do arco ou já no trecho reto,
// já que a orientação da superfície varia continuamente dentro do arco),
// isso só é chamado com a normal/direções de uma FACE PLANA existente da
// Flange-pai — e a única face plana de uma dobra que pode servir de origem
// pra outra Flange é sempre a parte RETA, depois do fim do arco, que tem
// orientação CONSTANTE (rotacionada pelo ângulo total da dobra em relação
// à base) — nunca a própria superfície curva do arco (que nem entra como
// candidata em findMainFaceForEdge, só aceita faces PLANE).
//
// O ângulo de rotação é vSign*angleDeg, não só angleDeg: o arco pode
// curvar pra qualquer um dos dois lados (vSign = ±1, ver bendCrossSection),
// e isso troca o SENTIDO da rotação em torno do eixo, não só a posição —
// undoLink já carrega esse sinal embutido na sua própria matemática 2D
// (dirFlange/perpInward usam vSign direto); sem multiplicar por vSign
// aqui, a metade dos casos (vSign=-1) desgirava pro lado errado, e o
// painel planificado saía espelhado, sobreposto à face de origem em vez de
// se estender pra fora dela.
function undoLinkDir(link: FlattenLink, v: Vec3): Vec3 {
  return rotateVector(v, link.axisDir, -link.vSign * link.angleDeg);
}

// Mesma ideia de undoFlattenChain, mas pra uma DIREÇÃO (normal/eixo) em vez
// de uma posição — usado só na construção do painel planificado de uma
// Flange (nunca pra achar a face/direção "pra fora", que sempre usa a
// sombra sempre-dobrada com as direções cruas). Sem isso, o painel plano de
// uma Flange encadeada (nascida em cima de OUTRA Flange já dobrada) saía
// construído com a normal/direção ainda inclinadas pelo ângulo do pai —
// ou seja, o painel "planificado" continuava de pé, na mesma orientação da
// dobra 3D, em vez de deitado no plano da chapa toda desdobrada.
export function undoFlattenChainDir(chain: FlattenLink[], v: Vec3): Vec3 {
  let result = v;
  for (let i = chain.length - 1; i >= 0; i--) result = undoLinkDir(chain[i], result);
  return result;
}

// Direção/origem-base comuns aos dois modos de construção (dobrada e
// planificada): a aresta em si (dRaw), a normal da face de origem (n) e
// outDir — a direção, dentro do plano dessa face, que aponta "pra fora" do
// corpo. A face de origem e sua normal vêm inteiramente da GEOMETRIA da
// aresta (findMainFaceForEdge: a face plana de maior área entre as que
// contêm a aresta) — não de onde/como o usuário clicou. A Flange agora
// nasce de clicar direto na LINHA da aresta (ao estilo Inventor), então não
// existe mais um "ponto de clique" nem uma normal escolhida por clique para
// alimentar esse cálculo; só os dois extremos da aresta.
function computeEdgeFrame(solid: Solid, edgeStart: Vec3, edgeEnd: Vec3) {
  const dRaw = norm(sub(edgeEnd, edgeStart));
  const edgeMid = mid(edgeStart, edgeEnd);

  const mainFace = findMainFaceForEdge(solid, edgeStart, edgeEnd);
  if (!mainFace) {
    throw new Error(
      "Flange: não consegui achar a face de origem dessa aresta no sólido atual — tente clicar em outra aresta."
    );
  }
  const n = norm(mainFace.normal);
  const faceCenter = mainFace.center;

  const towardEdge = sub(edgeMid, faceCenter);
  const alongD = scale(dRaw, dot(towardEdge, dRaw));
  const perp = sub(towardEdge, alongD);
  const perpLength = Math.hypot(perp[0], perp[1], perp[2]);
  if (perpLength < 0.5) {
    throw new Error(
      `Flange: não consegui determinar o lado "pra fora" da face (a aresta passa quase pelo centro da face, perpLength=${perpLength.toFixed(3)}).`
    );
  }
  const outDir = norm(perp);

  return { dRaw, n, edgeMid, outDir };
}

// Perfil 2D (fechado, já com os dois arcos da dobra) da chapa ADICIONADA
// por uma Flange — construído direto com o raio certo em cada arco, sem
// nenhuma operação de fillet 3D depois. Coordenadas locais (u,v): u ao
// longo da aresta original (não usado aqui, é a direção de extrusão), v=0
// é a face de origem (onde a aresta clicada está) e v=-thickness é a outra
// face da chapa nesse ponto — o perfil sempre conecta EXATAMENTE a essas
// duas, então funde sem folga nem sobreposição com o material existente.
//
//   pBottom (0,-thickness) ──arco externo (raio+espessura)──> outerEnd
//        │                                                       │
//     [fecha]                                            reto (length)
//        │                                                       │
//      p0 (0,0) <──arco interno (raio)── innerEnd <── reto ── farInner
//                                                                 │
//                                                          reto (espessura)
//                                                                 │
//                                                              farOuter
//
// O arco INTERNO (raio = espessura da chapa) fica no lado côncavo da dobra
// — tangente à face de origem (v=0), por isso o raio menor bate com "raio
// interno = espessura" que o usuário descreveu. O externo (convexo) é
// tangente à outra face (v=-thickness) com raio = espessura+espessura.
//
// vSign espelha o eixo v inteiro (1 ou -1) — necessário porque xDir do
// plano de extrusão é sempre outDir (não dá pra escolher livremente só
// pra fazer v bater com a normal certa, isso é o que causava o resultado
// "ao contrário": xDir precisa continuar significando "pra fora do corpo"
// pro perfil ficar do lado certo; quem se ajusta é o sinal de v).
function bendCrossSection(radius: number, thickness: number, angleDeg: number, length: number, vSign: 1 | -1) {
  const angleRad = (angleDeg * Math.PI) / 180;
  const cosA = Math.cos(angleRad);
  const sinA = Math.sin(angleRad);
  const outerRadius = radius + thickness;

  const centerV = radius * vSign;
  const arcPoint = (r: number, phi: number): Vec2 => [r * Math.sin(phi), centerV - r * Math.cos(phi) * vSign];

  const dirFlange: Vec2 = [cosA, sinA * vSign];
  const perpInward: Vec2 = [-sinA, cosA * vSign]; // 90° de dirFlange — aponta pro lado côncavo (espessura da aba)

  const pBottom: Vec2 = [0, -thickness * vSign];
  const outerEnd = arcPoint(outerRadius, angleRad);
  const outerMid = arcPoint(outerRadius, angleRad / 2);
  const farOuter: Vec2 = [outerEnd[0] + dirFlange[0] * length, outerEnd[1] + dirFlange[1] * length];
  const farInner: Vec2 = [farOuter[0] + perpInward[0] * thickness, farOuter[1] + perpInward[1] * thickness];
  const innerEnd = arcPoint(radius, angleRad);
  const innerMid = arcPoint(radius, angleRad / 2);
  const p0: Vec2 = [0, 0];

  return draw(pBottom)
    .threePointsArcTo(outerEnd, outerMid)
    .lineTo(farOuter)
    .lineTo(farInner)
    .lineTo(innerEnd)
    .threePointsArcTo(p0, innerMid)
    .close();
}

// Constrói (ou reconstrói) a aba de uma dobra a partir da aresta reta de
// origem guardada na feature, em DOIS sólidos ao mesmo tempo:
//
// - shadowSolid: SEMPRE a versão dobrada (arco+reto de bendCrossSection),
//   com coordenadas CRUAS da aresta (nunca desfeitas) — é nela que a face
//   de origem/direção "pra fora" são buscadas (computeEdgeFrame), porque
//   nunca sofre do problema de dobras-irmãs ficando coplanares e se
//   fundindo numa face só (ver comentário grande em rebuildModel).
//
// - activeSolid: o sólido EXIBIDO de verdade — se flatten=false, é
//   literalmente a mesma coisa que a sombra (mesma construção, sem
//   trabalho duplicado); se flatten=true, é um painel reto simples (sem
//   arco) na posição desfeita da cadeia de ancestrais (parentChain),
//   reaproveitando a face/direção já confirmadas contra a sombra.
//
// Devolve, junto dos dois sólidos, o "elo" desta dobra pronto pra entrar na
// cadeia de uma eventual Flange filha — sempre calculado com a aresta
// ORIGINAL, porque a cadeia representa a dobra real, não o modo de
// visualização atual.
export function buildFlangeSolid(
  feature: Extract<Feature, { type: "flange" }>,
  thickness: number,
  activeSolid: Solid,
  shadowSolid: Solid,
  flatten: boolean,
  parentChain: FlattenLink[]
): { solid: Solid; shadowSolid: Solid; link: FlattenLink } {
  const rawEdgeStart = feature.edgeStart;
  const rawEdgeEnd = feature.edgeEnd;
  const { length, angle } = feature;
  // Raio interno da dobra = espessura da chapa sempre — não é escolhido
  // por Flange, é a mesma regra da chapa inteira (raio externo = 2x).
  const radius = thickness;
  const allowance = bendAllowance(angle, radius, thickness);

  // Face de origem/direção "pra fora" SEMPRE contra a sombra (sempre
  // dobrada) com as coordenadas CRUAS da aresta — nunca precisa desfazer
  // nada aqui, porque a sombra nunca planifica.
  const { dRaw, n, outDir } = computeEdgeFrame(shadowSolid, rawEdgeStart, rawEdgeEnd);
  const yDirActual = cross(dRaw, outDir);
  const vSign0: 1 | -1 = dot(yDirActual, n) >= 0 ? 1 : -1;

  const edgeLength = Math.hypot(
    rawEdgeEnd[0] - rawEdgeStart[0],
    rawEdgeEnd[1] - rawEdgeStart[1],
    rawEdgeEnd[2] - rawEdgeStart[2]
  );
  if (edgeLength < 1e-6 || length < 1e-6) {
    throw new Error("Flange: comprimento da aba ou da aresta é zero — não dá pra construir o painel.");
  }

  // Sempre constrói a versão dobrada (arco+reto) dentro da sombra primeiro
  // — mesma checagem empírica de volume de sempre (confere se o lado
  // calculado realmente ADICIONOU material; se não, tenta o oposto), agora
  // rodando sobre a sombra em vez do sólido exibido, então continua válida
  // mesmo quando flatten=true.
  const crossPlane: SketchPlane = { origin: rawEdgeStart, normal: dRaw, xDir: outDir };
  const shadowVolumeBefore = measureVolume(shadowSolid);
  const expectedAdded = edgeLength * length * thickness;

  function buildBentInto(base: Solid, vs: 1 | -1): Solid {
    const crossSection = bendCrossSection(radius, thickness, angle, length, vs);
    let bent: Solid;
    try {
      bent = extrudeProfile(crossSection, edgeLength, crossPlane, "normal");
    } catch (err) {
      throw new Error(`Flange: falha ao construir a seção da dobra (${describeError(err)}).`);
    }
    try {
      const fused = base.fuse(bent) as unknown as Solid;
      bent.delete();
      return fused;
    } catch (err) {
      bent.delete();
      throw new Error(`Flange: falha ao unir a dobra com a chapa (${describeError(err)}).`);
    }
  }

  const firstShadowTry = buildBentInto(shadowSolid, vSign0);
  const firstGain = measureVolume(firstShadowTry) - shadowVolumeBefore;
  let vSign = vSign0;
  let newShadow: Solid;
  if (firstGain > expectedAdded * 0.2) {
    newShadow = firstShadowTry;
  } else {
    console.warn(
      `Flange: o lado calculado não adicionou material de verdade na sombra (ganho de volume ${firstGain.toFixed(1)}, esperado ~${expectedAdded.toFixed(1)}) — tentando o lado oposto.`
    );
    firstShadowTry.delete();
    vSign = vSign0 === 1 ? -1 : 1;
    newShadow = buildBentInto(shadowSolid, vSign);
  }
  shadowSolid.delete();

  const rawDRaw = norm(sub(rawEdgeEnd, rawEdgeStart));
  const link: FlattenLink = {
    axisPoint: rawEdgeStart,
    axisDir: rawDRaw,
    outDir,
    yDir: yDirActual,
    n,
    vSign,
    angleDeg: angle,
    radius,
    thickness,
    length,
    allowance,
  };

  if (!flatten) {
    // activeSolid É shadowSolid (mesma referência, já fundida acima) —
    // rebuildModel não mantém os dois separados fora do modo planificado.
    return { solid: newShadow, shadowSolid: newShadow, link };
  }

  // Planificado: painel reto simples (sem arco), na posição desfeita da
  // cadeia de ancestrais — reaproveita a face/direção (n, outDir, dRaw) já
  // confirmadas contra a sombra; só a POSIÇÃO/comprimento vêm da cadeia.
  const edgeStart = undoFlattenChain(parentChain, rawEdgeStart);
  const edgeEnd = undoFlattenChain(parentChain, rawEdgeEnd);
  const flatEdgeLength = Math.hypot(edgeEnd[0] - edgeStart[0], edgeEnd[1] - edgeStart[1], edgeEnd[2] - edgeStart[2]);
  const panelLength = length + allowance;

  if (flatEdgeLength < 1e-6) {
    throw new Error(
      "Flange: aresta planificada ficou degenerada (comprimento zero) — não dá pra construir o painel."
    );
  }

  // n/outDir/dRaw foram achados contra a sombra SEMPRE dobrada (com o
  // ângulo do(s) ancestral(is) ainda "vivo"), então pra deitar o painel no
  // plano da chapa desdobrada precisam ser desgirados pela mesma cadeia —
  // sem isso, um painel encadeado (nascido em cima de outra Flange já
  // dobrada) saía construído ainda inclinado pelo ângulo do pai, "de pé"
  // em vez de deitado (o bug relatado: dobras diretas da base planificam
  // certo, mas uma dobra em cima de outra dobra não planifica).
  const nFlat = norm(undoFlattenChainDir(parentChain, n));
  const dRawFlat = norm(undoFlattenChainDir(parentChain, dRaw));
  const outDirFlat = norm(undoFlattenChainDir(parentChain, outDir));

  // Sem arredondar: retângulo simples saindo da aresta, ao estilo Face —
  // xDir escolhido só pra colocar o retângulo do lado certo (fora do
  // corpo), extrudado pro lado do material (-n) igual à chapa base.
  const candidate = cross(nFlat, dRawFlat);
  const flipPlacement = dot(candidate, outDirFlat) > 0;
  const finalD = flipPlacement ? scale(dRawFlat, -1) : dRawFlat;
  const origin = flipPlacement ? edgeEnd : edgeStart;

  const panelPlane: SketchPlane = { origin, normal: negate(nFlat), xDir: finalD };
  const rectDrawing = drawRoundedRectangle(flatEdgeLength, panelLength, 0).translate(
    flatEdgeLength / 2,
    panelLength / 2
  );

  let panel: Solid;
  try {
    panel = extrudeProfile(rectDrawing, thickness, panelPlane, "normal");
  } catch (err) {
    throw new Error(`Flange: falha ao construir o painel planificado (${describeError(err)}).`);
  }

  try {
    const fused = activeSolid.fuse(panel) as unknown as Solid;
    activeSolid.delete();
    panel.delete();
    return { solid: fused, shadowSolid: newShadow, link };
  } catch (err) {
    panel.delete();
    throw new Error(`Flange: falha ao unir o painel planificado com a chapa (${describeError(err)}).`);
  }
}

// Exceções vindas do WASM/OpenCascade às vezes não são Error de verdade
// (podem ser só um número/ponteiro do embind) — isso extrai uma descrição
// legível de qualquer coisa que possa ter sido lançada.
function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return `valor bruto lançado: ${String(err)}`;
}
