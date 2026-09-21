import { activeFeatures } from "@/lib/features/suppression";
import { sheetIsUnfolded } from "@/lib/features/sheetState";
import { buildLoft, buildShell } from "./advancedFeatures";
import { deserializeShape, isShape3D, makeCompound, drawCircle, drawRoundedRectangle, genericSweep, makeHelix } from "replicad";
import type { Sketch, Solid } from "replicad";
import type { Feature, SketchFeature } from "@/lib/features/types";
import type { SketchPlane } from "@/lib/sketch/types";
import { extrudeProfile, pathToDrawing, profileReferencePoint, pointToLineDistance2D, profileToDrawing, profilesToDrawing } from "./geometry";
import { findEdgesByPoints, listLinearEdges } from "./edgeTools";
import { buildFlangeSolid, attachPointToFlange, undoFlattenChain, type FlattenLink } from "./sheetMetal";
import { applyPatternOffset, computePatternOffsets, isPatternable } from "./pattern";
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
  const drawing = profilesToDrawing(feature.profile);
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
  const drawing = profilesToDrawing(feature.profile);
  const depth = feature.cut ? feature.cutDepth ?? thickness : thickness;
  if (!Number.isFinite(depth) || depth <= 0) throw new Error("Recortar: informe uma distância positiva.");
  return drawing ? extrudeProfile(drawing, depth, feature.plane, feature.direction ?? "normal") : null;
}

// O eixo é a linha de centro desenhada no sketch (coordenadas locais do
// plano), convertida pra origem+direção de mundo — não um eixo X/Y fixo.
function buildRevolveSolid(
  feature: Extract<Feature, { type: "revolve" }>
): Solid | null {
  const drawing = profilesToDrawing(feature.profile);
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
  // extraHoles (Ctrl+clique em vários círculos, ver findSelectedCircles em
  // geometry.ts) — cada um vira mais um círculo unido no MESMO desenho, ao
  // estilo profilesToDrawing: um corte/extrusão só, com um cilindro por
  // furo, em vez de reconstruir o sólido furo a furo.
  let drawing = drawCircle(feature.radius).translate(feature.center.x, feature.center.y);
  for (const extra of feature.extraHoles ?? []) {
    drawing = drawing.fuse(drawCircle(extra.radius).translate(extra.center.x, extra.center.y));
  }

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
  try {
    if (!matched.length) throw new Error('Selecione pelo menos uma aresta.');
    if (!Number.isFinite(feature.radius) || feature.radius <= 0) throw new Error('Informe um raio positivo.');
    try { return activeSolid.fillet(feature.radius, f => f.inList(matched)) as Solid; }
    catch { throw new Error(`Não foi possível arredondar as ${matched.length} arestas com raio ${feature.radius} mm. Reduza o raio ou revise as arestas selecionadas; a combinação pode gerar interseções ou não ter espaço para a concordância.`); }
  } finally { matched.forEach(edge => edge.delete()); }
}

function buildChamferSolid(
  feature: Extract<Feature, { type: "chamfer" }>,
  activeSolid: Solid
): Solid | null {
  const matched = findEdgesByPoints(activeSolid, feature.edgePoints);
  try {
    if (!matched.length) throw new Error('Selecione pelo menos uma aresta.');
    try { return activeSolid.chamfer(feature.distance, f => f.inList(matched)) as Solid; }
    catch { throw new Error('Não foi possível criar o chanfro. Reduza a distância ou revise as arestas selecionadas.'); }
  } finally { matched.forEach(edge => edge.delete()); }
}

// Varredura: perfil do plano da PRÓPRIA feature (não do sketch ativo — já
// congelado nela igual Extrudar/Revolução), caminho vindo de outro
// SketchFeature já salvo na árvore (pathFeatureId). forceProfileSpineOthogonality
// reposiciona/reorienta o perfil no início do caminho automaticamente — não
// exige que o usuário tenha desenhado os 2 sketches perfeitamente alinhados.
function buildSweepSolid(feature: Extract<Feature, { type: "sweep" }>, features: Feature[]): Solid | null {
  const pathFeature = features.find(
    (f): f is SketchFeature => f.id === feature.pathFeatureId && f.type === "sketch"
  );
  if (!pathFeature) return null;

  const profileDrawing = profilesToDrawing(feature.profile);
  const pathDrawing = pathToDrawing(pathFeature.shapes, pathFeature.points);
  if (!profileDrawing || !pathDrawing) return null;

  // sketchOnPlane devolve SketchInterface|Sketches no tipo (cobre desenhos
  // com múltiplos contornos) — profileToDrawing/pathToDrawing nunca geram
  // isso (sempre 1 contorno só), então na prática é sempre um Sketch de
  // verdade, com .wire.
  const profileSketch = profileDrawing.sketchOnPlane(toReplicadPlane(feature.plane)) as Sketch;
  const pathSketch = pathDrawing.sketchOnPlane(toReplicadPlane(pathFeature.plane)) as Sketch;

  return genericSweep(profileSketch.wire, pathSketch.wire, {
    forceProfileSpineOthogonality: true,
  }) as unknown as Solid;
}

// Espiral/Mola: mesmo eixo (linha de centro) da Revolução, mas em vez de
// girar o perfil no lugar, varre ele ao longo de uma hélice computada
// (makeHelix) — raio da hélice = distância do perfil até o eixo (nunca
// escolhido à parte, igual Revolução não pede raio).
function buildHelixSolid(feature: Extract<Feature, { type: "helix" }>): Solid | null {
  const drawing = profilesToDrawing(feature.profile);
  if (!drawing) return null;

  // Raio da hélice usa a referência do 1º perfil só — com vários perfis
  // unidos (Ctrl+clique), o raio de varredura continua sendo definido pelo
  // perfil "principal" (o primeiro marcado), não uma média entre todos.
  const firstProfile = Array.isArray(feature.profile) ? feature.profile[0] : feature.profile;
  const refPoint = profileReferencePoint(firstProfile);
  if (!refPoint) return null;
  const radius = pointToLineDistance2D(refPoint, feature.axisOrigin, feature.axisDirection);
  if (radius < 1e-6) return null; // perfil em cima do eixo — sem raio, sem hélice

  const sketch = drawing.sketchOnPlane(toReplicadPlane(feature.plane)) as Sketch;
  const worldOrigin = localToWorldPoint(feature.plane, feature.axisOrigin);
  const worldDirection = localToWorldDirection(feature.plane, feature.axisDirection);
  const axis = feature.reversed ? negate(worldDirection) : worldDirection;
  const height = Math.max(feature.pitch * feature.turns, 0.01);

  const helixWire = makeHelix(feature.pitch, height, radius, worldOrigin, axis);
  return genericSweep(sketch.wire, helixWire, { forceProfileSpineOthogonality: true }) as unknown as Solid;
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
export function rebuildModel(features: Feature[], options: { flatten?: boolean; onFlange?: (feature: Extract<Feature, { type: "flange" }>, link: FlattenLink, parent?: FlattenLink) => void } = {}): Solid | null {
  features = activeFeatures(features);
  const unfolded = sheetIsUnfolded(features);
  const flatten = !!options.flatten || unfolded;
  // Reconstructed bodies retain editable native operations, but their cuts only
  // operate on their own body. Existing ungrouped project semantics stay intact.
  if (features.some(feature => feature.bodyGroupId)) {
    const prepared: Feature[] = [];
    const seen = new Set<string>();
    for (let index = 0; index < features.length;) {
      const feature = features[index];
      if (!feature.bodyGroupId) { prepared.push(feature); index++; continue; }
      const group = feature.bodyGroupId;
      if (seen.has(group)) throw new Error("Operações de um corpo reconstruído devem permanecer consecutivas na árvore.");
      seen.add(group);
      const members: Feature[] = [];
      while (index < features.length && features[index].bodyGroupId === group) {
        const { bodyGroupId: _group, ...member } = features[index++];
        void _group;
        members.push(member as Feature);
      }
      const body = rebuildModel(members, options);
      if (!body) continue;
      try { prepared.push({ id: group, type: "imported", label: feature.label, format: "step", preserveBody: true, brep: body.serialize() }); }
      finally { body.delete(); }
    }
    return rebuildModel(prepared, options);
  }
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

  // Edge references are stored in the folded model. Only points on a
  // flange's straight panel can carry constant-radius edge treatments to flat.
  function flatEdgeReferences(points: [number, number, number][]): [number, number, number][] {
    const candidates = [...chains.values()].filter(chain => chain.length)
      .sort((a, b) => b.length - a.length);
    return points.map(point => {
      for (const chain of candidates) {
        try { attachPointToFlange(chain[chain.length - 1], point); }
        catch { continue; }
        return undoFlattenChain(chain, point);
      }
      return point; // Base panel references do not move.
    });
  }

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

  let buildingFeature: Feature | undefined;
  try {
  for (const feature of features) {
    buildingFeature = feature;
    if(feature.type==="imported"){
      const body=deserializeShape(feature.brep);
      if(!isShape3D(body)){body.delete();throw new Error("Corpo importado inválido.");}
      if (feature.preserveBody && active) {
        try {
          const combined = makeCompound([active.clone(), body.clone()]) as Solid;
          active.delete(); active = combined;
          if (shadow) {
            const combinedShadow = makeCompound([shadow.clone(), body.clone()]) as Solid;
            shadow.delete(); shadow = combinedShadow;
          }
        } finally { body.delete(); }
        continue;
      }
      mergeInto(body as Solid,false);continue;
    }
    if (feature.type === "loft") {
      mergeInto(buildLoft(feature, features.slice(0, features.indexOf(feature))), !!feature.cut);
      continue;
    }
    if (feature.type === "shell") {
      if (!active) throw new Error("Casca requer um sólido anterior.");
      const next = buildShell(active, feature);
      active.delete(); active = next;
      if (shadow) { const nextShadow = buildShell(shadow, feature); shadow.delete(); shadow = nextShadow; }
      continue;
    }
    if (feature.type === "unfold" || feature.type === "refold") continue;
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
      options.onFlange?.(feature, link, parentChain.at(-1));
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
      const result = buildFilletSolid(flatten ? { ...feature, edgePoints: flatEdgeReferences(feature.edgePoints) } : feature, active);
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
      const result = buildChamferSolid(flatten ? { ...feature, edgePoints: flatEdgeReferences(feature.edgePoints) } : feature, active);
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

    if (feature.type === "sweep") {
      const built = buildSweepSolid(feature, features);
      if (!built) continue;
      mergeInto(built, !!feature.cut);
      continue;
    }

    if (feature.type === "helix") {
      const built = buildHelixSolid(feature);
      if (!built) continue;
      mergeInto(built, !!feature.cut);
      continue;
    }

    if (feature.type === "pattern") {
      if (!active) continue; // nada pra padronizar ainda
      const source = features.find((f) => f.id === feature.sourceFeatureId);
      if (!source || !isPatternable(source)) continue;
      for (const offset of computePatternOffsets(feature)) {
        const copy = applyPatternOffset(source, offset);
        const built =
          copy.type === "hole"
            ? active && buildHoleTool(copy, active)
            : copy.type === "face"
              ? buildFaceSolid(copy, sheetThickness)
              : copy.type === "extrude"
                ? buildExtrudeSolid(copy)
                : buildRevolveSolid(copy);
        if (!built) continue;
        mergeInto(built, copy.type === "hole" ? true : !!copy.cut);
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

  } catch (error) {
    // Some failed boolean operations have already released their input wrappers.
    try { active?.delete(); } catch { /* Preserve the original geometry error. */ }
    try { shadow?.delete(); } catch { /* Preserve the original geometry error. */ }
    const detail = error instanceof Error ? error.message : `Falha do kernel geométrico (código ${String(error)}).`;
    throw new Error(`${flatten ? 'Planificação' : 'Reconstrução'}: operação "${buildingFeature?.label ?? buildingFeature?.type ?? 'desconhecida'}" (${buildingFeature?.id ?? '?'}): ${detail}`);
  }
  shadow?.delete();
  return active;
}

const PARENT_EDGE_TOLERANCE = 1e-4;

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
/** Boolean operations can split an original edge without changing its owner. */
function segmentContains(start: number[], end: number[], point: number[]): boolean {
  const axis = end.map((v, i) => v - start[i]);
  const length = Math.hypot(...axis);
  if (length < 1e-7) return false;
  const relative = point.map((v, i) => v - start[i]);
  const along = relative.reduce((sum, v, i) => sum + v * axis[i] / length, 0);
  const distance = Math.hypot(...relative.map((v, i) => v - along * axis[i] / length));
  return distance < 1e-4 && along >= -1e-4 && along <= length + 1e-4;
}

export function findFlangeParentId(
  features: Feature[],
  edgeStart: [number, number, number],
  edgeEnd: [number, number, number]
): string | null {
  // Match the same geometry the picker displays. A hidden imported body can
  // otherwise swallow the native Face's edges in a union.
  features = activeFeatures(features.map(f => f.type === 'imported' && f.visible === false
    ? { ...f, suppressed: true } : f));
  const matches = (solid: Solid) => listLinearEdges(solid).some(e =>
    (samePoint(e.start, edgeStart) && samePoint(e.end, edgeEnd)) ||
    (samePoint(e.start, edgeEnd) && samePoint(e.end, edgeStart)) ||
    (segmentContains(e.start, e.end, edgeStart) && segmentContains(e.start, e.end, edgeEnd)));
  let thickness = 1;
  for (let i = 0; i < features.length; i++) {
    const feature = features[i];
    if (feature.type === 'sheetMetal') { thickness = feature.thickness; continue; }
    if (feature.type !== 'face' && feature.type !== 'flange') continue;
    // Preserve the Face's own edges before fusion with other bodies changes
    // their segmentation or removes them from the cumulative result.
    if (feature.type === 'face' && !feature.cut) {
      const source = buildFaceSolid(feature, thickness);
      if (source) {
        try { if (matches(source)) return feature.id; }
        finally { source.delete(); }
      }
    }
    const partial = rebuildModel(features.slice(0, i + 1));
    if (!partial) continue;
    try { if (matches(partial)) return feature.id; }
    finally { partial.delete(); }
  }

  return null;
}

/** Upgrade legacy fixed endpoints before editing ancestors; never mutate the input. */
export function attachFlangeReferences(features: Feature[]): Feature[] {
  if (!features.some(f => f.type === 'flange' && !f.attachment
    && features.some(p => p.id === f.parentId && p.type === 'flange'))) return features;
  const attachments = new Map<string, NonNullable<Extract<Feature, { type: 'flange' }>['attachment']>>();
  const solid = rebuildModel(features, { onFlange(feature, _link, parent) {
    if (!feature.attachment && parent) {
      attachments.set(feature.id, { start: attachPointToFlange(parent, feature.edgeStart),
        end: attachPointToFlange(parent, feature.edgeEnd) });
    }
  } });
  solid?.delete();
  return features.map(f => f.type === 'flange' && attachments.has(f.id)
    ? { ...f, attachment: attachments.get(f.id)! } : f);
}

export function editFlangeWithDependents(features: Feature[], replacement: Extract<Feature, { type: 'flange' }>): Feature[] {
  const attached = attachFlangeReferences(features);
  const descendants = new Set([replacement.id]);
  for (const feature of attached) {
    if (feature.type === 'flange' && descendants.has(feature.parentId)) {
      if (!feature.attachment) throw new Error('Reative os flanges dependentes antigos antes de editar o pai, para recuperar seus vínculos.');
      descendants.add(feature.id);
    }
  }
  const updated = attached.map(f => f.id === replacement.id && f.type === 'flange'
    ? { ...replacement, attachment: f.attachment } : f);
  const resolved = new Map<string, FlattenLink>();
  const solid = rebuildModel(updated, { onFlange: (feature, link) => { resolved.set(feature.id, link); } });
  try { solid?.mesh(); } finally { solid?.delete(); }
  // Keep legacy endpoints current too, for edit markers and older file consumers.
  return updated.map(feature => {
    const link = resolved.get(feature.id);
    if (feature.type !== 'flange' || !link) return feature;
    const edgeEnd = link.axisPoint.map((v, i) => v + link.axisDir[i] * link.edgeLength) as [number, number, number];
    return { ...feature, edgeStart: link.axisPoint, edgeEnd };
  });
}
