import { drawCircle, drawRoundedRectangle } from "replicad";
import type { Solid } from "replicad";
import type { Feature } from "@/lib/features/types";
import type { SketchPlane } from "@/lib/sketch/types";
import { extrudeProfile, profileToDrawing } from "./geometry";
import { findEdgesByPoints, listLinearEdges } from "./edgeTools";
import { buildFlangeSolid, type FlattenLink } from "./sheetMetal";
import {
  localToWorldDirection,
  localToWorldPoint,
  negate,
  offsetOrigin,
  toReplicadPlane,
} from "./plane";

function buildExtrudeSolid(
  feature: Extract<Feature, { type: "extrude" }>
): Solid | null {
  const drawing = profileToDrawing(feature.profile);
  return drawing ? extrudeProfile(drawing, feature.depth, feature.plane, feature.direction ?? "normal") : null;
}

// "Face" (Inventor) é um extrude igual, mas a profundidade nunca é da
// própria feature — é sempre a espessura da chapa ativa no momento (lida
// da SheetMetalFeature mais recente da árvore), pra toda a peça ficar com
// espessura consistente.
function buildFaceSolid(
  feature: Extract<Feature, { type: "face" }>,
  thickness: number
): Solid | null {
  const drawing = profileToDrawing(feature.profile);
  return drawing ? extrudeProfile(drawing, thickness, feature.plane, feature.direction ?? "normal") : null;
}

// O eixo é a linha de centro desenhada no sketch (coordenadas locais do
// plano), convertida pra origem+direção de mundo — não um eixo X/Y fixo.
function buildRevolveSolid(
  feature: Extract<Feature, { type: "revolve" }>
): Solid | null {
  const drawing = profileToDrawing(feature.profile);
  if (!drawing) return null;

  const sketch = drawing.sketchOnPlane(toReplicadPlane(feature.plane));
  const worldOrigin = localToWorldPoint(feature.plane, feature.axisOrigin);
  const worldDirection = localToWorldDirection(feature.plane, feature.axisDirection);
  const axis = feature.reversed ? negate(worldDirection) : worldDirection;
  return sketch.revolve(axis, {
    origin: worldOrigin,
    angle: feature.angle,
  }) as unknown as Solid;
}

// A ferramenta de furo é sempre um cilindro alinhado com a normal do plano
// em que foi esboçado (não necessariamente o eixo Z do mundo, já que o
// esboço pode estar em qualquer face). "Passante" usa a diagonal da
// bounding box do sólido ativo como span — maior que a extensão do sólido
// em qualquer direção, então sempre atravessa de ponta a ponta. "Cego"
// entra pela normal (pra dentro do material) pela profundidade informada.
function buildHoleTool(
  feature: Extract<Feature, { type: "hole" }>,
  activeSolid: Solid
): Solid {
  const box = activeSolid.boundingBox;
  const diagonal = Math.hypot(box.width, box.height, box.depth) || 1;
  const drawing = drawCircle(feature.radius).translate(
    feature.center.x,
    feature.center.y
  );

  if (feature.through) {
    const span = diagonal * 3;
    const backPlane: SketchPlane = {
      origin: offsetOrigin(feature.plane, -span / 2),
      normal: feature.plane.normal,
      xDir: feature.plane.xDir,
    };
    const sketch = drawing.sketchOnPlane(toReplicadPlane(backPlane));
    return sketch.extrude(span) as unknown as Solid;
  }

  const sketch = drawing.sketchOnPlane(toReplicadPlane(feature.plane));
  const direction = feature.direction ?? "flipped"; // "flipped" = comportamento que a ferramenta sempre teve
  return sketch.extrude(feature.depth, {
    extrusionDirection: direction === "flipped" ? negate(feature.plane.normal) : feature.plane.normal,
  }) as unknown as Solid;
}

// Ferramenta de corte: um "meio-espaço" — quadrado bem maior que o sólido,
// extrudado a partir do plano selecionado em direção ao lado descartado.
// "positive" mantém o lado pra onde a normal aponta, então o corte vai na
// direção oposta (e vice-versa).
function buildSplitTool(
  feature: Extract<Feature, { type: "split" }>,
  activeSolid: Solid
): Solid {
  const box = activeSolid.boundingBox;
  const diagonal = Math.hypot(box.width, box.height, box.depth) || 1;
  const size = diagonal * 3;

  const drawing = drawRoundedRectangle(size, size, 0);
  const sketch = drawing.sketchOnPlane(toReplicadPlane(feature.plane));
  const direction =
    feature.keepSide === "positive"
      ? negate(feature.plane.normal)
      : feature.plane.normal;

  return sketch.extrude(size, { extrusionDirection: direction }) as unknown as Solid;
}

// Fillet/chamfer não guardam a Edge em si na feature (não sobrevive a uma
// reconstrução do zero) — cada edgePoint é reencontrado geometricamente no
// sólido ativo (ver findEdgesByPoints) e alimentado direto no
// EdgeFinder.inList() do replicad. Se nenhuma bater (perfil mudou demais
// desde que a feature foi criada), não faz nada em vez de travar a
// reconstrução inteira.
function buildFilletSolid(
  feature: Extract<Feature, { type: "fillet" }>,
  activeSolid: Solid
): Solid | null {
  const matched = findEdgesByPoints(activeSolid, feature.edgePoints);
  if (matched.length === 0) return null;
  return activeSolid.fillet(feature.radius, (f) => f.inList(matched)) as unknown as Solid;
}

function buildChamferSolid(
  feature: Extract<Feature, { type: "chamfer" }>,
  activeSolid: Solid
): Solid | null {
  const matched = findEdgesByPoints(activeSolid, feature.edgePoints);
  if (matched.length === 0) return null;
  return activeSolid.chamfer(feature.distance, (f) => f.inList(matched)) as unknown as Solid;
}

// Reaplica a lista de features do zero e devolve o sólido final (ou null se
// vazia/inválida). Reconstruir tudo a cada mudança é mais simples e mais
// seguro do que tentar atualizar incrementalmente — o custo é aceitável
// para o número de operações de um MVP.
//
// flatten=true reconstrói toda dobra (Flange) sem girar/arredondar, com o
// comprimento já somando o desenvolvimento da dobra — dá o padrão
// planificado da chapa (ver buildFlangeSolid). Dobra-sobre-dobra planifica
// corretamente tanto numa aresta LONGE do pai (paralela à dobra, no fim da
// aba) quanto numa aresta LATERAL (que atravessa o arco da dobra) — a
// cadeia de FlattenLink desfaz a dobra de cada ancestral ponto a ponto
// (arco vs. trecho reto, ver undoLink em sheetMetal.ts), não só como uma
// rotação rígida. Isso é exato pra até 2 níveis (Face→Flange→Flange); numa
// cadeia de 3+ níveis a direção/face de origem de cada elo intermediário é
// calculada já com o ancestral anterior "achatado" durante o mesmo rebuild,
// o que pode introduzir um pequeno desvio — não chega a ser comum num
// projeto de chapa típico, mas é uma limitação conhecida, não resolvida.
//
// "shadow" — sólido paralelo ao exibido (active), SEMPRE dobrado, nunca
// planificado. Existe só pra cada Flange achar sua própria face de
// origem/direção "pra fora" de forma confiável (ver computeEdgeFrame em
// sheetMetal.ts): quando o modo é planificado, dobras-IRMÃS (do mesmo pai —
// o caso mais comum, várias abas saindo direto da mesma chapa base) ficam
// coplanares umas com as outras depois de fundidas, e o OpenCascade funde
// essas faces coplanares numa só, maior — o centroide dessa face fundida já
// não corresponde à face original, e a direção "pra fora" calculada pra
// dobra seguinte sai errada (painéis nascendo longe/rotacionados,
// desconectados da peça). Como dobras nunca ficam coplanares com o pai no
// modo dobrado normal, uma sombra sempre dobrada nunca sofre desse
// problema — cada Flange usa a sombra só pra achar face/direção, e usa a
// cadeia de FlattenLink (desfazer a dobra) só pra decidir a POSIÇÃO do
// painel planificado. Cada feature que gera geometria replica a mesma
// operação (fuse/corte/fillet/chamfro) em active E em shadow, exceto Flange
// — que faz a versão arredondada na sombra e a versão reta (ou arredondada,
// se flatten=false) no sólido exibido.
export function rebuildModel(features: Feature[], options: { flatten?: boolean } = {}): Solid | null {
  const { flatten = false } = options;
  let active: Solid | null = null;
  let shadow: Solid | null = null;
  // Espessura da chapa ativa — "Sheet Metal Rule" única compartilhada por
  // toda Face/Flange que vier depois dela na árvore.
  let sheetThickness = 1;
  // Cadeia de dobras "reais" (3D, nunca planificadas) de cada Face/Flange,
  // indexada pelo id da feature — uma Flange nova busca a cadeia do seu
  // parentId pra saber quantas dobras de ancestrais precisa desfazer na
  // hora de planificar (ver FlattenLink em sheetMetal.ts). Face sempre tem
  // cadeia vazia (nunca dobra).
  const chains = new Map<string, FlattenLink[]>();

  // Aplica a MESMA peça de geometria (fuse ou corte) em active e, se
  // existir, em shadow — usado por toda feature que não seja Flange (que
  // tem tratamento próprio, com geometria DIFERENTE em cada um).
  function mergeInto(built: Solid, cut: boolean) {
    if (!active) {
      if (cut) {
        built.delete(); // corte sem sólido pra cortar: no-op
        return;
      }
      active = built;
      shadow = flatten ? (built.clone() as unknown as Solid) : null;
      return;
    }

    const result = cut ? (active.cut(built) as unknown as Solid) : (active.fuse(built) as unknown as Solid);
    active.delete();
    active = result;

    if (flatten && shadow) {
      const shadowResult = cut ? (shadow.cut(built) as unknown as Solid) : (shadow.fuse(built) as unknown as Solid);
      shadow.delete();
      shadow = shadowResult;
    }

    built.delete();
  }

  for (const feature of features) {
    if (feature.type === "sheetMetal") {
      sheetThickness = feature.thickness;
      continue;
    }

    // "sketch"/"plane"/"axis" são só registro na árvore, não geram geometria
    if (feature.type === "sketch" || feature.type === "plane" || feature.type === "axis") continue;

    if (feature.type === "face") {
      chains.set(feature.id, []);
      const built = buildFaceSolid(feature, sheetThickness);
      if (!built) continue;
      mergeInto(built, !!feature.cut);
      continue;
    }

    if (feature.type === "flange") {
      if (!active) continue; // precisa de uma Face antes pra ter aresta pra dobrar
      // Fora do modo planificado, shadow não é mantido separado (fica null
      // — ver mergeInto): a própria sombra dobrada É o sólido exibido,
      // então passa "active" pros dois parâmetros; buildFlangeSolid nunca
      // lê activeSolid nesse caso (só usa a versão dobrada, já fundida na
      // sombra), então não há leitura de um sólido já deletado.
      const parentChain = chains.get(feature.parentId) ?? [];
      const { solid, shadowSolid, link } = buildFlangeSolid(
        feature,
        sheetThickness,
        active,
        shadow ?? active,
        flatten,
        parentChain
      );
      chains.set(feature.id, [...parentChain, link]);
      active = solid;
      shadow = flatten ? shadowSolid : null;
      continue;
    }

    if (feature.type === "hole") {
      if (!active) continue; // nada pra furar ainda
      mergeInto(buildHoleTool(feature, active), true);
      continue;
    }

    if (feature.type === "split") {
      if (!active) continue; // nada pra cortar ainda
      mergeInto(buildSplitTool(feature, active), true);
      continue;
    }

    if (feature.type === "fillet") {
      if (!active) continue; // nada pra arredondar ainda
      const result = buildFilletSolid(feature, active);
      if (result) {
        active.delete();
        active = result;
      }
      if (flatten && shadow) {
        const shadowResult = buildFilletSolid(feature, shadow);
        if (shadowResult) {
          shadow.delete();
          shadow = shadowResult;
        }
      }
      continue;
    }

    if (feature.type === "chamfer") {
      if (!active) continue; // nada pra chanfrar ainda
      const result = buildChamferSolid(feature, active);
      if (result) {
        active.delete();
        active = result;
      }
      if (flatten && shadow) {
        const shadowResult = buildChamferSolid(feature, shadow);
        if (shadowResult) {
          shadow.delete();
          shadow = shadowResult;
        }
      }
      continue;
    }

    const built =
      feature.type === "extrude"
        ? buildExtrudeSolid(feature)
        : buildRevolveSolid(feature);

    if (!built) continue;
    mergeInto(built, !!feature.cut);
  }

  shadow?.delete();
  return active;
}

const PARENT_EDGE_TOLERANCE = 0.75;

function samePoint(a: [number, number, number], b: [number, number, number]): boolean {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < PARENT_EDGE_TOLERANCE;
}

// Acha o verdadeiro "pai" (Face ou Flange) de uma aresta recém-clicada pra
// uma nova Flange. Assumir que o pai é sempre "a última Face/Flange da
// árvore inteira" (o que este arquivo fazia antes, direto em
// ModeladorWorkspace.tsx) só funciona enquanto a peça é uma cadeia linear
// (cada Flange sempre em cima da anterior) — quebra assim que a peça
// ramifica: duas Flanges IRMÃS nascidas direto da mesma chapa base (a
// segunda ficava com pai = a primeira, em vez da base) ou uma Flange
// encadeada criada DEPOIS de uma irmã (podia ficar com pai = a irmã errada).
// Em vez de adivinhar pela ordem de criação, reconstrói a árvore
// PROGRESSIVAMENTE (da feature mais antiga pra mais nova) e devolve a
// PRIMEIRA Face/Flange cujo sólido parcial já contém essa aresta exata —
// ou seja, a feature que genuinamente originou essa aresta. Roda só uma vez
// por Flange criada (não a cada frame), então o custo de reconstruir várias
// vezes é aceitável.
export function findFlangeParentId(
  features: Feature[],
  edgeStart: [number, number, number],
  edgeEnd: [number, number, number]
): string | null {
  for (let i = 0; i < features.length; i++) {
    const feature = features[i];
    if (feature.type !== "face" && feature.type !== "flange") continue;

    const partial = rebuildModel(features.slice(0, i + 1));
    if (!partial) continue;
    const edges = listLinearEdges(partial);
    partial.delete();

    const found = edges.some(
      (e) =>
        (samePoint(e.start, edgeStart) && samePoint(e.end, edgeEnd)) ||
        (samePoint(e.start, edgeEnd) && samePoint(e.end, edgeStart))
    );
    if (found) return feature.id;
  }

  return null;
}
