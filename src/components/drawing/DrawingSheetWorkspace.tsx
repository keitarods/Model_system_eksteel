"use client";

import { useMemo, useRef, useState } from "react";
import { useFeatureStore } from "@/lib/features/store";
import { useDrawingStore, createSheetObject, type AnnotationPatch } from "@/lib/drawing/store";
import { loadOpenCascade } from "@/lib/replicad/opencascade";
import { rebuildModel } from "@/lib/replicad/build-model";
import { buildDrawingView, buildSectionView, suggestScale, scaleToLabel } from "@/lib/replicad/technicalDrawing";
import { createId, distance } from "@/lib/sketch/render";
import { projectOntoSegment } from "@/lib/sketch/hitTest";
import {
  VIEW_ORIENTATION_LABELS,
  sheetDimensionsMm,
  DEFAULT_TOLERANCE_ROWS,
  type AnnotationKind,
  type DrawingAnnotation,
  type DrawingSheet,
  type DrawingView,
  type SheetSize,
  type SheetTemplate,
  type TitleBlockInfo,
  type ToleranceRow,
  type ViewOrientation,
} from "@/lib/drawing/types";
import { serializeSheetTemplate, parseSheetTemplate, SHEET_TEMPLATE_EXTENSION } from "@/lib/drawing/templateFormat";
import {
  isFileSystemAccessSupported,
  pickFileToOpen,
  pickSaveFileHandle,
  saveOrDownload,
  writeToFileHandle,
} from "@/lib/project/folder";

// Folha de desenho técnico 2D gerada a partir da peça 3D atual — mesmo
// espírito do ambiente de Desenho do Inventor (vistas projetadas + cotas +
// bloco de título), mas dentro do mesmo projeto (ver nativeFormat.ts) em
// vez de um arquivo .idw separado vinculado ao .ipt.
//
// Cota é ao estilo Inventor: clicar perto de uma aresta reta cota o
// comprimento dela na hora (se o clique seguinte cair fora de qualquer
// aresta, ou na MESMA aresta de novo); clicar 2 arestas retas diferentes
// (mesma vista ou vistas diferentes) cota a distância entre as duas em vez
// disso (projeção do meio de uma na reta infinita da outra — exata quando
// paralelas). Só arestas RETAS entram nesse hit-test (ver
// DrawingView.lineEdges em types.ts) — curvas (arco/elipse/spline) do HLR
// ficam de fora por ora, sem hit-test preciso nelas ainda. A cota
// resultante é sempre um snapshot (x1,y1,x2,y2 em espaço da folha, não
// paramétrico de volta pro sólido nem pra vista — se a vista for
// arrastada/reescalada depois, a cota já colocada NÃO acompanha).
//
// "Jogar a peça pra folha" virou o botão "Adicionar Vista": escolhe
// orientação (+ planificada/dobrada se a peça tiver chapa) e ela entra
// centralizada na folha, arrastável depois — não é um drag-and-drop literal
// a partir de um navegador de peças (esse app só modela uma peça de cada
// vez, não tem um "arquivo fonte" separado da folha pra arrastar de dentro
// de).

const SHEET_MARGIN_MM = 8;
// Ao estilo do modelo padrão da Eksteel: o bloco de título fica encostado
// no canto INFERIOR DIREITO da folha (não a largura inteira) — o resto da
// folha (incluindo todo o canto inferior esquerdo) fica livre pra vistas.
// TITLE_BLOCK_WIDTH_RATIO é a fração da largura ÚTIL da folha (já descontada
// a margem) que o bloco ocupa; ver TitleBlockSvg pra como tolerâncias/logo/
// campos/revisão se dividem dentro dessa largura. Altura BAIXA de propósito
// — quanto menos altura o bloco ocupa, mais sobra de folha livre pra
// desenho acima dele.
const TITLE_BLOCK_HEIGHT_MM = 34;
const TITLE_BLOCK_WIDTH_RATIO = 0.7;
const LINE_HIT_TOLERANCE_MM = 3;
const DIM_OFFSET_MM = 8;
// Mesma lista de escalas "redondas" que suggestScale já usa internamente
// (ver COMMON_SCALES em technicalDrawing.ts) — repetida aqui porque aquele
// array é privado do módulo, e o seletor "Escala da Folha" precisa das
// mesmas opções pra bater com o que scaleToLabel sabe formatar.
const SHEET_SCALE_OPTIONS = [1 / 20, 1 / 10, 1 / 5, 1 / 2, 1, 2, 5, 10];

type Point = { x: number; y: number };
type LineHit = { viewId: string; a: Point; b: Point };

// Arrastar vista, cota e anotação são gestos diferentes (livre em x/y vs.
// restrito à normal do segmento medido vs. translada 1 ou 2 pontos juntos)
// — um único ref discriminado por `kind` evita duplicar toda a mecânica de
// pointerdown/move/up só pra trocar o que exatamente está sendo movido.
type DragState =
  | { kind: "view"; viewId: string; startClientX: number; startClientY: number; origX: number; origY: number }
  | { kind: "dimension"; dimensionId: string; nx: number; ny: number; startClientX: number; startClientY: number; startOffset: number }
  | { kind: "annotation"; annotationId: string; startClientX: number; startClientY: number; orig: AnnotationPatch };

function useActiveSheet(): { sheet: DrawingSheet | null; sheets: DrawingSheet[] } {
  const sheets = useDrawingStore((s) => s.sheets);
  const activeSheetId = useDrawingStore((s) => s.activeSheetId);
  const sheet = sheets.find((s) => s.id === activeSheetId) ?? sheets[0] ?? null;
  return { sheet, sheets };
}

// Vista "dona" da anotação (pra limpeza automática se a vista for
// removida) — mesma bounding box usada pra renderizar/arrastar a vista
// (view.x/y = centro, box.width/height*scale = tamanho na folha).
function findContainingView(sheet: DrawingSheet, point: Point): DrawingView | null {
  return (
    sheet.views.find((v) => {
      const halfW = (v.box.width * v.scale) / 2;
      const halfH = (v.box.height * v.scale) / 2;
      return Math.abs(point.x - v.x) <= halfW + 2 && Math.abs(point.y - v.y) <= halfH + 2;
    }) ?? null
  );
}

function toSheetPoint(svg: SVGSVGElement, clientX: number, clientY: number): Point {
  const ctm = svg.getScreenCTM();
  if (!ctm) return { x: 0, y: 0 };
  const pt = svg.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const transformed = pt.matrixTransform(ctm.inverse());
  return { x: transformed.x, y: transformed.y };
}

// view.lineEdges mora em coordenadas LOCAIS da vista (escala 1:1, antes de
// aplicar x/y/scale) — mesma convenção de view.box/visiblePaths. Converte
// pro espaço da folha aplicando a MESMA transformação usada pra desenhar
// (ver DrawingViewGroup): centraliza em view.box, escala, desloca pro
// (view.x, view.y) escolhido.
function viewLocalToSheet(view: DrawingView, local: Point): Point {
  const cx = view.box.minX + view.box.width / 2;
  const cy = view.box.minY + view.box.height / 2;
  return {
    x: view.x + (local.x - cx) * view.scale,
    y: view.y + (local.y - cy) * view.scale,
  };
}

// Inverso de viewLocalToSheet — usado só pra converter os 2 cliques da
// linha de corte (em espaço da folha) pro espaço LOCAL da vista-base, que é
// o que buildSectionView/sectionInfo.cutLine guardam (invariante a mover a
// vista-base depois, igual lineEdges/box).
function sheetToViewLocal(view: DrawingView, point: Point): Point {
  const cx = view.box.minX + view.box.width / 2;
  const cy = view.box.minY + view.box.height / 2;
  return {
    x: cx + (point.x - view.x) / view.scale,
    y: cy + (point.y - view.y) / view.scale,
  };
}

function findNearestLine(sheet: DrawingSheet, point: Point, tolerance: number): LineHit | null {
  let best: LineHit | null = null;
  let bestDist = tolerance;
  for (const view of sheet.views) {
    for (const edge of view.lineEdges) {
      const a = viewLocalToSheet(view, { x: edge.x1, y: edge.y1 });
      const b = viewLocalToSheet(view, { x: edge.x2, y: edge.y2 });
      const { distance: d } = projectOntoSegment(point, a, b);
      if (d < bestDist) {
        bestDist = d;
        best = { viewId: view.id, a, b };
      }
    }
  }
  return best;
}

function sameLine(a: LineHit, b: LineHit): boolean {
  const eps = 1e-6;
  return Math.abs(a.a.x - b.a.x) < eps && Math.abs(a.a.y - b.a.y) < eps && Math.abs(a.b.x - b.b.x) < eps && Math.abs(a.b.y - b.b.y) < eps;
}

// Ponto médio de `a` projetado na reta INFINITA de `b` — mesma lógica da
// cota "linha a linha" do esboço (edgeDistance em render.ts), exata quando
// as 2 arestas são paralelas, aproximação razoável quando não são.
function lineToLineSegment(a: LineHit, b: LineHit): { x1: number; y1: number; x2: number; y2: number } {
  const midA = { x: (a.a.x + a.b.x) / 2, y: (a.a.y + a.b.y) / 2 };
  const dx = b.b.x - b.a.x;
  const dy = b.b.y - b.a.y;
  const lenSq = dx * dx + dy * dy;
  const proj =
    lenSq < 1e-9
      ? b.a
      : {
          x: b.a.x + ((midA.x - b.a.x) * dx + (midA.y - b.a.y) * dy) * (dx / lenSq),
          y: b.a.y + ((midA.x - b.a.x) * dx + (midA.y - b.a.y) * dy) * (dy / lenSq),
        };
  return { x1: midA.x, y1: midA.y, x2: proj.x, y2: proj.y };
}

// Sinal do deslocamento inicial da linha de cota (na normal canônica
// (-dy,dx) do segmento a→b) que deixa ela "pra fora" da vista dona — só o
// valor de PARTIDA ao criar a cota, ao estilo do posicionamento automático
// do Inventor; depois de criada é só um número comum, arrastar muda ele
// livremente (ver DrawingDimension.offset em types.ts).
function outwardSign(a: Point, b: Point, viewCenter: Point | null): 1 | -1 {
  if (!viewCenter) return 1;
  const nx = -(b.y - a.y);
  const ny = b.x - a.x;
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const outX = mid.x - viewCenter.x;
  const outY = mid.y - viewCenter.y;
  return nx * outX + ny * outY < 0 ? -1 : 1;
}

// Adjacência ao "desenrolar" o cubo a partir de uma vista-base — arrastar
// pra cima/baixo/esquerda/direita a partir de QUALQUER uma das 6 vistas
// padrão sempre cai numa das outras 5 (nunca "iso", que não faz vista
// projetada — ver handleViewPointerDown), de forma consistente com um cubo
// físico (não muda com a orientação da vista de partida). Convenção FIXA
// (não expõe 1º/2º diedro — já tentamos isso no bloco de título e o
// resultado foi ruim, ver histórico): arrastar "pra cima" sempre mostra a
// face de CIMA da peça, "pra direita" a face da DIREITA, etc. — o mais
// intuitivo pra quem está arrastando, mesmo sem rótulo de norma.
const PROJECTION_ADJACENCY: Record<Exclude<ViewOrientation, "iso">, Record<"up" | "down" | "left" | "right", ViewOrientation>> = {
  front: { up: "top", down: "bottom", left: "left", right: "right" },
  back: { up: "top", down: "bottom", left: "right", right: "left" },
  top: { up: "back", down: "front", left: "left", right: "right" },
  bottom: { up: "front", down: "back", left: "left", right: "right" },
  left: { up: "top", down: "bottom", left: "back", right: "front" },
  right: { up: "top", down: "bottom", left: "front", right: "back" },
};

function directionFromVector(dx: number, dy: number): "up" | "down" | "left" | "right" {
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
}

// A-Z pra letra da próxima seção — conta só as vistas de seção que já
// existem na folha, não tem estado global de "próxima letra" separado.
function nextSectionLetter(sheet: DrawingSheet): string {
  const count = sheet.views.filter((v) => v.sectionInfo).length;
  return String.fromCharCode(65 + (count % 26));
}

const HATCH_PATTERN_ID = "section-hatch";

export function DrawingSheetWorkspace() {
  const features = useFeatureStore((s) => s.features);
  const { sheet: activeSheet, sheets } = useActiveSheet();
  const addSheet = useDrawingStore((s) => s.addSheet);
  const removeSheet = useDrawingStore((s) => s.removeSheet);
  const setActiveSheet = useDrawingStore((s) => s.setActiveSheet);
  const renameSheet = useDrawingStore((s) => s.renameSheet);
  const setSheetSize = useDrawingStore((s) => s.setSheetSize);
  const setSheetOrientation = useDrawingStore((s) => s.setSheetOrientation);
  const setSheetScale = useDrawingStore((s) => s.setSheetScale);
  const addView = useDrawingStore((s) => s.addView);
  const updateView = useDrawingStore((s) => s.updateView);
  const removeView = useDrawingStore((s) => s.removeView);
  const moveView = useDrawingStore((s) => s.moveView);
  const addDimension = useDrawingStore((s) => s.addDimension);
  const updateDimension = useDrawingStore((s) => s.updateDimension);
  const removeDimension = useDrawingStore((s) => s.removeDimension);
  const addAnnotation = useDrawingStore((s) => s.addAnnotation);
  const updateAnnotation = useDrawingStore((s) => s.updateAnnotation);
  const removeAnnotation = useDrawingStore((s) => s.removeAnnotation);
  const updateTitleBlock = useDrawingStore((s) => s.updateTitleBlock);
  const applyTemplate = useDrawingStore((s) => s.applyTemplate);

  const hasSheetMetal = features.some((f) => f.type === "sheetMetal");
  // Assinatura da árvore de features atual — comparada com
  // DrawingView.sourceSignature pra saber quais vistas ficaram
  // desatualizadas (ver handleUpdateView/isViewStale). Recalcula só quando
  // `features` muda de referência (rebuildModel já é caro o bastante sem
  // rodar JSON.stringify a cada render à toa).
  const featuresSignature = useMemo(() => JSON.stringify(features), [features]);

  const [pendingFlattened, setPendingFlattened] = useState(false);
  const [computing, setComputing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [dimensionMode, setDimensionMode] = useState(false);
  const [pendingLinePick, setPendingLinePick] = useState<LineHit | null>(null);
  // "weld" é a única anotação de 2 cliques (ponta da seta + linha de
  // referência) — as outras 3 (texto/chanfro/rosca) são 1 clique só, sem
  // precisar de estado "pendente" entre cliques.
  const [annotationMode, setAnnotationMode] = useState<AnnotationKind | "weld" | null>(null);
  const [pendingWeldPoint, setPendingWeldPoint] = useState<Point | null>(null);
  // Onde colocar a PRÓXIMA vista (null = centro da folha, com o cascade de
  // sempre) — setado ao abrir o seletor de vista pelo menu de botão direito
  // (aí vira a posição clicada em vez do centro).
  const [viewInsertTarget, setViewInsertTarget] = useState<Point | null>(null);
  const [viewPickerOpen, setViewPickerOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ clientX: number; clientY: number; sheetPoint: Point } | null>(null);
  // Vista Projetada: clique numa vista-base arma `projectionBase`, clique
  // seguinte em qualquer ponto decide a direção (cima/baixo/esquerda/
  // direita, ver directionFromVector) e gera a vista alinhada+na mesma
  // escala da base (ver handleAddProjectedView).
  const [projectionMode, setProjectionMode] = useState(false);
  const [projectionBase, setProjectionBase] = useState<DrawingView | null>(null);
  // Seção de Corte: clique numa vista-base arma `sectionBase`; 1º clique
  // sobre ela arma o primeiro ponto da linha de corte (pendingSectionPoint);
  // 2º clique comita — mesmo padrão clique-clique já usado em Cota/Solda.
  const [sectionMode, setSectionMode] = useState(false);
  const [sectionBase, setSectionBase] = useState<DrawingView | null>(null);
  const [pendingSectionPoint, setPendingSectionPoint] = useState<Point | null>(null);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [dragPreview, setDragPreview] = useState<{ viewId: string; x: number; y: number } | null>(null);
  const [dimensionDragPreview, setDimensionDragPreview] = useState<{ dimensionId: string; offset: number } | null>(null);
  const [annotationDragPreview, setAnnotationDragPreview] = useState<{ annotationId: string; patch: AnnotationPatch } | null>(null);

  const sheetDims = activeSheet ? sheetDimensionsMm(activeSheet) : { width: 297, height: 210 };

  function clearOtherModes() {
    setDimensionMode(false);
    setPendingLinePick(null);
    setAnnotationMode(null);
    setPendingWeldPoint(null);
    setProjectionMode(false);
    setProjectionBase(null);
    setSectionMode(false);
    setSectionBase(null);
    setPendingSectionPoint(null);
  }

  function setDimensionModeExclusive(on: boolean) {
    clearOtherModes();
    setDimensionMode(on);
  }

  function setAnnotationModeExclusive(mode: AnnotationKind | "weld" | null) {
    clearOtherModes();
    setAnnotationMode(mode);
  }

  function setProjectionModeExclusive(on: boolean) {
    clearOtherModes();
    setProjectionMode(on);
  }

  function setSectionModeExclusive(on: boolean) {
    clearOtherModes();
    setSectionMode(on);
  }

  // Núcleo compartilhado de geração de vista NORMAL (projeção HLR direta,
  // sem corte) — usado por handleAddView (posição livre/centro) e por
  // handleAddProjectedView (posição alinhada à vista-base) e também por
  // handleUpdateView (mesma orientação/planificado, só recalcula a
  // geometria). Sempre carimba sourceSignature com a árvore ATUAL de
  // features, pra "Atualizar" saber quando parar de avisar.
  async function computeView(orientation: ViewOrientation, flattened: boolean): Promise<DrawingView | null> {
    setComputing(true);
    setErrorMessage(null);
    let solid = null;
    try {
      await loadOpenCascade();
      solid = rebuildModel(features, { flatten: flattened });
      if (!solid) {
        setErrorMessage("Nenhum sólido modelado ainda — crie a peça no Modelador antes de adicionar uma vista.");
        return null;
      }
      const raw = buildDrawingView(solid, orientation, flattened);
      const maxW = sheetDims.width - SHEET_MARGIN_MM * 2;
      const maxH = sheetDims.height - SHEET_MARGIN_MM * 2 - TITLE_BLOCK_HEIGHT_MM;
      const scale = suggestScale(raw.box, maxW * 0.9, maxH * 0.9);
      return {
        ...raw,
        scale,
        scaleLabel: scaleToLabel(scale),
        label: VIEW_ORIENTATION_LABELS[orientation],
        sourceSignature: featuresSignature,
      };
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Erro ao gerar a vista.");
      return null;
    } finally {
      solid?.delete();
      setComputing(false);
    }
  }

  // Posição de destino: o ponto clicado com o botão direito (menu "Inserir
  // Vista"), se houver; senão o centro da folha, com o mesmo cascade de
  // sempre pra não empilhar vistas exatamente uma em cima da outra.
  async function handleAddView(orientation: ViewOrientation) {
    if (!activeSheet) return;
    const view = await computeView(orientation, pendingFlattened);
    if (!view) return;
    const cascade = activeSheet.views.length * 12;
    // Escala da FOLHA (editável na barra, ver "Escala da Folha") — não
    // "ajustar automaticamente à página" como antes; o usuário controla
    // explicitamente, igual escala de folha do Inventor.
    addView(activeSheet.id, {
      ...view,
      scale: activeSheet.scale,
      scaleLabel: scaleToLabel(activeSheet.scale),
      x: viewInsertTarget?.x ?? sheetDims.width / 2 + cascade,
      y: viewInsertTarget?.y ?? (sheetDims.height - TITLE_BLOCK_HEIGHT_MM) / 2 + cascade,
    });
    setViewPickerOpen(false);
    setViewInsertTarget(null);
  }

  // Vista Projetada: mesma orientação/planificado e a MESMA escala da
  // vista-base (não recalcula "ajustar à folha" — projetada sempre
  // acompanha a base, ao estilo Inventor), posicionada alinhada (mesmo X se
  // for pra cima/baixo, mesmo Y se for pra esquerda/direita).
  async function handleAddProjectedView(baseView: DrawingView, direction: "up" | "down" | "left" | "right") {
    if (!activeSheet || baseView.orientation === "iso") return;
    const orientation = PROJECTION_ADJACENCY[baseView.orientation][direction];
    const raw = await computeView(orientation, baseView.flattened);
    if (!raw) return;
    const scale = baseView.scale;
    const halfBaseW = (baseView.box.width * baseView.scale) / 2;
    const halfBaseH = (baseView.box.height * baseView.scale) / 2;
    const halfNewW = (raw.box.width * scale) / 2;
    const halfNewH = (raw.box.height * scale) / 2;
    const gap = 14;
    let x = baseView.x;
    let y = baseView.y;
    if (direction === "up") y = baseView.y - halfBaseH - gap - halfNewH;
    else if (direction === "down") y = baseView.y + halfBaseH + gap + halfNewH;
    else if (direction === "left") x = baseView.x - halfBaseW - gap - halfNewW;
    else x = baseView.x + halfBaseW + gap + halfNewW;

    addView(activeSheet.id, { ...raw, scale, scaleLabel: scaleToLabel(scale), x, y });
    setProjectionBase(null);
  }

  // Seção de Corte: corta o sólido de verdade com o plano definido pela
  // linha desenhada sobre a vista-base (ver buildSectionView) e coloca a
  // vista de seção alinhada à direita da base (mesma lógica de espaçamento
  // da vista projetada, direção fixa por simplicidade — sem indicador de
  // seta escolhendo o lado).
  async function computeSectionView(baseView: DrawingView, cutLine: { x1: number; y1: number; x2: number; y2: number }, letter: string) {
    if (!activeSheet || baseView.orientation === "iso") return;
    setComputing(true);
    setErrorMessage(null);
    let solid = null;
    try {
      await loadOpenCascade();
      solid = rebuildModel(features, { flatten: baseView.flattened });
      if (!solid) {
        setErrorMessage("Nenhum sólido modelado ainda — crie a peça no Modelador antes de cortar uma seção.");
        return;
      }
      const raw = buildSectionView(solid, { baseViewId: baseView.id, cutLine }, baseView.orientation);
      if (!raw) {
        setErrorMessage("Não foi possível calcular a seção — tente uma linha de corte diferente.");
        return;
      }
      const view: DrawingView = { ...raw, sourceSignature: featuresSignature, sectionInfo: { ...raw.sectionInfo!, letter } };
      const scale = activeSheet.scale;
      const halfBaseW = (baseView.box.width * baseView.scale) / 2;
      const halfNewW = (view.box.width * scale) / 2;
      addView(activeSheet.id, {
        ...view,
        scale,
        scaleLabel: scaleToLabel(scale),
        label: `Seção ${letter}-${letter}`,
        x: baseView.x + halfBaseW + 14 + halfNewW,
        y: baseView.y,
      });
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Erro ao gerar a seção de corte.");
    } finally {
      solid?.delete();
      setComputing(false);
    }
  }

  // "Atualizar" — Inventor-style: recalcula a geometria com o sólido ATUAL
  // (mesma orientação/planificado, mesma linha de corte pra seção), mas
  // mantém posição/escala/label como estavam (o usuário já ajustou isso na
  // folha; atualizar não deve bagunçar o layout).
  async function handleUpdateView(view: DrawingView) {
    if (!activeSheet) return;
    if (view.sectionInfo) {
      const baseView = activeSheet.views.find((v) => v.id === view.sectionInfo!.baseViewId);
      if (!baseView) return;
      setComputing(true);
      setErrorMessage(null);
      let solid = null;
      try {
        await loadOpenCascade();
        solid = rebuildModel(features, { flatten: baseView.flattened });
        if (!solid) return;
        const raw = buildSectionView(solid, { baseViewId: baseView.id, cutLine: view.sectionInfo.cutLine }, baseView.orientation);
        if (!raw) return;
        updateView(activeSheet.id, view.id, {
          visiblePaths: raw.visiblePaths,
          hiddenPaths: raw.hiddenPaths,
          lineEdges: raw.lineEdges,
          box: raw.box,
          sourceSignature: featuresSignature,
        });
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : "Erro ao atualizar a seção.");
      } finally {
        solid?.delete();
        setComputing(false);
      }
      return;
    }
    const fresh = await computeView(view.orientation, view.flattened);
    if (!fresh) return;
    updateView(activeSheet.id, view.id, {
      visiblePaths: fresh.visiblePaths,
      hiddenPaths: fresh.hiddenPaths,
      lineEdges: fresh.lineEdges,
      box: fresh.box,
      sourceSignature: fresh.sourceSignature,
    });
  }

  // "Modelo de folha" = só tamanho/orientação/bloco de título (sem
  // vistas/cotas, que são da peça) — arquivo próprio (.eksfolha), pra
  // reaproveitar o padrão da empresa em qualquer projeto novo sem
  // redigitar tudo. Mesmo padrão de salvar/abrir já usado pro projeto
  // inteiro (.eks3d) em ModeladorWorkspace, só que sem integração com a
  // pasta do projeto (ação avulsa, não precisa lembrar "arquivo atual").
  async function handleSaveTemplate() {
    if (!activeSheet) return;
    const template: SheetTemplate = {
      size: activeSheet.size,
      orientation: activeSheet.orientation,
      scale: activeSheet.scale,
      titleBlock: activeSheet.titleBlock,
    };
    const json = serializeSheetTemplate(template);
    const suggestedName = `modelo-folha${SHEET_TEMPLATE_EXTENSION}`;

    if (isFileSystemAccessSupported()) {
      const handle = await pickSaveFileHandle(suggestedName, [
        { description: "Modelo de folha Eksteel", accept: { "application/json": [SHEET_TEMPLATE_EXTENSION] } },
      ]);
      if (!handle) return;
      await writeToFileHandle(handle, json);
      return;
    }
    await saveOrDownload(null, json, suggestedName);
  }

  async function handleLoadTemplate() {
    if (!activeSheet) return;
    const picked = await pickFileToOpen([
      { description: "Modelo de folha Eksteel", accept: { "application/json": [SHEET_TEMPLATE_EXTENSION] } },
    ]);
    if (!picked) return;
    try {
      const template = parseSheetTemplate(await picked.file.text());
      applyTemplate(activeSheet.id, template);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Erro ao carregar o modelo de folha.");
    }
  }

  function handleViewPointerDown(e: React.PointerEvent<SVGRectElement>, view: DrawingView) {
    if (dimensionMode || annotationMode) return;
    if (projectionMode) {
      e.stopPropagation();
      if (view.orientation === "iso") {
        setErrorMessage("Não é possível projetar uma vista a partir de uma vista isométrica.");
        return;
      }
      setProjectionBase(view);
      return;
    }
    if (sectionMode) {
      e.stopPropagation();
      if (view.orientation === "iso") {
        setErrorMessage("Não é possível cortar uma seção a partir de uma vista isométrica.");
        return;
      }
      setSectionBase(view);
      setPendingSectionPoint(null);
      return;
    }
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    dragRef.current = { kind: "view", viewId: view.id, startClientX: e.clientX, startClientY: e.clientY, origX: view.x, origY: view.y };
  }

  // Arrasta só ao longo da normal do segmento medido (nx,ny já resolvidos
  // no momento do pointerdown) — mover perpendicular ao segmento afasta ou
  // aproxima a linha de cota da peça; não dá pra arrastar "de lado" (isso
  // exigiria decidir o que acontece com os pontos medidos em si, fora de
  // escopo — só a distância da linha de cota é ajustável).
  function handleDimensionPointerDown(e: React.PointerEvent<SVGLineElement>, dim: { id: string; x1: number; y1: number; x2: number; y2: number; offset: number }) {
    // Diferente da vista, arrastar uma cota não conflita com o modo Cota
    // (o clique-clique de criar cota só reage a arestas da PEÇA —
    // findNearestLine nunca olha pras próprias cotas já colocadas), então
    // não precisa desligar o modo antes de reposicionar uma cota existente.
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    const len = Math.hypot(dim.x2 - dim.x1, dim.y2 - dim.y1) || 1;
    const nx = -(dim.y2 - dim.y1) / len;
    const ny = (dim.x2 - dim.x1) / len;
    dragRef.current = { kind: "dimension", dimensionId: dim.id, nx, ny, startClientX: e.clientX, startClientY: e.clientY, startOffset: dim.offset };
  }

  // Anotação translada inteira (1 ponto pras 3 de clique único, os 2 pontos
  // juntos pra solda) — mesmo padrão de handleDimensionPointerDown, sem
  // conflito com o modo Cota pela mesma razão (arrastar uma anotação já
  // colocada não usa o clique-clique de criação).
  function handleAnnotationPointerDown(e: React.PointerEvent<SVGElement>, annotation: DrawingAnnotation) {
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    const orig: AnnotationPatch =
      annotation.kind === "weld"
        ? { x1: annotation.x1, y1: annotation.y1, x2: annotation.x2, y2: annotation.y2 }
        : { x: annotation.x, y: annotation.y };
    dragRef.current = { kind: "annotation", annotationId: annotation.id, startClientX: e.clientX, startClientY: e.clientY, orig };
  }

  function handleSheetPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const svg = svgRef.current;
    if (!svg) return;
    const scaleFactor = svg.clientWidth > 0 ? sheetDims.width / svg.clientWidth : 1;
    const dx = (e.clientX - drag.startClientX) * scaleFactor;
    const dy = (e.clientY - drag.startClientY) * scaleFactor;
    if (drag.kind === "view") {
      setDragPreview({ viewId: drag.viewId, x: drag.origX + dx, y: drag.origY + dy });
    } else if (drag.kind === "dimension") {
      const delta = dx * drag.nx + dy * drag.ny;
      setDimensionDragPreview({ dimensionId: drag.dimensionId, offset: drag.startOffset + delta });
    } else {
      const patch: AnnotationPatch =
        drag.orig.x !== undefined
          ? { x: drag.orig.x + dx, y: (drag.orig.y ?? 0) + dy }
          : {
              x1: (drag.orig.x1 ?? 0) + dx,
              y1: (drag.orig.y1 ?? 0) + dy,
              x2: (drag.orig.x2 ?? 0) + dx,
              y2: (drag.orig.y2 ?? 0) + dy,
            };
      setAnnotationDragPreview({ annotationId: drag.annotationId, patch });
    }
  }

  function handleSheetPointerUp() {
    const drag = dragRef.current;
    if (drag?.kind === "view" && dragPreview && activeSheet) {
      moveView(activeSheet.id, drag.viewId, dragPreview.x, dragPreview.y);
    } else if (drag?.kind === "dimension" && dimensionDragPreview && activeSheet) {
      updateDimension(activeSheet.id, drag.dimensionId, { offset: dimensionDragPreview.offset });
    } else if (drag?.kind === "annotation" && annotationDragPreview && activeSheet) {
      updateAnnotation(activeSheet.id, drag.annotationId, annotationDragPreview.patch);
    }
    dragRef.current = null;
    setDragPreview(null);
    setDimensionDragPreview(null);
    setAnnotationDragPreview(null);
  }

  // Botão direito em qualquer ponto da folha abre o menu "Inserir Vista" —
  // não distingue se caiu em cima de uma vista/cota/anotação existente
  // (nenhuma dessas usa botão direito pra nada hoje, então não tem conflito
  // real de gesto a resolver).
  function handleSheetContextMenu(e: React.MouseEvent<SVGSVGElement>) {
    e.preventDefault();
    if (!svgRef.current) return;
    const sheetPoint = toSheetPoint(svgRef.current, e.clientX, e.clientY);
    setContextMenu({ clientX: e.clientX, clientY: e.clientY, sheetPoint });
  }

  // 1º clique perto de uma aresta reta "arma" a seleção (pendingLinePick);
  // 2º clique decide o que fazer, ao estilo Inventor/esboço (ver
  // handleRawUp em sketch/store.ts, mesmo espírito): clique vazio OU na
  // MESMA aresta comita o comprimento dela; clique numa aresta DIFERENTE
  // comita a distância entre as duas. Modo anotação segue o mesmo clique
  // único (2 cliques só pra solda: ponta da junta + fim da linha de
  // referência) — os 2 modos são mutuamente exclusivos (ver
  // setDimensionModeExclusive/setAnnotationModeExclusive).
  function handleSheetClick(e: React.MouseEvent<SVGSVGElement>) {
    if (!activeSheet || !svgRef.current) return;
    const point = toSheetPoint(svgRef.current, e.clientX, e.clientY);

    if (dimensionMode) {
      const hit = findNearestLine(activeSheet, point, LINE_HIT_TOLERANCE_MM);

      if (!pendingLinePick) {
        if (hit) setPendingLinePick(hit);
        return;
      }

      const owningView = activeSheet.views.find((v) => v.id === pendingLinePick.viewId);
      const viewCenter = owningView ? { x: owningView.x, y: owningView.y } : null;

      if (!hit || sameLine(pendingLinePick, hit)) {
        const { a, b } = pendingLinePick;
        addDimension(activeSheet.id, {
          id: createId(),
          viewId: pendingLinePick.viewId,
          x1: a.x,
          y1: a.y,
          x2: b.x,
          y2: b.y,
          offset: DIM_OFFSET_MM * outwardSign(a, b, viewCenter),
        });
      } else {
        const seg = lineToLineSegment(pendingLinePick, hit);
        addDimension(activeSheet.id, {
          id: createId(),
          viewId: pendingLinePick.viewId,
          ...seg,
          offset: DIM_OFFSET_MM * outwardSign({ x: seg.x1, y: seg.y1 }, { x: seg.x2, y: seg.y2 }, viewCenter),
        });
      }
      setPendingLinePick(null);
      return;
    }

    if (annotationMode) {
      const viewId = findContainingView(activeSheet, point)?.id ?? null;

      if (annotationMode === "weld") {
        if (!pendingWeldPoint) {
          setPendingWeldPoint(point);
          return;
        }
        const start = pendingWeldPoint;
        setPendingWeldPoint(null);
        const text = window.prompt("Medida da solda (ex.: 5):", "5");
        if (text === null) return;
        addAnnotation(activeSheet.id, { id: createId(), viewId, kind: "weld", x1: start.x, y1: start.y, x2: point.x, y2: point.y, text });
        return;
      }

      const meta = ANNOTATION_META[annotationMode];
      const text = window.prompt(meta.promptLabel, meta.placeholder);
      if (text === null) return;
      addAnnotation(activeSheet.id, { id: createId(), viewId, kind: annotationMode, x: point.x, y: point.y, text });
      return;
    }

    if (projectionMode) {
      // Base já selecionada via handleViewPointerDown (pointerdown chega
      // antes do click, mas o estado só atualiza no próximo render — esse
      // clique aqui ainda vê o valor de ANTES, então só um clique
      // subsequente e separado, fora da vista-base, conta como direção.
      if (!projectionBase) return;
      const dx = point.x - projectionBase.x;
      const dy = point.y - projectionBase.y;
      void handleAddProjectedView(projectionBase, directionFromVector(dx, dy));
      return;
    }

    if (sectionMode) {
      if (!sectionBase) return;
      const owningBase = sectionBase;
      const local = sheetToViewLocal(owningBase, point);
      if (!pendingSectionPoint) {
        setPendingSectionPoint(point);
        return;
      }
      const startLocal = sheetToViewLocal(owningBase, pendingSectionPoint);
      setPendingSectionPoint(null);
      setSectionBase(null);
      void computeSectionView(
        owningBase,
        { x1: startLocal.x, y1: startLocal.y, x2: local.x, y2: local.y },
        nextSectionLetter(activeSheet)
      );
    }
  }

  const sizeButtons: SheetSize[] = ["A4", "A3"];

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-primary-100 bg-primary-50 px-3 py-2 text-sm">
        <div className="flex items-center gap-1 overflow-x-auto">
          {sheets.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setActiveSheet(s.id)}
              className={`shrink-0 rounded-lg px-3 py-1.5 transition ${
                activeSheet?.id === s.id ? "bg-primary text-primary-foreground" : "bg-white text-primary-700 hover:bg-primary-100"
              }`}
            >
              {s.name}
            </button>
          ))}
          <button
            type="button"
            onClick={() => addSheet(createSheetObject(`Folha ${sheets.length + 1}`))}
            title="Nova folha de desenho"
            className="shrink-0 rounded-lg bg-white px-3 py-1.5 text-primary-700 hover:bg-primary-100"
          >
            + Folha
          </button>
        </div>

        {activeSheet && (
          <>
            <div className="mx-1 h-6 w-px shrink-0 bg-primary-200" />
            <button
              type="button"
              onClick={() => {
                const name = window.prompt("Nome da folha:", activeSheet.name);
                if (name) renameSheet(activeSheet.id, name);
              }}
              className="rounded-lg bg-white px-3 py-1.5 text-primary-700 hover:bg-primary-100"
            >
              Renomear
            </button>
            {sizeButtons.map((size) => (
              <button
                key={size}
                type="button"
                onClick={() => setSheetSize(activeSheet.id, size)}
                className={`rounded-lg px-3 py-1.5 transition ${
                  activeSheet.size === size ? "bg-primary text-primary-foreground" : "bg-white text-primary-700 hover:bg-primary-100"
                }`}
              >
                {size}
              </button>
            ))}
            <button
              type="button"
              onClick={() =>
                setSheetOrientation(activeSheet.id, activeSheet.orientation === "landscape" ? "portrait" : "landscape")
              }
              className="rounded-lg bg-white px-3 py-1.5 text-primary-700 hover:bg-primary-100"
              title="Alternar paisagem/retrato"
            >
              {activeSheet.orientation === "landscape" ? "Paisagem" : "Retrato"}
            </button>
            <label
              className="flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-primary-700"
              title='Escala usada em toda vista NOVA colocada na folha (Vista Projetada sempre acompanha a escala da vista de onde saiu, não essa). Mudar aqui não reescala vistas já colocadas.'
            >
              Escala
              <select
                value={activeSheet.scale}
                onChange={(e) => setSheetScale(activeSheet.id, Number(e.target.value))}
                className="rounded-lg border border-primary-200 bg-white px-1.5 py-0.5 text-foreground"
              >
                {SHEET_SCALE_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {scaleToLabel(s)}
                  </option>
                ))}
              </select>
            </label>

            <div className="mx-1 h-6 w-px shrink-0 bg-primary-200" />
            <button
              type="button"
              onClick={() => {
                setViewInsertTarget(null);
                setViewPickerOpen(true);
              }}
              title='Escolha a orientação num seletor de vistas — igual botão direito → "Inserir Vista", só que sempre no centro da folha'
              className="rounded-lg bg-white px-3 py-1.5 text-primary-700 hover:bg-primary-100"
            >
              Adicionar Vista
            </button>
            <button
              type="button"
              onClick={() => setDimensionModeExclusive(!dimensionMode)}
              className={`rounded-lg px-3 py-1.5 transition ${
                dimensionMode ? "bg-primary text-primary-foreground" : "bg-white text-primary-700 hover:bg-primary-100"
              }`}
              title="Clique numa aresta pra cotar o comprimento dela, ou em 2 arestas diferentes pra cotar a distância entre as duas"
            >
              Cota
            </button>
            <button
              type="button"
              onClick={() => setProjectionModeExclusive(!projectionMode)}
              className={`rounded-lg px-3 py-1.5 transition ${
                projectionMode ? "bg-primary text-primary-foreground" : "bg-white text-primary-700 hover:bg-primary-100"
              }`}
              title="Clique numa vista já na folha e depois num ponto pra cima/baixo/esquerda/direita pra projetar uma vista alinhada a partir dela"
            >
              Vista Projetada
            </button>
            <button
              type="button"
              onClick={() => setSectionModeExclusive(!sectionMode)}
              className={`rounded-lg px-3 py-1.5 transition ${
                sectionMode ? "bg-primary text-primary-foreground" : "bg-white text-primary-700 hover:bg-primary-100"
              }`}
              title="Clique numa vista, depois 2 pontos sobre ela pra desenhar a linha de corte — corta o sólido de verdade e gera a vista de seção"
            >
              Seção de Corte
            </button>

            <div className="mx-1 h-6 w-px shrink-0 bg-primary-200" />
            {(Object.keys(ANNOTATION_META) as AnnotationKind[]).map((kind) => (
              <button
                key={kind}
                type="button"
                onClick={() => setAnnotationModeExclusive(annotationMode === kind ? null : kind)}
                className={`rounded-lg px-3 py-1.5 transition ${
                  annotationMode === kind ? "bg-primary text-primary-foreground" : "bg-white text-primary-700 hover:bg-primary-100"
                }`}
                title={ANNOTATION_META[kind].promptLabel}
              >
                {ANNOTATION_META[kind].buttonLabel}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setAnnotationModeExclusive(annotationMode === "weld" ? null : "weld")}
              className={`rounded-lg px-3 py-1.5 transition ${
                annotationMode === "weld" ? "bg-primary text-primary-foreground" : "bg-white text-primary-700 hover:bg-primary-100"
              }`}
              title="Clique no ponto da junta, depois no fim da linha de referência, pra colocar o símbolo de solda"
            >
              Solda
            </button>

            <div className="mx-1 h-6 w-px shrink-0 bg-primary-200" />
            <button
              type="button"
              onClick={handleSaveTemplate}
              title="Salvar tamanho + bloco de título (com logo/tolerâncias) como modelo reutilizável em outros projetos"
              className="rounded-lg bg-white px-3 py-1.5 text-primary-700 hover:bg-primary-100"
            >
              Salvar Modelo de Folha
            </button>
            <button
              type="button"
              onClick={handleLoadTemplate}
              title="Carregar um modelo de folha salvo antes (aplica na folha atual)"
              className="rounded-lg bg-white px-3 py-1.5 text-primary-700 hover:bg-primary-100"
            >
              Carregar Modelo de Folha
            </button>

            <button
              type="button"
              onClick={() => {
                if (window.confirm(`Excluir a folha "${activeSheet.name}"?`)) removeSheet(activeSheet.id);
              }}
              className="ml-auto rounded-lg bg-white px-3 py-1.5 text-error hover:bg-error/10"
            >
              Excluir Folha
            </button>
          </>
        )}
      </div>

      {errorMessage && (
        <p className="border-b border-error/20 bg-error/10 px-3 py-2 text-sm text-error">{errorMessage}</p>
      )}

      <div className="flex min-h-0 flex-1">
        <div className="min-h-0 flex-1 overflow-auto bg-primary-100/40 p-6">
          {activeSheet ? (
            <svg
              ref={svgRef}
              viewBox={`0 0 ${sheetDims.width} ${sheetDims.height}`}
              className="mx-auto block bg-white shadow-lg"
              style={{ width: "100%", maxWidth: sheetDims.width * 3.5 }}
              onPointerMove={handleSheetPointerMove}
              onPointerUp={handleSheetPointerUp}
              onClick={handleSheetClick}
              onContextMenu={handleSheetContextMenu}
            >
              <defs>
                {/* Hachura padrão (45°) das faces cortadas na vista de
                    seção — preenche visiblePaths inteiro (ver
                    DrawingViewGroup), simplificação deliberada: não
                    distingue "face exposta pelo corte" de eventual
                    geometria mais ao fundo ainda visível (razoável pra
                    peças de chapa fina, que é o forte desse app — pouca
                    profundidade sobrando atrás do corte). */}
                <pattern id={HATCH_PATTERN_ID} patternUnits="userSpaceOnUse" width={3} height={3} patternTransform="rotate(45)">
                  <line x1={0} y1={0} x2={0} y2={3} stroke="#0d1b2a" strokeWidth={0.4} />
                </pattern>
              </defs>

              <rect x={0.5} y={0.5} width={sheetDims.width - 1} height={sheetDims.height - 1} fill="white" stroke="#333" strokeWidth={0.5} />
              {/* Moldura da área de desenho, recuada da borda do papel (ao
                  estilo ISO 5457/ABNT NBR 10068) — mesmo recuo já usado pra
                  posicionar vistas/bloco de título (SHEET_MARGIN_MM), só que
                  desenhado como linha mais grossa que o contorno do papel. */}
              <rect
                x={SHEET_MARGIN_MM}
                y={SHEET_MARGIN_MM}
                width={sheetDims.width - SHEET_MARGIN_MM * 2}
                height={sheetDims.height - SHEET_MARGIN_MM * 2}
                fill="none"
                stroke="#000"
                strokeWidth={0.7}
              />

              {activeSheet.views.map((view) => (
                <DrawingViewGroup
                  key={view.id}
                  view={view}
                  effective={dragPreview?.viewId === view.id ? dragPreview : null}
                  stale={view.sourceSignature !== undefined && view.sourceSignature !== featuresSignature}
                  onDragStart={handleViewPointerDown}
                  onRemove={() => removeView(activeSheet.id, view.id)}
                  onUpdate={() => void handleUpdateView(view)}
                  onCycleScale={() => {
                    const idx = COMMON_SCALE_STEPS.indexOf(view.scale);
                    const next = COMMON_SCALE_STEPS[(idx + 1 + COMMON_SCALE_STEPS.length) % COMMON_SCALE_STEPS.length] ?? 1;
                    updateView(activeSheet.id, view.id, { scale: next, scaleLabel: scaleToLabel(next) });
                  }}
                />
              ))}

              {activeSheet.views
                .filter((v) => v.sectionInfo)
                .map((v) => {
                  const baseView = activeSheet.views.find((b) => b.id === v.sectionInfo!.baseViewId);
                  if (!baseView) return null;
                  const { cutLine, letter } = v.sectionInfo!;
                  const p1 = viewLocalToSheet(baseView, { x: cutLine.x1, y: cutLine.y1 });
                  const p2 = viewLocalToSheet(baseView, { x: cutLine.x2, y: cutLine.y2 });
                  return <CutLineIndicator key={v.id} a={p1} b={p2} letter={letter} />;
                })}

              {projectionBase && (
                <rect
                  x={projectionBase.x - (projectionBase.box.width * projectionBase.scale) / 2 - 1.5}
                  y={projectionBase.y - (projectionBase.box.height * projectionBase.scale) / 2 - 1.5}
                  width={projectionBase.box.width * projectionBase.scale + 3}
                  height={projectionBase.box.height * projectionBase.scale + 3}
                  fill="none"
                  stroke="#e53935"
                  strokeDasharray="2 1.5"
                  strokeWidth={0.6}
                  pointerEvents="none"
                />
              )}

              {sectionBase && (
                <rect
                  x={sectionBase.x - (sectionBase.box.width * sectionBase.scale) / 2 - 1.5}
                  y={sectionBase.y - (sectionBase.box.height * sectionBase.scale) / 2 - 1.5}
                  width={sectionBase.box.width * sectionBase.scale + 3}
                  height={sectionBase.box.height * sectionBase.scale + 3}
                  fill="none"
                  stroke="#e53935"
                  strokeDasharray="2 1.5"
                  strokeWidth={0.6}
                  pointerEvents="none"
                />
              )}

              {sectionBase && pendingSectionPoint && (
                <circle cx={pendingSectionPoint.x} cy={pendingSectionPoint.y} r={1} fill="#e53935" />
              )}

              {activeSheet.dimensions.map((dim) => (
                <DimensionSvg
                  key={dim.id}
                  dim={dim}
                  effectiveOffset={dimensionDragPreview?.dimensionId === dim.id ? dimensionDragPreview.offset : null}
                  onDragStart={handleDimensionPointerDown}
                  onRemove={() => removeDimension(activeSheet.id, dim.id)}
                />
              ))}

              {pendingLinePick && (
                <line
                  x1={pendingLinePick.a.x}
                  y1={pendingLinePick.a.y}
                  x2={pendingLinePick.b.x}
                  y2={pendingLinePick.b.y}
                  stroke="#e53935"
                  strokeWidth={1.6}
                  vectorEffect="non-scaling-stroke"
                />
              )}

              {activeSheet.annotations.map((annotation) => (
                <AnnotationSvg
                  key={annotation.id}
                  annotation={annotation}
                  effectivePatch={annotationDragPreview?.annotationId === annotation.id ? annotationDragPreview.patch : null}
                  onDragStart={handleAnnotationPointerDown}
                  onRemove={() => removeAnnotation(activeSheet.id, annotation.id)}
                />
              ))}

              {pendingWeldPoint && <circle cx={pendingWeldPoint.x} cy={pendingWeldPoint.y} r={1} fill="#e53935" />}

              <TitleBlockSvg
                sheet={activeSheet}
                x={sheetDims.width - SHEET_MARGIN_MM - (sheetDims.width - SHEET_MARGIN_MM * 2) * TITLE_BLOCK_WIDTH_RATIO}
                y={sheetDims.height - SHEET_MARGIN_MM - TITLE_BLOCK_HEIGHT_MM}
                width={(sheetDims.width - SHEET_MARGIN_MM * 2) * TITLE_BLOCK_WIDTH_RATIO}
                height={TITLE_BLOCK_HEIGHT_MM}
              />
            </svg>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-primary-500">
              <p>Nenhuma folha de desenho ainda.</p>
              <button
                type="button"
                onClick={() => addSheet(createSheetObject("Folha 1"))}
                className="rounded-lg bg-primary px-4 py-2 text-primary-foreground"
              >
                Criar Folha
              </button>
            </div>
          )}
        </div>

        {activeSheet && (
          <div className="w-72 shrink-0 overflow-y-auto border-l border-primary-100 bg-white p-3 text-sm">
            <h3 className="mb-2 font-semibold text-primary-900">Bloco de Título</h3>
            <TitleBlockForm sheet={activeSheet} onChange={(patch) => updateTitleBlock(activeSheet.id, patch)} />
          </div>
        )}
      </div>

      {contextMenu && (
        <>
          {/* Fecha o menu em qualquer clique/botão-direito fora dele — não
              tem outro uso de botão direito na folha hoje, então capturar
              tudo aqui não conflita com nada. */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setContextMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setContextMenu(null);
            }}
          />
          <div
            className="fixed z-50 min-w-[10rem] rounded-lg border border-primary-100 bg-white py-1 text-sm shadow-xl"
            style={{ left: contextMenu.clientX, top: contextMenu.clientY }}
          >
            <button
              type="button"
              onClick={() => {
                setViewInsertTarget(contextMenu.sheetPoint);
                setViewPickerOpen(true);
                setContextMenu(null);
              }}
              className="block w-full px-3 py-1.5 text-left text-primary-700 hover:bg-primary-50"
            >
              Inserir Vista
            </button>
          </div>
        </>
      )}

      {viewPickerOpen && activeSheet && (
        <ViewCubePicker
          hasSheetMetal={hasSheetMetal}
          flattened={pendingFlattened}
          onFlattenedChange={setPendingFlattened}
          computing={computing}
          onPick={handleAddView}
          onClose={() => {
            setViewPickerOpen(false);
            setViewInsertTarget(null);
          }}
        />
      )}
    </div>
  );
}

const COMMON_SCALE_STEPS = [1 / 10, 1 / 5, 1 / 2, 1, 2, 5];

function DrawingViewGroup({
  view,
  effective,
  stale,
  onDragStart,
  onRemove,
  onUpdate,
  onCycleScale,
}: {
  view: DrawingView;
  effective: { x: number; y: number } | null;
  stale: boolean;
  onDragStart: (e: React.PointerEvent<SVGRectElement>, view: DrawingView) => void;
  onRemove: () => void;
  onUpdate: () => void;
  onCycleScale: () => void;
}) {
  const x = effective?.x ?? view.x;
  const y = effective?.y ?? view.y;
  const cx = view.box.minX + view.box.width / 2;
  const cy = view.box.minY + view.box.height / 2;
  const transform = `translate(${x} ${y}) scale(${view.scale}) translate(${-cx} ${-cy})`;
  const halfW = (view.box.width * view.scale) / 2;
  const halfH = (view.box.height * view.scale) / 2;
  const isSection = Boolean(view.sectionInfo);

  return (
    <g className="group">
      <g transform={transform}>
        {isSection && (
          <path
            d={view.visiblePaths.join(" ")}
            fill={`url(#${HATCH_PATTERN_ID})`}
            fillRule="evenodd"
            stroke="none"
          />
        )}
        {view.visiblePaths.map((d, i) => (
          <path key={`v${i}`} d={d} fill="none" stroke="#0d1b2a" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        ))}
        {view.hiddenPaths.map((d, i) => (
          <path
            key={`h${i}`}
            d={d}
            fill="none"
            stroke="#0d1b2a"
            strokeWidth={1}
            strokeDasharray="4 3"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </g>

      <rect
        x={x - halfW}
        y={y - halfH}
        width={Math.max(halfW * 2, 1)}
        height={Math.max(halfH * 2, 1)}
        fill="transparent"
        pointerEvents="all"
        className="cursor-move"
        onPointerDown={(e) => onDragStart(e, view)}
      />

      <text x={x} y={y + halfH + 6} textAnchor="middle" fontSize={4.2} fill="#455a64">
        {view.label} ({view.scaleLabel})
      </text>

      <g
        className="cursor-pointer opacity-0 transition-opacity group-hover:opacity-100"
        onClick={(e) => {
          e.stopPropagation();
          onCycleScale();
        }}
      >
        <text x={x - halfW} y={y - halfH - 2} fontSize={4.5} fill="#546e7a">
          escala ↻
        </text>
      </g>
      <text
        x={x + halfW}
        y={y - halfH - 2}
        textAnchor="end"
        fontSize={5.5}
        fill="#e53935"
        className="cursor-pointer opacity-0 transition-opacity group-hover:opacity-100"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
      >
        ×
      </text>

      {/* Aviso de vista desatualizada — igual o ícone de "fora de data" do
          Inventor: fica sempre visível (não só no hover) enquanto a
          peça 3D mudou depois que essa vista foi gerada. */}
      {stale && (
        <g
          className="cursor-pointer"
          onClick={(e) => {
            e.stopPropagation();
            onUpdate();
          }}
        >
          <circle cx={x - halfW + 2.5} cy={y - halfH - 4} r={2.5} fill="#f59e0b" stroke="#0d1b2a" strokeWidth={0.3} />
          <text x={x - halfW + 2.5} y={y - halfH - 2.9} textAnchor="middle" fontSize={3.4} fontWeight={700} fill="#1a1a1a" pointerEvents="none">
            !
          </text>
          <text x={x - halfW + 6} y={y - halfH - 2.9} fontSize={3.6} fill="#b45309">
            Atualizar
          </text>
        </g>
      )}
    </g>
  );
}

// Indicador simplificado da linha de corte na vista-base de uma seção — um
// traço com um pequeno círculo+letra em cada ponta (não é a notação
// completa ISO 128 de traço-ponto com setas de direção de observação, ver
// buildSectionView pro mesmo tipo de simplificação já assumida na direção
// da câmera de seção).
function CutLineIndicator({ a, b, letter }: { a: Point; b: Point; letter: string }) {
  return (
    <g pointerEvents="none">
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#e53935" strokeWidth={0.5} strokeDasharray="4 1.2 1 1.2" />
      {[a, b].map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r={2.2} fill="white" stroke="#e53935" strokeWidth={0.4} />
          <text x={p.x} y={p.y + 1.1} textAnchor="middle" fontSize={2.8} fontWeight={700} fill="#e53935">
            {letter}
          </text>
        </g>
      ))}
    </g>
  );
}

// Quanto a linha de extensão "estoura" pra além da linha de cota — ao
// estilo Inventor: a cota nunca fica em cima da geometria, sempre projetada
// pra fora com uma seta dupla ligando as 2 linhas de extensão (DIM_OFFSET_MM,
// a distância inicial até a peça, mora lá em cima junto dos outros
// tamanhos da folha — só usada ao CRIAR a cota; depois disso o offset vira
// um campo comum, arrastável).
const DIM_GAP_MM = 1.2;
const DIM_OVERSHOOT_MM = 2;
const ARROW_LENGTH_MM = 2.2;
const ARROW_HALF_WIDTH_MM = 0.8;

function arrowheadPath(tip: Point, dirX: number, dirY: number): string {
  const baseX = tip.x - dirX * ARROW_LENGTH_MM;
  const baseY = tip.y - dirY * ARROW_LENGTH_MM;
  const px = -dirY;
  const py = dirX;
  const p1x = baseX + px * ARROW_HALF_WIDTH_MM;
  const p1y = baseY + py * ARROW_HALF_WIDTH_MM;
  const p2x = baseX - px * ARROW_HALF_WIDTH_MM;
  const p2y = baseY - py * ARROW_HALF_WIDTH_MM;
  return `M ${tip.x} ${tip.y} L ${p1x} ${p1y} L ${p2x} ${p2y} Z`;
}

function DimensionSvg({
  dim,
  effectiveOffset,
  onDragStart,
  onRemove,
}: {
  dim: { id: string; x1: number; y1: number; x2: number; y2: number; offset: number };
  effectiveOffset: number | null;
  onDragStart: (e: React.PointerEvent<SVGLineElement>, dim: { id: string; x1: number; y1: number; x2: number; y2: number; offset: number }) => void;
  onRemove: () => void;
}) {
  const a = { x: dim.x1, y: dim.y1 };
  const b = { x: dim.x2, y: dim.y2 };
  const length = distance(a, b);
  if (length < 1e-6) return null;

  const ux = (b.x - a.x) / length;
  const uy = (b.y - a.y) / length;
  // Normal CANÔNICA (não escolhe lado aqui) — o lado já está codificado no
  // sinal de offset (positivo/negativo), decidido na criação (outwardSign)
  // e ajustável livremente arrastando (ver handleDimensionPointerDown).
  const nx = -uy;
  const ny = ux;
  const offset = effectiveOffset ?? dim.offset;
  const gap = offset >= 0 ? DIM_GAP_MM : -DIM_GAP_MM;
  const overshoot = offset >= 0 ? DIM_OVERSHOOT_MM : -DIM_OVERSHOOT_MM;

  const dimA = { x: a.x + nx * offset, y: a.y + ny * offset };
  const dimB = { x: b.x + nx * offset, y: b.y + ny * offset };
  const mid = { x: (dimA.x + dimB.x) / 2, y: (dimA.y + dimB.y) / 2 };

  const extAStart = { x: a.x + nx * gap, y: a.y + ny * gap };
  const extAEnd = { x: a.x + nx * (offset + overshoot), y: a.y + ny * (offset + overshoot) };
  const extBStart = { x: b.x + nx * gap, y: b.y + ny * gap };
  const extBEnd = { x: b.x + nx * (offset + overshoot), y: b.y + ny * (offset + overshoot) };

  return (
    <g className="group">
      <line x1={extAStart.x} y1={extAStart.y} x2={extAEnd.x} y2={extAEnd.y} stroke="#455a64" strokeWidth={0.3} />
      <line x1={extBStart.x} y1={extBStart.y} x2={extBEnd.x} y2={extBEnd.y} stroke="#455a64" strokeWidth={0.3} />
      <line x1={dimA.x} y1={dimA.y} x2={dimB.x} y2={dimB.y} stroke="#455a64" strokeWidth={0.3} />
      <path d={arrowheadPath(dimA, -ux, -uy)} fill="#455a64" stroke="none" />
      <path d={arrowheadPath(dimB, ux, uy)} fill="#455a64" stroke="none" />

      {/* Faixa invisível mais larga em cima da linha de cota — alvo de
          arrasto bem mais fácil de acertar que a linha fina de 0.3mm. */}
      <line
        x1={dimA.x}
        y1={dimA.y}
        x2={dimB.x}
        y2={dimB.y}
        stroke="transparent"
        strokeWidth={3}
        vectorEffect="non-scaling-stroke"
        pointerEvents="stroke"
        className="cursor-move"
        onPointerDown={(e) => onDragStart(e, dim)}
      />

      <rect x={mid.x - 8} y={mid.y - 3.5} width={16} height={5.5} fill="white" fillOpacity={0.85} pointerEvents="none" />
      <text x={mid.x} y={mid.y} textAnchor="middle" dominantBaseline="middle" fontSize={4} fill="#263238" pointerEvents="none">
        {length.toFixed(1)}
      </text>

      <text
        x={mid.x + 9}
        y={mid.y - 2}
        fontSize={5}
        fill="#e53935"
        className="cursor-pointer opacity-0 transition-opacity group-hover:opacity-100"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
      >
        ×
      </text>
    </g>
  );
}

// Rótulo/placeholder de cada anotação de clique único — solda tem seu
// próprio fluxo de 2 cliques (ver handleSheetClick) e não entra aqui.
// `prefix` é só um glifo curto pra diferenciar visualmente as 3 no desenho,
// já que as 3 usam o mesmo <text> num ponto — não é notação normalizada.
const ANNOTATION_META: Record<AnnotationKind, { buttonLabel: string; promptLabel: string; placeholder: string; prefix: string }> = {
  text: { buttonLabel: "Texto", promptLabel: "Texto:", placeholder: "Observação", prefix: "" },
  chamfer: { buttonLabel: "Chanfro", promptLabel: "Chanfro (ex.: 2 X 45°):", placeholder: "2 X 45°", prefix: "⌐ " },
  thread: { buttonLabel: "Rosca", promptLabel: "Medida de rosca (ex.: M8 x 1.25):", placeholder: "M8 x 1.25", prefix: "⌀ " },
};

// Anotação de ponto único (texto/chanfro/rosca) é sempre um <text> simples
// arrastável; solda é a única com geometria própria (linha até a junta +
// linha de referência + glifo de filete + texto de medida) — glifo
// SIMPLIFICADO de propósito, não o sistema completo ISO 2553/AWS A2.4 (sem
// cauda, sem "all-around", sem os dezenas de tipos de junta).
function AnnotationSvg({
  annotation,
  effectivePatch,
  onDragStart,
  onRemove,
}: {
  annotation: DrawingAnnotation;
  effectivePatch: AnnotationPatch | null;
  onDragStart: (e: React.PointerEvent<SVGElement>, annotation: DrawingAnnotation) => void;
  onRemove: () => void;
}) {
  if (annotation.kind === "weld") {
    const x1 = effectivePatch?.x1 ?? annotation.x1;
    const y1 = effectivePatch?.y1 ?? annotation.y1;
    const x2 = effectivePatch?.x2 ?? annotation.x2;
    const y2 = effectivePatch?.y2 ?? annotation.y2;
    const len = Math.hypot(x2 - x1, y2 - y1) || 1;
    const ux = (x2 - x1) / len;
    const uy = (y2 - y1) / len;
    const tailX = x2 + ux * 8;
    const tailY = y2 + uy * 8;

    return (
      <g className="group">
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#0d1b2a" strokeWidth={0.3} />
        <path d={arrowheadPath({ x: x1, y: y1 }, -ux, -uy)} fill="#0d1b2a" />
        <line x1={x2} y1={y2} x2={tailX} y2={tailY} stroke="#0d1b2a" strokeWidth={0.3} />
        <path
          d={`M ${x2 + ux} ${y2 + uy} L ${x2 + ux * 4} ${y2 + uy * 4} L ${x2 + ux - uy * 2.6} ${y2 + uy + ux * 2.6} Z`}
          fill="#0d1b2a"
        />
        <text x={tailX + ux * 1.5} y={tailY - 1} fontSize={3.2} fill="#0d1b2a">
          {annotation.text}
        </text>
        <line
          x1={x1}
          y1={y1}
          x2={tailX}
          y2={tailY}
          stroke="transparent"
          strokeWidth={3}
          pointerEvents="stroke"
          className="cursor-move"
          onPointerDown={(e) => onDragStart(e, annotation)}
        />
        <text
          x={tailX + 14}
          y={tailY - 1}
          fontSize={5}
          fill="#e53935"
          className="cursor-pointer opacity-0 transition-opacity group-hover:opacity-100"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          ×
        </text>
      </g>
    );
  }

  const x = effectivePatch?.x ?? annotation.x;
  const y = effectivePatch?.y ?? annotation.y;
  const meta = ANNOTATION_META[annotation.kind];
  const label = `${meta.prefix}${annotation.text}`;

  return (
    <g className="group">
      <circle cx={x} cy={y} r={0.5} fill="#0d1b2a" />
      <rect x={x + 1} y={y - 4.2} width={Math.max(label.length * 2, 6)} height={5} fill="white" fillOpacity={0.85} pointerEvents="none" />
      <text
        x={x + 1.5}
        y={y - 0.8}
        fontSize={3.2}
        fill="#0d1b2a"
        pointerEvents="all"
        className="cursor-move"
        onPointerDown={(e) => onDragStart(e, annotation)}
      >
        {label}
      </text>
      <text
        x={x + 1.5 + label.length * 2 + 2}
        y={y - 0.8}
        fontSize={5}
        fill="#e53935"
        className="cursor-pointer opacity-0 transition-opacity group-hover:opacity-100"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
      >
        ×
      </text>
    </g>
  );
}

// Seletor de vista ao estilo do "cubo de vistas" do Inventor — versão
// simplificada e ESTÁTICA (3 faces clicáveis: superior/direita/frontal,
// visíveis de um único ângulo iso fixo), sem rotação livre nem
// react-three-fiber (a folha inteira é SVG puro, não WebGL). A grade de
// botões embaixo garante acesso às 4 orientações que não aparecem no cubo
// (posterior/esquerda/inferior/isométrica) sem depender de hover em faces
// escondidas.
function ViewCubePicker({
  hasSheetMetal,
  flattened,
  onFlattenedChange,
  onPick,
  onClose,
  computing,
}: {
  hasSheetMetal: boolean;
  flattened: boolean;
  onFlattenedChange: (value: boolean) => void;
  onPick: (orientation: ViewOrientation) => void;
  onClose: () => void;
  computing: boolean;
}) {
  const cubeFaces: { orientation: ViewOrientation; points: string; fill: string }[] = [
    { orientation: "top", points: "45,8 80,28 45,48 10,28", fill: "#dbe9f2" },
    { orientation: "right", points: "80,28 80,68 45,88 45,48", fill: "#b8d2e3" },
    { orientation: "front", points: "10,28 45,48 45,88 10,68", fill: "#c9dced" },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20" onClick={onClose}>
      <div className="w-72 rounded-xl bg-white p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-3 text-sm font-semibold text-primary-900">Inserir Vista</h3>

        <svg viewBox="0 0 90 96" className="mx-auto mb-3 block h-28 w-28">
          {cubeFaces.map((face) => (
            <polygon
              key={face.orientation}
              points={face.points}
              fill={face.fill}
              stroke="#0d1b2a"
              strokeWidth={1}
              className="cursor-pointer transition hover:brightness-95"
              onClick={() => onPick(face.orientation)}
            />
          ))}
        </svg>

        <div className="grid grid-cols-2 gap-1.5 text-xs">
          {(Object.keys(VIEW_ORIENTATION_LABELS) as ViewOrientation[]).map((orientation) => (
            <button
              key={orientation}
              type="button"
              onClick={() => onPick(orientation)}
              className="rounded-lg bg-primary-50 px-2 py-1.5 text-primary-700 hover:bg-primary-100"
            >
              {VIEW_ORIENTATION_LABELS[orientation]}
            </button>
          ))}
        </div>

        {hasSheetMetal && (
          <label className="mt-3 flex items-center gap-1.5 text-xs text-primary-700">
            <input type="checkbox" checked={flattened} onChange={(e) => onFlattenedChange(e.target.checked)} />
            Planificada
          </label>
        )}

        {computing && <p className="mt-2 text-xs text-primary-500">Gerando vista…</p>}

        <button
          type="button"
          onClick={onClose}
          className="mt-3 w-full rounded-lg bg-primary-50 px-3 py-1.5 text-xs text-primary-700 hover:bg-primary-100"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}

// Ao estilo do modelo padrão de folha da Eksteel: tabela de tolerâncias à
// esquerda, logo, campos principais (2 colunas) e um canto de peso/revisão/
// página na ponta direita — dividido em colunas proporcionais à largura do
// PRÓPRIO bloco (que fica só no canto inferior direito da folha, não a
// largura inteira — ver TITLE_BLOCK_WIDTH_RATIO em DrawingSheetWorkspace).
// Não é uma cópia em pixels do modelo de referência, só a mesma estrutura/
// agrupamento de campos.
// Tolerâncias/logo/revisão mais enxutos do que a 1ª tentativa — sobra mais
// espaço absoluto pros campos principais (Nome/Material/etc.), que são os
// que o usuário mais precisa ler/preencher.
const TOL_COL_RATIO = 0.24;
const LOGO_COL_RATIO = 0.12;
const REV_COL_RATIO = 0.12;

// Fonte + hierarquia (rótulo em negrito, valor em peso normal) mais perto
// do modelo de referência — Arial/Helvetica é o mais próximo do que
// software CAD de verdade usa em bloco de título (a fonte exata do print
// não dá pra saber sem o arquivo original, mas essa família + negrito no
// rótulo é o que dá a "cara" de desenho técnico).
const TITLE_BLOCK_FONT = "Arial, Helvetica, sans-serif";

// Texto SVG não quebra linha nem encolhe sozinho — pra rótulos longos (ex.
// "Tubos quadrados e retangulares, perfis cortados", o mais comprido da
// tabela de tolerâncias padrão) não estourarem pra fora da coluna, estima a
// largura natural (aproximação — sem canvas de verdade pra medir a fonte
// de propósito, isso já roda em cima do SVG puro) e, só se ela passar do
// espaço disponível, aplica textLength+lengthAdjust pra comprimir só esse
// texto até caber — rótulos curtos ficam com o espaçamento natural, sem
// esticar à toa.
function fitTextLength(text: string, fontSize: number, maxWidth: number): number | undefined {
  const estimatedWidth = text.length * fontSize * 0.52;
  return estimatedWidth > maxWidth ? maxWidth : undefined;
}

function LabelValue({
  x,
  y,
  label,
  value,
  fontSize,
  textAnchor = "start",
}: {
  x: number;
  y: number;
  label: string;
  value: string;
  fontSize: number;
  textAnchor?: "start" | "middle" | "end";
}) {
  return (
    <text x={x} y={y} fontSize={fontSize} textAnchor={textAnchor} fill="#1a1a1a">
      <tspan fontWeight={700}>{label}: </tspan>
      <tspan fontWeight={400}>{value || "—"}</tspan>
    </text>
  );
}

function TitleBlockSvg({ sheet, x, y, width, height }: { sheet: DrawingSheet; x: number; y: number; width: number; height: number }) {
  const tb = sheet.titleBlock;
  const border = "#333333";
  const strokeProps = { stroke: border, strokeWidth: 0.25 };

  const tolW = width * TOL_COL_RATIO;
  const logoW = width * LOGO_COL_RATIO;
  const revW = width * REV_COL_RATIO;
  const fieldsX = x + tolW + logoW;
  const fieldsW = width - tolW - logoW - revW;
  const revX = fieldsX + fieldsW;
  const col1W = fieldsW * 0.55;

  const toleranceRows = tb.toleranceRows.length > 0 ? tb.toleranceRows : DEFAULT_TOLERANCE_ROWS;
  const tolHeaderH = 4.5;
  const tolRowH = (height - tolHeaderH) / toleranceRows.length;

  const fieldRows: [string, string, string | null, string | null][] = [
    ["Nome", tb.partName, "Código", tb.code],
    ["Material", tb.material, "Acabamento", tb.finish],
    ["Medidas", tb.measurements, "Processos", tb.processes],
    ["Tolerância não especificada", tb.toleranceStandard, null, null],
    ["Tratamento", tb.treatment, "Dureza", tb.hardness],
    ["Projetista", tb.designer, null, null],
    ["Aprovado", tb.approvedBy, null, null],
  ];
  const fieldRowH = height / fieldRows.length;
  // Fonte pequena de propósito — texto SVG não quebra linha sozinho, então
  // uma fonte menor é o que sobra mais CARACTERES cabendo na largura fixa
  // da célula pra valores longos (nome de peça, material etc.), não só
  // "menor visualmente". Linhas baixas (fieldRowH menor, ver
  // TITLE_BLOCK_HEIGHT_MM) também liberam mais folha pra desenho.
  const fieldFontSize = Math.min(2.3, fieldRowH * 0.3);

  const revRows: [string, string][] = [
    ["Peso", tb.weight],
    ["REV", tb.revision],
    ["Data Rev", tb.revisionDate],
    ["Página", tb.page],
  ];
  const revRowH = height / revRows.length;
  const revFontSize = Math.min(2.3, revRowH * 0.2);

  return (
    <g fontFamily={TITLE_BLOCK_FONT}>
      <rect x={x} y={y} width={width} height={height} fill="white" stroke={border} strokeWidth={0.5} />

      {/* Tabela de tolerâncias não especificadas */}
      <text x={x + 1.8} y={y + 3.6} fontSize={2.2} fontWeight={700} fill="#0d1b2a">
        Tolerâncias não especificadas
      </text>
      <line x1={x} y1={y + tolHeaderH} x2={x + tolW} y2={y + tolHeaderH} {...strokeProps} />
      <line x1={x + tolW - 7} y1={y + tolHeaderH} x2={x + tolW - 7} y2={y + height} {...strokeProps} />
      {toleranceRows.map((row, i) => {
        const ry = y + tolHeaderH + tolRowH * i;
        return (
          <g key={i}>
            {i > 0 && <line x1={x} y1={ry} x2={x + tolW} y2={ry} {...strokeProps} />}
            <text
              x={x + 1.8}
              y={ry + tolRowH / 2 + 1}
              fontSize={1.8}
              fill="#263238"
              textLength={fitTextLength(row.label, 1.8, tolW - 7 - 3.6)}
              lengthAdjust={fitTextLength(row.label, 1.8, tolW - 7 - 3.6) ? "spacingAndGlyphs" : undefined}
            >
              {row.label}
            </text>
            <text x={x + tolW - 3.5} y={ry + tolRowH / 2 + 1} textAnchor="middle" fontSize={2.2} fontWeight={700} fill="#263238">
              {row.code}
            </text>
          </g>
        );
      })}
      <line x1={x + tolW} y1={y} x2={x + tolW} y2={y + height} {...strokeProps} />

      {/* Logo */}
      {tb.logoDataUrl ? (
        <image href={tb.logoDataUrl} x={x + tolW + 2} y={y + 2} width={logoW - 4} height={height - 4} preserveAspectRatio="xMidYMid meet" />
      ) : (
        <text x={x + tolW + logoW / 2} y={y + height / 2} textAnchor="middle" fontSize={2.1} fontWeight={700} fill="#cfd8dc">
          LOGO
        </text>
      )}
      <line x1={fieldsX} y1={y} x2={fieldsX} y2={y + height} {...strokeProps} />

      {/* Campos principais */}
      {fieldRows.map(([label1, value1, label2, value2], i) => {
        const ry = y + fieldRowH * i;
        return (
          <g key={i}>
            {i > 0 && <line x1={fieldsX} y1={ry} x2={fieldsX + fieldsW} y2={ry} {...strokeProps} />}
            <LabelValue x={fieldsX + 2} y={ry + fieldRowH / 2 + 1} label={label1} value={value1} fontSize={fieldFontSize} />
            {label2 && (
              <>
                <line x1={fieldsX + col1W} y1={ry} x2={fieldsX + col1W} y2={ry + fieldRowH} {...strokeProps} />
                <LabelValue x={fieldsX + col1W + 2} y={ry + fieldRowH / 2 + 1} label={label2} value={value2 ?? ""} fontSize={fieldFontSize} />
              </>
            )}
          </g>
        );
      })}
      <line x1={revX} y1={y} x2={revX} y2={y + height} {...strokeProps} />

      {/* Peso / revisão / página */}
      {revRows.map(([label, value], i) => {
        const ry = y + revRowH * i;
        return (
          <g key={i}>
            {i > 0 && <line x1={revX} y1={ry} x2={x + width} y2={ry} {...strokeProps} />}
            <LabelValue x={revX + 2} y={ry + revRowH / 2 + 1} label={label} value={value} fontSize={revFontSize} />
          </g>
        );
      })}
    </g>
  );
}

const TITLE_BLOCK_TEXT_FIELDS: { key: Exclude<keyof TitleBlockInfo, "toleranceRows" | "logoDataUrl">; label: string }[] = [
  { key: "partName", label: "Nome" },
  { key: "material", label: "Material" },
  { key: "measurements", label: "Medidas" },
  { key: "code", label: "Código" },
  { key: "finish", label: "Acabamento" },
  { key: "processes", label: "Processos" },
  { key: "toleranceStandard", label: "Tolerância não especificada" },
  { key: "treatment", label: "Tratamento" },
  { key: "hardness", label: "Dureza" },
  { key: "designer", label: "Projetista" },
  { key: "approvedBy", label: "Aprovado" },
  { key: "weight", label: "Peso" },
  { key: "revision", label: "REV" },
  { key: "revisionDate", label: "Data Rev" },
  { key: "page", label: "Página" },
];

function TitleBlockForm({
  sheet,
  onChange,
}: {
  sheet: DrawingSheet;
  onChange: (patch: Partial<DrawingSheet["titleBlock"]>) => void;
}) {
  const tb = sheet.titleBlock;

  function handleLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") onChange({ logoDataUrl: reader.result });
    };
    reader.readAsDataURL(file);
  }

  function updateToleranceRow(index: number, patch: Partial<ToleranceRow>) {
    onChange({ toleranceRows: tb.toleranceRows.map((row, i) => (i === index ? { ...row, ...patch } : row)) });
  }

  function addToleranceRow() {
    onChange({ toleranceRows: [...tb.toleranceRows, { label: "", code: "" }] });
  }

  function removeToleranceRow(index: number) {
    onChange({ toleranceRows: tb.toleranceRows.filter((_, i) => i !== index) });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <span className="text-xs text-primary-500">Logo</span>
        <input type="file" accept="image/*" onChange={handleLogoChange} className="text-xs" />
        {tb.logoDataUrl && (
          <div className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- data URL do usuário, next/image não ajuda aqui */}
            <img src={tb.logoDataUrl} alt="Logo" className="h-10 w-auto rounded border border-primary-100 object-contain" />
            <button type="button" onClick={() => onChange({ logoDataUrl: null })} className="text-xs text-error hover:underline">
              Remover
            </button>
          </div>
        )}
      </div>

      {TITLE_BLOCK_TEXT_FIELDS.map((field) => (
        <label key={field.key} className="flex flex-col gap-1">
          <span className="text-xs text-primary-500">{field.label}</span>
          <input
            type={field.key === "revisionDate" ? "date" : "text"}
            value={tb[field.key]}
            onChange={(e) => onChange({ [field.key]: e.target.value })}
            className="rounded border border-primary-200 px-2 py-1"
          />
        </label>
      ))}

      <div className="flex flex-col gap-1">
        <span className="text-xs text-primary-500">Tabela de tolerâncias</span>
        {tb.toleranceRows.map((row, i) => (
          <div key={i} className="flex items-center gap-1">
            <input
              type="text"
              value={row.label}
              onChange={(e) => updateToleranceRow(i, { label: e.target.value })}
              placeholder="Descrição"
              className="flex-1 rounded border border-primary-200 px-2 py-1 text-xs"
            />
            <input
              type="text"
              value={row.code}
              onChange={(e) => updateToleranceRow(i, { code: e.target.value })}
              placeholder="cód."
              className="w-12 rounded border border-primary-200 px-1 py-1 text-center text-xs"
            />
            <button type="button" onClick={() => removeToleranceRow(i)} title="Remover linha" className="px-1 text-error hover:underline">
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={addToleranceRow}
          className="self-start rounded-lg bg-primary-50 px-2 py-1 text-xs text-primary-700 hover:bg-primary-100"
        >
          + Linha
        </button>
      </div>
    </div>
  );
}
