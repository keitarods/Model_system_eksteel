"use client";

import type { SheetShapeSource } from "@/lib/drawing/shapeSource";
import { generateAutomaticSheets } from "@/lib/drawing/automaticSheets";
import {layoutLeaders,leaderDragPatch} from "@/lib/drawing/leaderLayout";
import {dimensionBounds,windowDimensions,draggedDimensionOffset} from "@/lib/drawing/dimensionSelection";
import {isoFit} from "@/lib/drawing/isoFits";
import {bendAngles,dimensionText,angleBetweenLines} from "@/lib/drawing/angularDimensions";

import { autoDimensions, autoRadiusNotes } from "@/lib/drawing/autoDimensions";
import { CloudProjectsButton } from "@/components/modelador/CloudProjectsButton";
import { serializeDrawing, parseDrawing, DRAWING_EXTENSION } from "@/lib/drawing/documentFormat";
import { selectPdfSheets } from "@/lib/drawing/pdfSheets";
import { drawingSvgDxf } from "@/lib/drawing/svgDxf";
import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { jsPDF } from "jspdf";
import { svg2pdf } from "svg2pdf.js";
import type { StoreApi, UseBoundStore } from "zustand";
import { useDrawingStore, createSheetObject, type AnnotationPatch, type DrawingState } from "@/lib/drawing/store";
import {
  bomTableTopLeft,
  bomTableWidth,
  bomTableHeight,
  bomTemplateFrom,
  cellKey,
  cellValue,
  createBomColumn,
  createBomTable,
  defaultColumnLabel,
  refreshBomRows,
  BOM_COLUMN_LABELS,
  type BomColumn,
  type BomColumnKey,
  type BomTable,
} from "@/lib/drawing/bom";
import {
  AREA_UNIT_LABELS,
  DEFAULT_AREA_UNIT,
  DEFAULT_VOLUME_UNIT,
  VOLUME_UNIT_LABELS,
  type AreaUnit,
  type VolumeUnit,
} from "@/lib/replicad/physicalProperties";
import { loadOpenCascade } from "@/lib/replicad/opencascade";
import { buildDrawingView, buildSectionView, suggestScale, scaleToLabel } from "@/lib/replicad/technicalDrawing";
import { createId, distance } from "@/lib/sketch/render";
import { projectOntoSegment } from "@/lib/sketch/hitTest";
import {
  VIEW_ORIENTATION_LABELS,
  sheetDimensionsMm,
  DEFAULT_TOLERANCE_ROWS,
  type AnnotationKind,
  type DrawingAnnotation,
  type DrawingDimension,
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
import {
  IconAddView,
  IconChamfer,
  IconDimension,
  IconExportPdf,
  IconLoadDoc,
  IconProjectedView,
  IconSaveDoc,
  IconSectionView,
  IconTextTool,
  IconThreadTool,
  IconWeldTool,
} from "@/components/icons/ToolIcons";

// Botão de ferramenta só-ícone (sem rótulo de texto) — ao estilo Inventor:
// glifo + tooltip (title) em vez de texto ao lado, bem mais compacto numa
// barra que já acumula muitas ferramentas (vista/cota/anotação/modelo).
function toolButtonClass(active: boolean): string {
  return `shrink-0 rounded-lg p-2 transition ${
    active ? "bg-primary text-primary-foreground" : "bg-white text-primary-700 hover:bg-primary-100"
  }`;
}

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
  | {kind:"dimensionGroup";dimensions:DrawingDimension[];startClientX:number;startClientY:number}
  | {kind:"selection";start:Point;end:Point;additive:boolean;startClientX:number;startClientY:number}
  | { kind: "view"; viewId: string; startClientX: number; startClientY: number; origX: number; origY: number }
  | { kind: "dimension"; dimensionId: string; nx: number; ny: number; startClientX: number; startClientY: number; startOffset: number }
  | { kind: "annotation"; annotationId: string; startClientX: number; startClientY: number; orig: AnnotationPatch; anchored?:boolean }
  | { kind: "bom"; tableId: string; startClientX: number; startClientY: number; origX: number; origY: number };

// Store de folhas que esta instância do ambiente de Desenho manipula — o
// Modelador passa a da peça, a Montagem passa a dela (ver createDrawingStore
// em src/lib/drawing/store.ts). É um hook do zustand passado como prop, por
// isso o nome `useStore`.
type SheetStore = UseBoundStore<StoreApi<DrawingState>>;

// De onde sai a geometria projetada nas vistas — a única coisa que difere
// entre uma folha de PEÇA e uma de MONTAGEM. O ambiente de Desenho em si
// (vistas, cotas, anotações, bloco de título, PDF) é idêntico nos dois casos.
export type { SheetShapeSource } from "@/lib/drawing/shapeSource";

function useActiveSheet(useStore: SheetStore): { sheet: DrawingSheet | null; sheets: DrawingSheet[] } {
  const sheets = useStore((s) => s.sheets);
  const activeSheetId = useStore((s) => s.activeSheetId);
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

export function DrawingSheetWorkspace({
  useStore = useDrawingStore,
  source: documentSource,
  onClose,
}: {
  onClose?: () => void;
  useStore?: SheetStore;
  source: SheetShapeSource;
}) {
  const { sheet: currentSheet, sheets } = useActiveSheet(useStore);
  const [exportSheet, setExportSheet] = useState<DrawingSheet | null>(null);
  const activeSheet = exportSheet ?? currentSheet;
  const components = documentSource.componentSources?.() ?? [];
  const source = activeSheet?.sourceInstanceId
    ? components.find(c => c.id === activeSheet.sourceInstanceId)?.source ?? {
      kind: "peca" as const, supportsFlatten: false, signature: "missing", buildShape: () => null,
      emptyMessage: "A peça desta folha não está disponível na montagem. Restaure o componente para atualizar o desenho.",
    }
    : documentSource;
  const [pdfScope, setPdfScope] = useState<"current" | "all" | "selected">("current");
  const [pdfSheetIds, setPdfSheetIds] = useState<string[]>([]);
  const [pdfOptionsOpen, setPdfOptionsOpen] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const exportLock = useRef(false);
  const [selectedDimensions,setSelectedDimensions]=useState<string[]>([]);
  const [selectionMode,setSelectionMode]=useState(false);
  const [selectionWindow,setSelectionWindow]=useState<{start:Point;end:Point}|null>(null);
  const [groupOffsets,setGroupOffsets]=useState<Record<string,number>>({});
  const groupOffsetsRef=useRef<Record<string,number>>({});
  const suppressSheetClick=useRef(false);
  useEffect(()=>{setSelectedDimensions([]);setSelectionWindow(null);setGroupOffsets({});groupOffsetsRef.current={};dragRef.current=null;},[currentSheet?.id]);
  const [fitInput,setFitInput]=useState("H7");
  const [fitError,setFitError]=useState<string|null>(null);
  const [editingDimension,setEditingDimension] = useState<{sheetId:string;dimension:DrawingDimension}|null>(null);
  useEffect(()=>{setFitInput(editingDimension?.dimension.fitClass??"H7");setFitError(null);},[editingDimension?.dimension.id]);
  const [replaceAutoSheet, setReplaceAutoSheet] = useState(false);
  const [autoPreview, setAutoPreview] = useState<DrawingSheet[] | null>(null);
  const [autoDetails, setAutoDetails] = useState(true);
  const [toolsExpanded, setToolsExpanded] = useState(false);
  const [sheetZoom, setSheetZoom] = useState(1);
  const [viewportSize, setViewportSize] = useState({width:900,height:600});
  const viewportRef = useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const element=viewportRef.current;
    if(!element) return;
    const observer=new ResizeObserver(entries=>{
      const r=entries[0].contentRect;setViewportSize({width:r.width,height:r.height});
    });
    observer.observe(element);return ()=>observer.disconnect();
  },[]);
  useEffect(()=>{
    const viewport=viewportRef.current;
    if(!viewport)return;
    const wheel=(event:WheelEvent)=>{
      const svg=svgRef.current;
      if(!svg)return;
      event.preventDefault();
      // Keep the current drag's paper coordinates stable until it ends.
      if(dragRef.current)return;
      const before=svg.getBoundingClientRect();
      if(!before.width||!before.height)return;
      const u=(event.clientX-before.left)/before.width;
      const v=(event.clientY-before.top)/before.height;
      const pixels=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?viewport.clientHeight:1);
      const factor=Math.exp(-Math.max(-600,Math.min(600,pixels))*0.0015);
      flushSync(()=>setSheetZoom(zoom=>Math.max(0.5,Math.min(4,zoom*factor))));
      const after=svg.getBoundingClientRect();
      viewport.scrollLeft+=after.left+u*after.width-event.clientX;
      viewport.scrollTop+=after.top+v*after.height-event.clientY;
    };
    viewport.addEventListener('wheel',wheel,{passive:false});
    return ()=>viewport.removeEventListener('wheel',wheel);
  },[]);
  const [mobileProperties, setMobileProperties] = useState(false);
  const addSheet = useStore((s) => s.addSheet);
  const removeSheet = useStore((s) => s.removeSheet);
  const setActiveSheet = useStore((s) => s.setActiveSheet);
  const renameSheet = useStore((s) => s.renameSheet);
  const setSheetSize = useStore((s) => s.setSheetSize);
  const setSheetOrientation = useStore((s) => s.setSheetOrientation);
  const setSheetScale = useStore((s) => s.setSheetScale);
  const addView = useStore((s) => s.addView);
  const updateView = useStore((s) => s.updateView);
  const removeView = useStore((s) => s.removeView);
  const moveView = useStore((s) => s.moveView);
  const addDimension = useStore((s) => s.addDimension);
  const updateDimension = useStore((s) => s.updateDimension);
  const removeDimension = useStore((s) => s.removeDimension);
  const addAnnotation = useStore((s) => s.addAnnotation);
  const updateAnnotation = useStore((s) => s.updateAnnotation);
  const removeAnnotation = useStore((s) => s.removeAnnotation);
  const updateTitleBlock = useStore((s) => s.updateTitleBlock);
  const applyTemplate = useStore((s) => s.applyTemplate);
  const addBomTable = useStore((s) => s.addBomTable);
  const updateBomTable = useStore((s) => s.updateBomTable);
  const removeBomTable = useStore((s) => s.removeBomTable);
  const setBomCell = useStore((s) => s.setBomCell);

  const hasSheetMetal = source.supportsFlatten;
  // Assinatura do modelo atual — comparada com DrawingView.sourceSignature
  // pra saber quais vistas ficaram desatualizadas (ver handleUpdateView/
  // isViewStale). Quem calcula é a fonte (features da peça, ou instâncias +
  // posições da montagem).
  const featuresSignature = source.signature;

  const [pendingFlattened, setPendingFlattened] = useState(false);
  const [computing, setComputing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [angularMode,setAngularMode] = useState(false);
  const [dimensionMode, setDimensionMode] = useState(false);
  const [pendingLinePick, setPendingLinePick] = useState<LineHit | null>(null);
  // "weld" é a única anotação de 2 cliques (ponta da seta + linha de
  // referência) — as outras 3 (texto/chanfro/rosca) são 1 clique só, sem
  // precisar de estado "pendente" entre cliques.
  const [annotationMode, setAnnotationMode] = useState<DrawingAnnotation["kind"] | null>(null);
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
  const [bomDragPreview, setBomDragPreview] = useState<{ tableId: string; x: number; y: number } | null>(null);
  // Célula da Lista de Peças em edição (clique numa célula abre um input
  // por cima dela) — o valor digitado vira um `override` da linha, ver
  // setBomCell/bom.ts.
  const [editingCell, setEditingCell] = useState<{ tableId: string; rowId: string; key: string; value: string } | null>(null);
  // Painel lateral: alterna entre o formulário do bloco de título e o
  // editor de colunas da lista (o "template" da BOM).
  const [sidePanel, setSidePanel] = useState<"titulo" | "lista">("titulo");

  const sheetDims = activeSheet ? sheetDimensionsMm(activeSheet) : { width: 297, height: 210 };

  function clearOtherModes() {
    if(dragRef.current?.kind==="selection"||dragRef.current?.kind==="dimensionGroup"){dragRef.current=null;setGroupOffsets({});groupOffsetsRef.current={};}
    setSelectedDimensions([]);setSelectionWindow(null);setSelectionMode(false);
    setAngularMode(false);
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

  useEffect(() => {
    const cancel = (event: KeyboardEvent) => {
      if (event.key === "Escape") clearOtherModes();
    };
    window.addEventListener("keydown", cancel);
    return () => window.removeEventListener("keydown", cancel);
  }, []);

  useEffect(() => { clearOtherModes(); }, [currentSheet?.id]);

  function setDimensionModeExclusive(on: boolean) {
    clearOtherModes();
    setDimensionMode(on);
  }

  function setAnnotationModeExclusive(mode: DrawingAnnotation["kind"] | null) {
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
      const bends:import("@/lib/replicad/drawingBends").NativeDrawingBend[]=[];
      solid = source.buildShape({ flatten: flattened,onBend:b=>bends.push(b) });
      if (!solid) {
        setErrorMessage(source.emptyMessage);
        return null;
      }
      const raw = buildDrawingView(solid, orientation, flattened,{bends});
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
  async function refreshAutomaticDimensions() {
    if(!activeSheet) return;
    setComputing(true);setErrorMessage(null);
    try {
      await new Promise(resolve=>setTimeout(resolve,30));
      await loadOpenCascade();
      const views:DrawingView[]=[];
      for(const v of activeSheet.views) {
        if(v.sectionInfo){views.push(v);continue;}
        const bends:import("@/lib/replicad/drawingBends").NativeDrawingBend[]=[];
        const shape=source.buildShape({flatten:v.flattened,onBend:b=>bends.push(b)});
        if(!shape) throw new Error(source.emptyMessage);
        try{const fresh=buildDrawingView(shape,v.orientation,v.flattened,{bends});views.push({...fresh,id:v.id,x:v.x,y:v.y,scale:v.scale,scaleLabel:v.scaleLabel,label:v.label,sourceSignature:featuresSignature});}
        finally{shape.delete();}
      }
      const angles=views.flatMap(v=>bendAngles(v,(source.bends??[]).map(b=>b.angle)));
      setReplaceAutoSheet(true);
      setAutoPreview([layoutLeaders({...activeSheet,views,annotations:[...activeSheet.annotations.filter(a=>!a.id.startsWith("auto-radius-")),...views.flatMap(autoRadiusNotes)],dimensions:[...activeSheet.dimensions.filter(d=>!d.automatic),...views.flatMap(v=>autoDimensions(v,autoDetails)),...angles]})]);
      if(source.bends?.length&&!angles.length&&!views.every(v=>v.flattened)) setErrorMessage("Não foi reconhecido um perfil de dobra adequado. Use Cota angular em duas arestas da vista de perfil. Confira também as cotas manuais após atualizar a geometria.");
    }catch(err){setErrorMessage(err instanceof Error?err.message:"Erro ao atualizar cotas.");}
    finally{setComputing(false);}
  }

  async function handleAutoDrawing() {
    setReplaceAutoSheet(false);
    clearOtherModes();
    setComputing(true); setErrorMessage(null);
    try {
      await new Promise(resolve => setTimeout(resolve, 30));
      await loadOpenCascade();
      const template = activeSheet?.sourceInstanceId ? sheets.find(s => !s.sourceInstanceId)?.titleBlock : activeSheet?.titleBlock;
      const generated = await generateAutomaticSheets(documentSource, autoDetails, template);
      setAutoPreview(generated);
    } catch (err) { setErrorMessage(err instanceof Error ? err.message : "Erro na cotagem automática."); }
    finally { setComputing(false); }
  }

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
      solid = source.buildShape({ flatten: baseView.flattened });
      if (!solid) {
        setErrorMessage(source.emptyMessage);
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
        solid = source.buildShape({ flatten: baseView.flattened });
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

  // --- Lista de Peças (BOM) --------------------------------------------
  // Só existe em folha de MONTAGEM (source.bomParts presente). Ao estilo
  // Inventor: a lista nasce encostada em cima do bloco de título, cresce
  // pra cima conforme ganha linhas, e as linhas são um snapshot editável —
  // "Atualizar Lista" recalcula os valores automáticos sem apagar o que foi
  // digitado à mão (ver refreshBomRows).
  function handleInsertBom() {
    if (!activeSheet || !source.bomParts) return;
    setErrorMessage(null);
    try {
      const rows = refreshBomRows([], source.bomParts());
      // Canto inferior direito da área útil, logo ACIMA do bloco de título.
      const table = createBomTable(
        sheetDims.width - SHEET_MARGIN_MM,
        sheetDims.height - SHEET_MARGIN_MM - TITLE_BLOCK_HEIGHT_MM - 2,
        rows
      );
      // x é o canto ESQUERDO da tabela — recua pela largura total pra ela
      // ficar alinhada à direita, igual o bloco de título logo abaixo.
      addBomTable(activeSheet.id, { ...table, x: table.x - bomTableWidth(table) });
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Erro ao gerar a lista de peças.");
    }
  }

  function handleRefreshBom(table: BomTable) {
    if (!activeSheet || !source.bomParts) return;
    setErrorMessage(null);
    try {
      const parts = source.bomParts();
      const rows = table.rowRange
        ? refreshBomRows([], parts).slice(table.rowRange.start, table.rowRange.start + table.rowRange.count).map(row => ({
          ...row, overrides: table.rows.find(old => old.instanceIds.some(id => row.instanceIds.includes(id)))?.overrides ?? {},
        }))
        : refreshBomRows(table.rows, parts);
      updateBomTable(activeSheet.id, table.id, { rows });
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Erro ao atualizar a lista de peças.");
    }
  }

  function handleBomPointerDown(e: React.PointerEvent<SVGElement>, table: BomTable) {
    if (dimensionMode || annotationMode || projectionMode || sectionMode) return;
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragRef.current = {
      kind: "bom",
      tableId: table.id,
      startClientX: e.clientX,
      startClientY: e.clientY,
      origX: table.x,
      origY: table.y,
    };
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
      // Só a moldura da lista (colunas/medidas), nunca as linhas — essas
      // são sempre da montagem específica, ver bomTemplateFrom.
      bom: activeSheet.bomTables?.[0] ? bomTemplateFrom(activeSheet.bomTables[0]) : undefined,
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

  // Render each page with the existing sheet renderer without changing the store's
  // active sheet. Export a snapshot without interaction overlays and always restore
  // the displayed sheet, including when SVG conversion fails.
  async function generateDrawingDocument(kind: "pdf" | "dxf") {
    if (!activeSheet || !svgRef.current) throw new Error("Selecione uma folha para exportar.");
    const filename = `${activeSheet.name || "folha"}.${kind}`;
    if (kind === "dxf") return { filename, body: new Blob([drawingSvgDxf(svgRef.current)], { type: "application/dxf" }) };
    if (computing) throw new Error("Aguarde o cálculo das vistas antes de exportar.");
    if (exportLock.current) throw new Error("Uma exportação já está em andamento.");
    const selected = selectPdfSheets(sheets, currentSheet?.id, pdfScope, pdfSheetIds);
    exportLock.current = true;
    setExportingPdf(true);
    try {
      let pdf: jsPDF | undefined;
      for (const sheet of selected) {
        flushSync(() => setExportSheet(sheet));
        const dims = sheetDimensionsMm(sheet);
        const orientation = dims.width >= dims.height ? "landscape" : "portrait";
        if (!pdf) pdf = new jsPDF({ orientation, unit: "mm", format: [dims.width, dims.height] });
        else pdf.addPage([dims.width, dims.height], orientation);
        if (!svgRef.current) throw new Error("Não foi possível renderizar a folha.");
        const svg = svgRef.current.cloneNode(true) as SVGSVGElement;
        svg.querySelectorAll('[data-drawing-ui]').forEach(el => el.remove());
        await svg2pdf(svg, pdf, { x: 0, y: 0, width: dims.width, height: dims.height });
      }
      return { filename: `${selected.length === 1 ? selected[0].name || "folha" : "desenho"}.pdf`, body: pdf!.output("blob") };
    } finally {
      flushSync(() => setExportSheet(null));
      exportLock.current = false;
      setExportingPdf(false);
    }
  }

  async function handleExportPdf() {
    setErrorMessage(null);
    try {
      const file = await generateDrawingDocument("pdf");
      await saveOrDownload(null, file.body, file.filename);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Erro ao exportar PDF.");
    }
  }
  function handleCloseDrawing() {
    if (computing) return;
    setDimensionMode(false); setPendingLinePick(null);
    setAnnotationMode(null); setPendingWeldPoint(null);
    setViewInsertTarget(null); setViewPickerOpen(false); setContextMenu(null);
    setProjectionMode(false); setProjectionBase(null);
    setSectionMode(false); setSectionBase(null); setPendingSectionPoint(null);
    setPendingFlattened(false); setErrorMessage(null);
    dragRef.current = null;
    onClose?.();
  }

  async function handleDrawingFile(action: "save" | "open" | "dxf") {
    setErrorMessage(null);
    try {
      if (action === "save") await saveOrDownload(null, serializeDrawing(useStore.getState().sheets), `${activeSheet?.name || "desenho"}${DRAWING_EXTENSION}`);
      else if (action === "dxf") {
        const file = await generateDrawingDocument("dxf");
        await saveOrDownload(null, file.body, file.filename);
      } else {
        const picked = await pickFileToOpen([{ description: "Desenho Eksteel", accept: { "application/json": [DRAWING_EXTENSION] } }]);
        if (!picked) return;
        const loaded = parseDrawing(await picked.file.text());
        if (window.confirm("Substituir as folhas atuais pelo desenho aberto?")) useStore.getState().loadSheets(loaded);
      }
    } catch (err) { setErrorMessage(err instanceof Error ? err.message : "Falha ao salvar ou abrir desenho."); }
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
  function handleDimensionPointerDown(e: React.PointerEvent<SVGElement>, dim: DrawingDimension) {
    if(e.button!==0)return;
    e.stopPropagation();
    if(e.ctrlKey||e.metaKey||e.shiftKey){setSelectedDimensions(ids=>ids.includes(dim.id)?ids.filter(id=>id!==dim.id):[...ids,dim.id]);suppressSheetClick.current=true;return;}
    const ids=selectedDimensions.includes(dim.id)?selectedDimensions:[dim.id];setSelectedDimensions(ids);
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    groupOffsetsRef.current={};setGroupOffsets({});
    dragRef.current={kind:"dimensionGroup",dimensions:activeSheet?.dimensions.filter(d=>ids.includes(d.id))??[dim],startClientX:e.clientX,startClientY:e.clientY};
  }
  function handleSelectionStart(e:React.PointerEvent<SVGSVGElement>){
    if(e.button!==0||dimensionMode||annotationMode||projectionMode||sectionMode||!svgRef.current)return;
    if((e.target as Element).closest('[data-dimension-id]'))return;
    if(!selectionMode&&e.target!==e.currentTarget)return;
    e.stopPropagation();e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);
    const point=toSheetPoint(e.currentTarget,e.clientX,e.clientY);
    dragRef.current={kind:'selection',start:point,end:point,additive:e.ctrlKey||e.metaKey||e.shiftKey,startClientX:e.clientX,startClientY:e.clientY};
    setSelectionWindow({start:point,end:point});
  }

  // Anotação translada inteira (1 ponto pras 3 de clique único, os 2 pontos
  // juntos pra solda) — mesmo padrão de handleDimensionPointerDown, sem
  // conflito com o modo Cota pela mesma razão (arrastar uma anotação já
  // colocada não usa o clique-clique de criação).
  function handleAnnotationPointerDown(e: React.PointerEvent<SVGElement>, annotation: DrawingAnnotation) {
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    const orig: AnnotationPatch =
      "x1" in annotation
        ? { x1: annotation.x1, y1: annotation.y1, x2: annotation.x2, y2: annotation.y2 }
        : { x: annotation.x, y: annotation.y };
    dragRef.current = { kind: "annotation", annotationId: annotation.id, startClientX: e.clientX, startClientY: e.clientY, orig, anchored:annotation.kind==="leader"||annotation.kind==="balloon"||annotation.kind==="weld" };
  }

  function handleSheetPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const svg = svgRef.current;
    if (!svg) return;
    const scaleFactor = svg.clientWidth > 0 ? sheetDims.width / svg.clientWidth : 1;
    const dx = (e.clientX - drag.startClientX) * scaleFactor;
    const dy = (e.clientY - drag.startClientY) * scaleFactor;
    if (drag.kind === "selection") {
      drag.end=toSheetPoint(svg,e.clientX,e.clientY);setSelectionWindow({start:drag.start,end:drag.end});return;
    }
    if(drag.kind === "dimensionGroup"){
      const offsets=Object.fromEntries(drag.dimensions.map(d=>[d.id,draggedDimensionOffset(d,dx,dy)]));
      groupOffsetsRef.current=offsets;setGroupOffsets(offsets);return;
    }
    if (drag.kind === "view") {
      setDragPreview({ viewId: drag.viewId, x: drag.origX + dx, y: drag.origY + dy });
    } else if (drag.kind === "dimension") {
      const delta = dx * drag.nx + dy * drag.ny;
      setDimensionDragPreview({ dimensionId: drag.dimensionId, offset: drag.startOffset + delta });
    } else if (drag.kind === "bom") {
      setBomDragPreview({ tableId: drag.tableId, x: drag.origX + dx, y: drag.origY + dy });
    } else {
      const patch: AnnotationPatch =
        drag.orig.x !== undefined
          ? { x: drag.orig.x + dx, y: (drag.orig.y ?? 0) + dy }
          : drag.anchored ? leaderDragPatch({x1:drag.orig.x1??0,y1:drag.orig.y1??0,x2:drag.orig.x2??0,y2:drag.orig.y2??0},dx,dy) : {
              x1: (drag.orig.x1 ?? 0) + (drag.anchored?0:dx),
              y1: (drag.orig.y1 ?? 0) + (drag.anchored?0:dy),
              x2: (drag.orig.x2 ?? 0) + dx,
              y2: (drag.orig.y2 ?? 0) + dy,
            };
      setAnnotationDragPreview({ annotationId: drag.annotationId, patch });
    }
  }

  function handleSheetPointerUp() {
    const drag = dragRef.current;
    if(drag?.kind==='selection'&&activeSheet){
      const ids=windowDimensions(activeSheet.dimensions,drag.start,drag.end);
      setSelectedDimensions(old=>drag.additive?[...new Set([...old,...ids])]:ids);
      setSelectionWindow(null);suppressSheetClick.current=true;
    }
    if(drag?.kind==='dimensionGroup'&&activeSheet){
      const offsets=groupOffsetsRef.current;
      useStore.setState(state=>({sheets:state.sheets.map(sheet=>sheet.id===activeSheet.id?{...sheet,dimensions:sheet.dimensions.map(d=>offsets[d.id]!==undefined?{...d,offset:offsets[d.id]}:d)}:sheet)}));
      setGroupOffsets({});groupOffsetsRef.current={};suppressSheetClick.current=true;
    }
    if (drag?.kind === "view" && dragPreview && activeSheet) {
      moveView(activeSheet.id, drag.viewId, dragPreview.x, dragPreview.y);
    } else if (drag?.kind === "dimension" && dimensionDragPreview && activeSheet) {
      updateDimension(activeSheet.id, drag.dimensionId, { offset: dimensionDragPreview.offset });
    } else if (drag?.kind === "annotation" && annotationDragPreview && activeSheet) {
      updateAnnotation(activeSheet.id, drag.annotationId, annotationDragPreview.patch);
    } else if (drag?.kind === "bom" && bomDragPreview && activeSheet) {
      updateBomTable(activeSheet.id, drag.tableId, { x: bomDragPreview.x, y: bomDragPreview.y });
    }
    dragRef.current = null;
    setDragPreview(null);
    setDimensionDragPreview(null);
    setAnnotationDragPreview(null);
    setBomDragPreview(null);
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
    if(suppressSheetClick.current){suppressSheetClick.current=false;return;}
    if (!activeSheet || !svgRef.current) return;
    const point = toSheetPoint(svgRef.current, e.clientX, e.clientY);

    if (dimensionMode) {
      const hit = findNearestLine(activeSheet, point, LINE_HIT_TOLERANCE_MM);

      if (!pendingLinePick) {
        if (hit) setPendingLinePick(hit);
        return;
      }

      if(angularMode) {
        if(!hit||sameLine(pendingLinePick,hit)) return;
        if(hit.viewId!==pendingLinePick.viewId){setErrorMessage("Selecione duas arestas da mesma vista.");return;}
        const view=activeSheet.views.find(v=>v.id===hit.viewId);
        if(view?.orientation==='iso'){setErrorMessage("Use uma vista ortogonal de perfil para cotar o ângulo.");return;}
        const line=(p:LineHit)=>({x1:p.a.x,y1:p.a.y,x2:p.b.x,y2:p.b.y});
        const dim=angleBetweenLines(hit.viewId,line(pendingLinePick),line(hit));
        if(!dim){setErrorMessage("As arestas são paralelas; escolha duas direções diferentes.");return;}
        addDimension(activeSheet.id,dim);setPendingLinePick(null);setErrorMessage(null);
        setEditingDimension({sheetId:activeSheet.id,dimension:dim});return;
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
          value: distance(a,b)/(owningView?.scale??1),
          offset: DIM_OFFSET_MM * outwardSign(a, b, viewCenter),
        });
      } else {
        if(hit.viewId!==pendingLinePick.viewId){setErrorMessage("Selecione arestas da mesma vista para medir na escala correta.");return;}
        const seg = lineToLineSegment(pendingLinePick, hit);
        addDimension(activeSheet.id, {
          id: createId(),
          viewId: pendingLinePick.viewId,
          ...seg,
          value: Math.hypot(seg.x2-seg.x1,seg.y2-seg.y1)/(owningView?.scale??1),
          offset: DIM_OFFSET_MM * outwardSign({ x: seg.x1, y: seg.y1 }, { x: seg.x2, y: seg.y2 }, viewCenter),
        });
      }
      setPendingLinePick(null);
      return;
    }

    if (annotationMode) {
      const viewId = findContainingView(activeSheet, point)?.id ?? null;

      if (annotationMode === "weld" || annotationMode === "centerline" || annotationMode === "centermark" || annotationMode === "leader" || annotationMode === "balloon") {
        if (!pendingWeldPoint) {
          setPendingWeldPoint(point);
          return;
        }
        const start = pendingWeldPoint;
        setPendingWeldPoint(null);
        if (Math.hypot(point.x - start.x, point.y - start.y) < 0.5) { setPendingWeldPoint(start); return; }
        const text = annotationMode === "centerline" || annotationMode === "centermark" ? "" : window.prompt(
          annotationMode === "weld" ? "Medida da solda:" : annotationMode === "balloon" ? "Identificação do item (texto manual):" : "Nota com chamada:",
          annotationMode === "weld" ? "5" : annotationMode === "balloon" ? "1" : "Observação");
        if (text === null) return;
        addAnnotation(activeSheet.id, { id: createId(), viewId, kind: annotationMode, x1: start.x, y1: start.y, x2: point.x, y2: point.y, text });
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

  const pdfOptions = <fieldset disabled={exportingPdf} className="space-y-2 rounded border border-chrome-border p-3 text-sm">
    <legend>Folhas do PDF</legend>
    <select aria-label="Folhas para exportar em PDF" value={pdfScope} onChange={e => setPdfScope(e.target.value as typeof pdfScope)} className="rounded border p-2">
      <option value="current">Folha atual</option><option value="all">Todas as folhas</option><option value="selected">Selecionar folhas</option>
    </select>
    {pdfScope === "selected" && <div className="max-h-48 overflow-auto">{sheets.map(sheet => <label key={sheet.id} className="flex gap-2 p-1">
      <input type="checkbox" checked={pdfSheetIds.includes(sheet.id)} onChange={e => setPdfSheetIds(ids => e.target.checked ? [...ids, sheet.id] : ids.filter(id => id !== sheet.id))} />{sheet.name}
    </label>)}</div>}
    <p>Um único PDF, na ordem das folhas do arquivo, preservando o tamanho de cada folha.</p>
  </fieldset>;

  return (
    <div className="inventor-drawing flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="inventor-pane-title flex shrink-0 items-center justify-between"><span>Desenho técnico · Documentação</span><span className="font-normal text-slate-500">{activeSheet?.name??'Nenhuma folha ativa'}</span></div>
      <div className="drawing-view-controls">
        <button type="button" aria-expanded={toolsExpanded} onClick={()=>setToolsExpanded(v=>!v)}>{toolsExpanded?'Recolher comandos':'Ferramentas ▾'}</button>
        <select aria-label="Folha ativa" value={activeSheet?.id??''} onChange={e=>setActiveSheet(e.target.value)}>{sheets.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select>
        <button type="button" aria-pressed={mobileProperties} onClick={()=>setMobileProperties(v=>!v)}>Propriedades</button>
        <button type="button" aria-pressed={selectionMode} onClick={()=>{clearOtherModes();setSelectionMode(!selectionMode);}}>Selecionar cotas por janela</button>
        <span>{selectedDimensions.length} cota(s) selecionada(s)</span>
        {!!selectedDimensions.length&&<button type="button" onClick={()=>setSelectedDimensions([])}>Limpar seleção</button>}
        <button type="button" onClick={()=>{setSheetZoom(1);viewportRef.current?.scrollTo({left:0,top:0});}}>Ajustar folha</button>
        <button type="button" aria-label="Diminuir zoom" onClick={()=>setSheetZoom(v=>Math.max(0.5,v-0.25))}>−</button>
        <span>{Math.round(sheetZoom*100)}%</span>
        <button type="button" aria-label="Aumentar zoom" onClick={()=>setSheetZoom(v=>Math.min(4,v+0.25))}>＋</button>
      </div>
      <div style={{display:toolsExpanded?undefined:'none'}} className="cad-drawing-tools flex flex-wrap items-center gap-1 border-b border-primary-100 bg-primary-50 px-3 py-2 text-sm">
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

            <button type="button" className={toolButtonClass(false)} onClick={() => void handleDrawingFile("open")}>Abrir desenho</button>
            <button type="button" className={toolButtonClass(false)} disabled={computing || !onClose}
              onClick={handleCloseDrawing} title="Voltar ao modelo 3D preservando as folhas do projeto">Fechar desenho</button>
            <CloudProjectsButton documentKind="drawing" suggestedName={currentSheet?.name || "desenho"}
              getProject={() => serializeDrawing(useStore.getState().sheets)}
              onOpen={json => useStore.getState().loadSheets(parseDrawing(json))}
              documentOptions={pdfOptions}
              generateDocument={activeSheet ? generateDrawingDocument : undefined} />
        {activeSheet && (
          <>
            <div className="mx-0.5 h-6 w-px shrink-0 bg-primary-200" />
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

            <div className="mx-0.5 h-6 w-px shrink-0 bg-primary-200" />
            <button
              type="button"
              onClick={() => {
                setViewInsertTarget(null);
                setViewPickerOpen(true);
              }}
              title='Adicionar Vista — escolha a orientação num seletor de vistas (igual botão direito → "Inserir Vista", só que sempre no centro da folha)'
              className={toolButtonClass(viewPickerOpen)}
            >
              <IconAddView /><span>Vista base</span>
            </button>
            <button
              type="button"
              onClick={() => setDimensionModeExclusive(!dimensionMode)}
              className={toolButtonClass(dimensionMode)}
              title="Cota — clique numa aresta pra cotar o comprimento dela, ou em 2 arestas diferentes pra cotar a distância entre as duas"
            >
              <IconDimension /><span>Cota linear</span>
            </button>
            <button
              type="button"
              onClick={() => setProjectionModeExclusive(!projectionMode)}
              className={toolButtonClass(projectionMode)}
              title="Vista Projetada — clique numa vista já na folha e depois num ponto pra cima/baixo/esquerda/direita pra projetar uma vista alinhada a partir dela"
            >
              <IconProjectedView /><span>Projetada</span>
            </button>
            <button
              type="button"
              onClick={() => setSectionModeExclusive(!sectionMode)}
              className={toolButtonClass(sectionMode)}
              title="Seção de Corte — clique numa vista, depois 2 pontos sobre ela pra desenhar a linha de corte (corta o sólido de verdade e gera a vista de seção)"
            >
              <IconSectionView /><span>Corte</span>
            </button>

            <div className="mx-0.5 h-6 w-px shrink-0 bg-primary-200" />
            <button
              type="button"
              onClick={() => setAnnotationModeExclusive(annotationMode === "text" ? null : "text")}
              className={toolButtonClass(annotationMode === "text")}
              title={`Texto — ${ANNOTATION_META.text.promptLabel}`}
            >
              <IconTextTool /><span>Texto</span>
            </button>
            <button
              type="button"
              onClick={() => setAnnotationModeExclusive(annotationMode === "chamfer" ? null : "chamfer")}
              className={toolButtonClass(annotationMode === "chamfer")}
              title={`Chanfro — ${ANNOTATION_META.chamfer.promptLabel}`}
            >
              <IconChamfer /><span>Chanfro</span>
            </button>
            <button
              type="button"
              onClick={() => setAnnotationModeExclusive(annotationMode === "thread" ? null : "thread")}
              className={toolButtonClass(annotationMode === "thread")}
              title={`Medida de Rosca — ${ANNOTATION_META.thread.promptLabel}`}
            >
              <IconThreadTool /><span>Rosca</span>
            </button>
            <button
              type="button"
              onClick={() => setAnnotationModeExclusive(annotationMode === "weld" ? null : "weld")}
              className={toolButtonClass(annotationMode === "weld")}
              title="Simbologia de Solda — clique no ponto da junta, depois no fim da linha de referência"
            >
              <IconWeldTool /><span>Solda</span>
            </button>

            <div className="mx-0.5 h-6 w-px shrink-0 bg-primary-200" />
            <div className="drawing-annotation-group" role="group" aria-label="Centros e chamadas">
              {EXTRA_ANNOTATIONS.map(tool => <button key={tool.kind} type="button"
                aria-pressed={annotationMode === tool.kind} title={tool.hint}
                className={toolButtonClass(annotationMode === tool.kind)}
                onClick={() => setAnnotationModeExclusive(annotationMode === tool.kind ? null : tool.kind)}>
                <span aria-hidden="true" className="text-lg">{tool.icon}</span><span>{tool.label}</span>
              </button>)}
            </div>
            <button type="button" className={toolButtonClass(false)} onClick={() => void handleDrawingFile("save")} title="Salvar todas as folhas editáveis em .eksdesenho">Salvar desenho</button>

            <button type="button" className={toolButtonClass(false)} onClick={() => void handleDrawingFile("dxf")} title="DXF em escala de folha; curvas aproximadas por segmentos, sem imagens">Exportar DXF</button>

            <button
              type="button"
              onClick={handleSaveTemplate}
              title="Salvar Modelo de Folha — tamanho + bloco de título (com logo/tolerâncias) reutilizável em outros projetos"
              className={toolButtonClass(false)}
            >
              <IconSaveDoc /><span>Salvar modelo</span>
            </button>
            <button
              type="button"
              onClick={handleLoadTemplate}
              title="Carregar Modelo de Folha — aplica um modelo salvo antes na folha atual"
              className={toolButtonClass(false)}
            >
              <IconLoadDoc /><span>Abrir modelo</span>
            </button>
            <button
              type="button"
              onClick={() => setPdfOptionsOpen(v => !v)}
              title="Exportar PDF — folha inteira (vistas, cotas, anotações e bloco de título), vetorial"
              className={toolButtonClass(false)}
            >
              <IconExportPdf /><span>PDF</span>
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

      {pdfOptionsOpen && <div className="space-y-2 border-b p-3">
        {pdfOptions}
        <button type="button" disabled={exportingPdf || (pdfScope === "selected" && !sheets.some(s => pdfSheetIds.includes(s.id)))} className="rounded border px-3 py-2 disabled:opacity-40" onClick={() => void handleExportPdf()}>Baixar PDF</button>
        <p className="text-sm">Para salvar direto na pasta de PDFs da nuvem, abra Projetos na nuvem, escolha a pasta e use Gerar e enviar PDF.</p>
      </div>}
      {exportingPdf && <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40" role="status" aria-live="polite"><span className="rounded bg-white p-4 text-black">Gerando PDF…</span></div>}
      {activeSheet && <div className="drawing-command-guide" role="status">
        <span>{annotationMode ? (EXTRA_ANNOTATIONS.find(t => t.kind === annotationMode)?.hint ?? "Clique na folha para inserir a anotação.") : angularMode ? "Cota angular: selecione duas arestas da mesma vista de perfil. O ângulo será medido na projeção." : dimensionMode ? "Selecione uma aresta reta; clique novamente para cotar seu comprimento ou escolha outra aresta." : sectionMode ? "Selecione a vista e dois pontos para definir o corte." : projectionMode ? "Selecione a vista base e clique na direção da projeção." : "Arraste no espaço vazio para selecionar cotas. Ctrl/Shift adiciona ou remove. Arraste uma cota selecionada para mover o conjunto. Duplo clique edita cotas e anotações. Botão direito abre mais opções."}
          {pendingWeldPoint && " Primeiro ponto definido. Clique no segundo ponto."}</span>
        {(annotationMode || dimensionMode || sectionMode || projectionMode) && <button type="button" onClick={clearOtherModes}>Cancelar · Esc</button>}
      </div>}
      <div className="drawing-command-guide">
        <button type="button" disabled={computing} onClick={() => void handleAutoDrawing()}>{computing ? "Gerando vistas…" : "Gerar cotas automaticamente"}</button>
        <button type="button" disabled={!activeSheet || computing} onClick={()=>void refreshAutomaticDimensions()}>Atualizar e reorganizar cotas</button>
        <button type="button" aria-pressed={angularMode} onClick={()=>{clearOtherModes();setDimensionMode(true);setAngularMode(true);}}>Cota angular · 2 arestas</button>
        <select aria-label="Editar cota existente" value="" onChange={e=>{const dim=activeSheet?.dimensions.find(d=>d.id===e.target.value);if(dim&&activeSheet)setEditingDimension({sheetId:activeSheet.id,dimension:{...dim}});}}>
          <option value="">Editar cota…</option>{activeSheet?.dimensions.map((d,i)=><option key={d.id} value={d.id}>{i+1}. {d.angular?'Ângulo':'Linear'} · {dimensionText(d,Math.hypot(d.x2-d.x1,d.y2-d.y1))}</option>)}
        </select>
        <label><input type="checkbox" checked={autoDetails} onChange={e=>setAutoDetails(e.target.checked)} /> Detalhamento seletivo de contorno e abas</label>
        <span>{documentSource.componentSources ? "Montagem com lista de materiais e folhas cotadas das peças" : hasSheetMetal ? "Duas folhas: planificada e dobrada" : "Nova folha com vistas ortogonais e isométrica"}</span>
      </div>
      {editingDimension && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Editar cota">
        <form onKeyDown={e=>{if(e.key==="Escape"){e.stopPropagation();setEditingDimension(null);}}} className="max-h-[90vh] overflow-y-auto w-full max-w-lg rounded border border-slate-400 bg-slate-50 shadow-xl" onSubmit={e=>{e.preventDefault();updateDimension(editingDimension.sheetId,editingDimension.dimension.id,editingDimension.dimension);setEditingDimension(null);}}>
          <header className="border-b bg-slate-200 px-4 py-3 font-semibold">Editar cota · {editingDimension.dimension.angular?'Angular':'Linear'}</header>
          <div className="grid grid-cols-2 gap-3 p-4 text-sm">
            <p className="col-span-2 rounded border bg-white p-3">Valor medido: <strong>{dimensionText({...editingDimension.dimension,prefix:'',suffix:'',toleranceUpper:undefined,toleranceLower:undefined},Math.hypot(editingDimension.dimension.x2-editingDimension.dimension.x1,editingDimension.dimension.y2-editingDimension.dimension.y1))}</strong></p>
            {(['prefix','suffix'] as const).map(key=><label key={key}>{key==='prefix'?'Prefixo':'Sufixo'}<input className="mt-1 w-full rounded border bg-white p-2" autoFocus={key==='prefix'} maxLength={30} value={editingDimension.dimension[key]??''} onChange={e=>setEditingDimension({...editingDimension,dimension:{...editingDimension.dimension,[key]:e.target.value}})}/></label>)}
            <label>Casas decimais<select className="mt-1 w-full rounded border bg-white p-2" value={editingDimension.dimension.precision??2} onChange={e=>setEditingDimension({...editingDimension,dimension:{...editingDimension.dimension,precision:Number(e.target.value)}})}>{[0,1,2,3,4].map(n=><option key={n}>{n}</option>)}</select></label>
            <label>{editingDimension.dimension.angular?'Raio do arco (mm)':'Afastamento (mm)'}<input required type="number" step="0.5" min={editingDimension.dimension.angular?6:-100} max={100} className="mt-1 w-full rounded border bg-white p-2" value={editingDimension.dimension.offset} onChange={e=>setEditingDimension({...editingDimension,dimension:{...editingDimension.dimension,offset:Number(e.target.value)}})}/></label>
            {!editingDimension.dimension.angular && <fieldset className="col-span-2 rounded border bg-white p-3">
              <legend>Ajuste ISO 286 · furo/eixo</legend>
              <div className="flex gap-2"><input aria-label="Classe de ajuste" list="fit-classes" className="w-24 rounded border p-2" value={fitInput} onChange={e=>{setFitInput(e.target.value);setFitError(null);}}/><datalist id="fit-classes">{['H','h','JS','js'].flatMap(f=>Array.from({length:18},(_,i)=><option key={f+i} value={f+(i+1)}/>))}</datalist>
                <button type="button" className="rounded border px-3" onClick={()=>{try{
                  const d=editingDimension.dimension;if(d.value===undefined)throw new Error("Cota antiga sem medida real. Gere novamente antes de aplicar ajuste ISO.");
                  const fit=isoFit(d.value,fitInput.trim());setEditingDimension({...editingDimension,dimension:{...d,fitClass:fit.code,toleranceUpper:fit.upper,toleranceLower:-fit.lower,tolerancePrecision:6}});setFitError(null);
                }catch(error){setFitError(error instanceof Error?error.message:'Classe inválida');}}}>Calcular</button>
                <button type="button" onClick={()=>{setEditingDimension({...editingDimension,dimension:{...editingDimension.dimension,fitClass:undefined}});setFitError(null);}}>Manual</button>
              </div>
              <p className="mt-2 text-xs">H/JS: furo · h/js: eixo. Tabela disponível até 500 mm. Outras classes não são calculadas por aproximação.</p>
              {fitError&&<p role="alert" className="text-xs text-red-700">{fitError}</p>}
              {editingDimension.dimension.fitClass&&<p className="mt-2 text-xs">Limites: {((editingDimension.dimension.value??0)-(editingDimension.dimension.toleranceLower??0)).toFixed(6)} a {((editingDimension.dimension.value??0)+(editingDimension.dimension.toleranceUpper??0)).toFixed(6)} mm</p>}
            </fieldset>}
            <label>Decimais da tolerância<select className="w-full rounded border p-2" value={editingDimension.dimension.tolerancePrecision??4} onChange={e=>setEditingDimension({...editingDimension,dimension:{...editingDimension.dimension,tolerancePrecision:Number(e.target.value)}})}>{[0,1,2,3,4,5,6].map(n=><option key={n}>{n}</option>)}</select></label>
            {(['toleranceUpper','toleranceLower'] as const).map(key=><label key={key}>Desvio {key==='toleranceUpper'?'superior':'inferior'} (assinado)<input type="number" step="any" disabled={!!editingDimension.dimension.fitClass} className="mt-1 w-full rounded border bg-white p-2 disabled:bg-slate-100" value={editingDimension.dimension[key]===undefined?'':(key==='toleranceLower'?-1:1)*editingDimension.dimension[key]!} onChange={e=>setEditingDimension({...editingDimension,dimension:{...editingDimension.dimension,[key]:e.target.value===''?undefined:(key==='toleranceLower'?-1:1)*Number(e.target.value)}})}/></label>)}
            <p className="col-span-2 text-xs text-slate-600">O valor geométrico é preservado. A cota angular mede a abertura entre as laterais no perfil, não o giro da operação de dobra.</p>
          </div>
          <footer className="flex justify-end gap-2 border-t p-3"><button type="button" className="mr-auto text-red-700" onClick={()=>{removeDimension(editingDimension.sheetId,editingDimension.dimension.id);setEditingDimension(null);}}>Excluir</button><button type="button" className="rounded border px-3 py-1" onClick={()=>setEditingDimension(null)}>Cancelar</button><button className="rounded bg-blue-700 px-4 py-1 text-white">Aplicar</button></footer>
        </form>
      </div>}
      {autoPreview && <div className="fixed inset-0 z-50 overflow-auto bg-black/50 p-4" role="dialog" aria-modal="true" aria-label="Prévia da cotagem automática">
        <div className="mx-auto max-w-5xl rounded bg-white p-4 text-slate-800">
          <h2 className="text-lg font-semibold">Revisar cotagem automática</h2>
          {!!source.bends?.length && autoPreview.some(s=>s.views.some(v=>!v.flattened)) && <div className="my-2 rounded border bg-slate-50 p-3 text-sm">
            <strong>Conferência das dobras do modelo</strong>
            {source.bends.map((bend,index)=>{
              const found=autoPreview.some(s=>s.dimensions.some(d=>d.bendId===bend.id && !!bend.id));
              return <p key={bend.id??index} className={found?'text-green-800':'text-amber-800'}>{found?'✓':'⚠'} {bend.label}: {found?'cota angular vinculada':'sem cota angular — precisa de vista de perfil adequada ou cotagem manual'}</p>;
            })}
          </div>}
          <p className="my-2 text-sm">Cotas gerais e trechos principais do contorno visível em mm. Detalhes pequenos ou sem espaço são deixados para cotagem manual. Posições de furos e tolerâncias precisam de revisão e complementação. Dobras nativas incluem tabela com comprimento de aba e ângulo da operação; ângulos não são inferidos de uma projeção. As cotas são editáveis e representam a geometria no momento da geração.</p>
          {autoPreview.map(sheet=><div key={sheet.id}><h3>{sheet.name} · {sheet.dimensions.length} cotas</h3>
            <svg viewBox="0 0 420 297" className="my-2 w-full border bg-white">
              <rect x="8" y="8" width="404" height="281" fill="none" stroke="#aaa" strokeWidth="0.3" />
              {sheet.views.map(v=><g key={v.id} transform={`translate(${v.x} ${v.y}) scale(${v.scale}) translate(${-v.box.minX-v.box.width/2} ${-v.box.minY-v.box.height/2})`} fill="none" stroke="#263238" strokeWidth={0.3/v.scale}>{v.visiblePaths.map((d,i)=><path key={i} d={d}/>)}</g>)}
              {sheet.bomTables?.map(table => <BomTableSvg key={table.id} table={table} effective={null} onDragStart={()=>{}} onEditCell={()=>{}} onRefresh={()=>{}} onRemove={()=>{}} />)}
              {sheet.annotations.map(annotation=><AnnotationSvg key={annotation.id} annotation={annotation} effectivePatch={null} onDragStart={()=>{}} onRemove={()=>{}} />)}
              {sheet.dimensions.map(dim=><DimensionSvg key={dim.id} dim={dim} effectiveOffset={null} onDragStart={()=>{}} onRemove={()=>{}} />)}
            </svg></div>)}
          <div className="sticky bottom-0 flex gap-3 border-t bg-white py-3">
            <button className="rounded bg-blue-700 px-4 py-2 text-white" onClick={()=>{if(replaceAutoSheet) useStore.setState(state=>({sheets:state.sheets.map(sheet=>autoPreview.find(p=>p.id===sheet.id)??sheet)}));else autoPreview.forEach(addSheet);setAutoPreview(null);}}>{replaceAutoSheet?"Aplicar à folha atual":`Inserir ${autoPreview.length} folha(s)`}</button>
            <button onClick={()=>setAutoPreview(null)}>Descartar</button>
          </div>
        </div>
      </div>}
      {errorMessage && (
        <p className="border-b border-error/20 bg-error/10 px-3 py-2 text-sm text-error">{errorMessage}</p>
      )}

      <div className="flex min-h-0 flex-1">
        <nav id="drawing-sheet-browser" className="inventor-sheet-browser" aria-label="Navegador de folhas"><div className="inventor-pane-title">Desenho · Folhas</div>{sheets.map(sheet=><div key={sheet.id}><button type="button" aria-current={sheet.id===activeSheet?.id?'page':undefined} onClick={()=>setActiveSheet(sheet.id)}><span aria-hidden="true">▱</span>{sheet.name}</button><small>{sheet.views.length} vista(s)</small></div>)}<button type="button" onClick={()=>addSheet(createSheetObject(`Folha ${sheets.length+1}`))}>＋ Nova folha</button></nav>
        <div ref={viewportRef} title="Roda do mouse: aproximar ou afastar a folha" className="inventor-drawing-canvas min-h-0 min-w-0 flex-1 overflow-auto bg-primary-100/40 p-2">
          {activeSheet ? (
            <svg
              ref={svgRef}
              viewBox={`0 0 ${sheetDims.width} ${sheetDims.height}`}
              className="mx-auto block touch-none bg-white shadow-lg"
              style={{ width: Math.max(100,Math.min(viewportSize.width-16,(viewportSize.height-16)*sheetDims.width/sheetDims.height))*sheetZoom, maxWidth:"none" }}
              onPointerDownCapture={handleSelectionStart}
              onPointerCancel={()=>{dragRef.current=null;setSelectionWindow(null);setGroupOffsets({});groupOffsetsRef.current={};}}
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

              <rect pointerEvents="none" x={0.5} y={0.5} width={sheetDims.width - 1} height={sheetDims.height - 1} fill="white" stroke="#333" strokeWidth={0.5} />
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
                  effectiveOffset={groupOffsets[dim.id]??(dimensionDragPreview?.dimensionId === dim.id ? dimensionDragPreview.offset : null)}
                  onDragStart={handleDimensionPointerDown}
                  onRemove={() => removeDimension(activeSheet.id, dim.id)}
                  onEdit={()=>setEditingDimension({sheetId:activeSheet.id,dimension:{...dim}})}
                />
              ))}

              <g data-drawing-ui="selection" pointerEvents="none">
                {activeSheet.dimensions.filter(d=>selectedDimensions.includes(d.id)).map(d=>{const b=dimensionBounds({...d,offset:groupOffsets[d.id]??d.offset});return <rect key={d.id} x={b.x-1} y={b.y-1} width={b.right-b.x+2} height={b.bottom-b.y+2} fill="#2386d7" fillOpacity={0.08} stroke="#2386d7" strokeWidth={0.35}/>;})}
                {selectionWindow&&<rect x={Math.min(selectionWindow.start.x,selectionWindow.end.x)} y={Math.min(selectionWindow.start.y,selectionWindow.end.y)} width={Math.abs(selectionWindow.end.x-selectionWindow.start.x)} height={Math.abs(selectionWindow.end.y-selectionWindow.start.y)} fill={selectionWindow.end.x>=selectionWindow.start.x?'#2386d7':'#229455'} fillOpacity={0.12} stroke="#2386d7" strokeWidth={0.4} strokeDasharray={selectionWindow.end.x<selectionWindow.start.x?'2 1':undefined}/>}
              </g>
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
                <g key={annotation.id} onDoubleClick={e => {
                  e.stopPropagation();
                  if (annotation.kind === "centerline" || annotation.kind === "centermark") return;
                  const text = window.prompt("Editar anotação:", annotation.text);
                  if (text !== null) updateAnnotation(activeSheet.id, annotation.id, {text});
                }}>
                <AnnotationSvg
                  annotation={annotation}
                  effectivePatch={annotationDragPreview?.annotationId === annotation.id ? annotationDragPreview.patch : null}
                  onDragStart={handleAnnotationPointerDown}
                  onRemove={() => removeAnnotation(activeSheet.id, annotation.id)}
                /></g>
              ))}

              {pendingWeldPoint && <circle cx={pendingWeldPoint.x} cy={pendingWeldPoint.y} r={1} fill="#e53935" />}

              {(activeSheet.bomTables ?? []).map((table) => (
                <BomTableSvg
                  key={table.id}
                  table={table}
                  effective={bomDragPreview?.tableId === table.id ? bomDragPreview : null}
                  onDragStart={handleBomPointerDown}
                  onEditCell={(rowId, key, current) =>
                    setEditingCell({ tableId: table.id, rowId, key, value: current })
                  }
                  onRefresh={() => handleRefreshBom(table)}
                  onRemove={() => {
                    if (window.confirm("Remover a lista de peças desta folha?")) removeBomTable(activeSheet.id, table.id);
                  }}
                />
              ))}

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
          <div className={`inventor-drawing-properties w-64 max-w-[45vw] shrink-0 overflow-y-auto border-l border-primary-100 bg-white p-3 text-sm ${mobileProperties ? "" : "hidden"}`}>
            <h2 className="inventor-pane-title mb-3">Propriedades da folha</h2>
            {source.bomParts ? (
              <div className="mb-3 flex gap-1">
                <button
                  type="button"
                  onClick={() => setSidePanel("titulo")}
                  className={`flex-1 rounded-lg px-2 py-1 text-xs font-semibold ${
                    sidePanel === "titulo" ? "bg-primary text-primary-foreground" : "bg-primary-50 text-primary-700"
                  }`}
                >
                  Bloco de Título
                </button>
                <button
                  type="button"
                  onClick={() => setSidePanel("lista")}
                  className={`flex-1 rounded-lg px-2 py-1 text-xs font-semibold ${
                    sidePanel === "lista" ? "bg-primary text-primary-foreground" : "bg-primary-50 text-primary-700"
                  }`}
                >
                  Lista de Peças
                </button>
              </div>
            ) : (
              <h3 className="mb-2 font-semibold text-primary-900">Bloco de Título</h3>
            )}

            {sidePanel === "lista" && source.bomParts ? (
              <BomColumnsForm
                tables={activeSheet.bomTables ?? []}
                onInsert={handleInsertBom}
                onChange={(tableId, patch) => updateBomTable(activeSheet.id, tableId, patch)}
                onRefresh={handleRefreshBom}
              />
            ) : (
              <TitleBlockForm sheet={activeSheet} onChange={(patch) => updateTitleBlock(activeSheet.id, patch)} />
            )}
          </div>
        )}
      </div>

      {/* Edição de célula da Lista de Peças — o valor digitado vira um
          override da linha (sobrevive a "Atualizar Lista"); apagar tudo e
          confirmar volta a célula pro valor calculado. */}
      {editingCell && activeSheet && (
        <>
          <div className="fixed inset-0 z-40 bg-black/20" onClick={() => setEditingCell(null)} />
          <div className="fixed left-1/2 top-1/3 z-50 w-80 -translate-x-1/2 rounded-xl border border-primary-100 bg-white p-4 shadow-2xl">
            <h4 className="mb-2 text-sm font-semibold text-primary-900">Editar célula</h4>
            <input
              autoFocus
              value={editingCell.value}
              onChange={(e) => setEditingCell({ ...editingCell, value: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  setBomCell(activeSheet.id, editingCell.tableId, editingCell.rowId, editingCell.key, editingCell.value);
                  setEditingCell(null);
                } else if (e.key === "Escape") {
                  setEditingCell(null);
                }
              }}
              className="w-full rounded-lg border border-primary-200 px-2 py-1.5 text-sm"
            />
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingCell(null)}
                className="rounded-lg bg-primary-50 px-3 py-1.5 text-xs text-primary-700"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  setBomCell(activeSheet.id, editingCell.tableId, editingCell.rowId, editingCell.key, editingCell.value);
                  setEditingCell(null);
                }}
                className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
              >
                Aplicar
              </button>
            </div>
          </div>
        </>
      )}

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
const DIM_GAP_MM = 0.8;
const DIM_OVERSHOOT_MM = 1.5;
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

export function DimensionSvg({
  dim,
  effectiveOffset,
  onDragStart,
  onRemove,
  onEdit,
}: {
  onEdit?:()=>void;
  dim: DrawingDimension;
  effectiveOffset: number | null;
  onDragStart: (e: React.PointerEvent<SVGElement>, dim: DrawingDimension) => void;
  onRemove: () => void;
}) {
  if(dim.angular) {
    const {start,delta}=dim.angular,r=Math.max(6,Math.abs(effectiveOffset??dim.offset));
    const point=(angle:number,radius=r)=>({x:dim.x1+Math.cos(angle)*radius,y:dim.y1+Math.sin(angle)*radius});
    const a=point(start),b=point(start+delta),text=point(start+delta/2,r+4);
    const path=`M ${a.x} ${a.y} A ${r} ${r} 0 0 ${delta>0?1:0} ${b.x} ${b.y}`;
    return <g data-dimension-id={dim.id} onPointerDown={e=>onDragStart(e,dim)} onDoubleClick={e=>{e.stopPropagation();onEdit?.();}}>
      {[start,start+delta].map(angle=>{const p=point(angle,r+2);return <line key={angle} x1={dim.x1} y1={dim.y1} x2={p.x} y2={p.y} stroke="#455a64" strokeWidth={0.25}/>;})}
      <path d={path} fill="none" stroke="#455a64" strokeWidth={0.3}/>
      <path d={arrowheadPath(a,Math.sin(start)*Math.sign(delta),-Math.cos(start)*Math.sign(delta))} fill="#455a64"/>
      <path d={arrowheadPath(b,-Math.sin(start+delta)*Math.sign(delta),Math.cos(start+delta)*Math.sign(delta))} fill="#455a64"/>
      <path d={path} fill="none" stroke="transparent" strokeWidth={5} className="cursor-pointer"/>
      <text x={text.x} y={text.y} textAnchor="middle" fontSize={3.5} fill="#263238" className="cursor-pointer">{dimensionText(dim)}</text>
    </g>;
  }
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

  const extAStart = { x: (dim.reference1?.x ?? a.x) + nx * gap, y: (dim.reference1?.y ?? a.y) + ny * gap };
  const extAEnd = { x: a.x + nx * (offset + overshoot), y: a.y + ny * (offset + overshoot) };
  const extBStart = { x: (dim.reference2?.x ?? b.x) + nx * gap, y: (dim.reference2?.y ?? b.y) + ny * gap };
  const extBEnd = { x: b.x + nx * (offset + overshoot), y: b.y + ny * (offset + overshoot) };

  return (
    <g data-dimension-id={dim.id} className="group" onPointerDown={e=>onDragStart(e,dim)} onDoubleClick={e=>{e.stopPropagation();onEdit?.();}}>
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

      <rect x={mid.x - Math.max(16,dimensionText(dim,length).length*2)/2} y={mid.y - 3.5} width={Math.max(16,dimensionText(dim,length).length*2)} height={5.5} fill="white" fillOpacity={0.85} pointerEvents="none" />
      <text x={mid.x} y={mid.y} textAnchor="middle" dominantBaseline="middle" fontSize={4} fill="#263238" pointerEvents="none">
        {dimensionText(dim,length)}
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
  if ("x1" in annotation && annotation.kind !== "weld") {
    const x1 = effectivePatch?.x1 ?? annotation.x1, y1 = effectivePatch?.y1 ?? annotation.y1;
    const x2 = effectivePatch?.x2 ?? annotation.x2, y2 = effectivePatch?.y2 ?? annotation.y2;
    const length = Math.hypot(x2-x1, y2-y1) || 1;
    const radius = Math.max(4, annotation.text.length * 1.1);
    return <g className="group" stroke="#0d1b2a" strokeWidth={0.25} fill="none"
      onPointerDown={e => onDragStart(e, annotation)} onClick={e => e.stopPropagation()}>
      {annotation.kind === "centermark" ? <>
        <line x1={x1-length} y1={y1} x2={x1+length} y2={y1} strokeDasharray="5 1 1 1" />
        <line x1={x1} y1={y1-length} x2={x1} y2={y1+length} strokeDasharray="5 1 1 1" />
        <circle cx={x1} cy={y1} r={length} stroke="transparent" strokeWidth={3} />
      </> : <>
        <line x1={x1} y1={y1} x2={x2} y2={y2} strokeDasharray={annotation.kind === "centerline" ? "7 1.5 1 1.5" : undefined} />
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth={3} className="cursor-move" />
        {annotation.kind !== "centerline" && <path d={arrowheadPath({x:x1,y:y1}, (x1-x2)/length, (y1-y2)/length)} fill="#0d1b2a" />}
        {annotation.kind === "balloon" && <circle cx={x2} cy={y2} r={radius} fill="white" />}
        {(annotation.kind === "balloon" || annotation.kind === "leader") && <text x={x2 + (annotation.kind === "leader" ? 2 : 0)} y={y2 + (annotation.kind === "balloon" ? 1 : -1)} textAnchor={annotation.kind === "balloon" ? "middle" : "start"} fontSize={3.2} stroke="none" fill="#0d1b2a">{annotation.text}</text>}
      </>}
      <text x={x2+radius+2} y={y2} fontSize={5} stroke="none" fill="#e53935" className="cursor-pointer opacity-0 group-hover:opacity-100"
        onPointerDown={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();onRemove();}}>×</text>
    </g>;
  }
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

  if (!("x" in annotation)) return null;
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

// Lista de Peças desenhada na folha — tabela simples (cabeçalho + linhas),
// arrastável pelo título, com clique numa célula pra editar o texto dela.
// Desenhada de baixo pra cima quando growUp (padrão): a âncora (x,y) é o
// canto INFERIOR esquerdo, então acrescentar peças na montagem faz a lista
// crescer PRA CIMA em vez de invadir o bloco de título logo abaixo — mesmo
// comportamento da Parts List do Inventor ancorada no canto.
function BomTableSvg({
  table,
  effective,
  onDragStart,
  onEditCell,
  onRefresh,
  onRemove,
}: {
  table: BomTable;
  effective: { x: number; y: number } | null;
  onDragStart: (e: React.PointerEvent<SVGElement>, table: BomTable) => void;
  onEditCell: (rowId: string, key: string, current: string) => void;
  onRefresh: () => void;
  onRemove: () => void;
}) {
  const drawn: BomTable = effective ? { ...table, x: effective.x, y: effective.y } : table;
  const { x, y } = bomTableTopLeft(drawn);
  const width = bomTableWidth(drawn);
  const height = bomTableHeight(drawn);
  const titleHeight = drawn.title ? drawn.headerHeight : 0;
  const headerY = y + titleHeight;

  // Deslocamento X acumulado de cada coluna, pra desenhar as divisórias e
  // posicionar o texto sem recalcular a soma em todo lugar.
  const offsets: number[] = [];
  let acc = 0;
  for (const column of drawn.columns) {
    offsets.push(acc);
    acc += column.width;
  }

  function textX(column: BomColumn, index: number): number {
    const left = x + offsets[index];
    if (column.align === "center") return left + column.width / 2;
    if (column.align === "right") return left + column.width - 1.2;
    return left + 1.2;
  }

  function anchorOf(column: BomColumn): "start" | "middle" | "end" {
    return column.align === "center" ? "middle" : column.align === "right" ? "end" : "start";
  }

  return (
    <g>
      {drawn.title && (
        <g onPointerDown={(e) => onDragStart(e, table)} style={{ cursor: "move" }}>
          <rect x={x} y={y} width={width} height={titleHeight} fill="#f5f5f5" stroke="#000" strokeWidth={0.35} />
          <text
            x={x + width / 2}
            y={y + titleHeight / 2 + drawn.fontSize * 0.36}
            textAnchor="middle"
            fontSize={drawn.fontSize * 1.15}
            fontWeight={700}
            fill="#000"
          >
            {drawn.title}
          </text>
        </g>
      )}

      {/* Cabeçalho das colunas */}
      <rect x={x} y={headerY} width={width} height={drawn.headerHeight} fill="#fafafa" stroke="#000" strokeWidth={0.35} />
      {drawn.columns.map((column, index) => (
        <text
          key={`h-${index}`}
          x={textX(column, index)}
          y={headerY + drawn.headerHeight / 2 + drawn.fontSize * 0.36}
          textAnchor={anchorOf(column)}
          fontSize={drawn.fontSize}
          fontWeight={700}
          fill="#000"
          textLength={fitTextLength(column.label, drawn.fontSize, column.width - 2)}
          lengthAdjust="spacingAndGlyphs"
        >
          {column.label}
        </text>
      ))}

      {/* Linhas */}
      {drawn.rows.map((row, rowIndex) => {
        const rowY = headerY + drawn.headerHeight + rowIndex * drawn.rowHeight;
        return (
          <g key={row.id}>
            <rect x={x} y={rowY} width={width} height={drawn.rowHeight} fill="none" stroke="#000" strokeWidth={0.25} />
            {drawn.columns.map((column, index) => {
              const key = cellKey(column);
              const value = cellValue(row, column);
              return (
                <g key={`${row.id}-${index}`}>
                  {/* Área clicável da célula (transparente) — clicar abre a
                      edição do texto dela. */}
                  <rect
                    x={x + offsets[index]}
                    y={rowY}
                    width={column.width}
                    height={drawn.rowHeight}
                    fill="transparent"
                    style={{ cursor: "text" }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onEditCell(row.id, key, value);
                    }}
                  />
                  <text
                    x={textX(column, index)}
                    y={rowY + drawn.rowHeight / 2 + drawn.fontSize * 0.36}
                    textAnchor={anchorOf(column)}
                    fontSize={drawn.fontSize}
                    fill="#000"
                    pointerEvents="none"
                    textLength={fitTextLength(value, drawn.fontSize, column.width - 2)}
                    lengthAdjust="spacingAndGlyphs"
                  >
                    {value}
                  </text>
                </g>
              );
            })}
          </g>
        );
      })}

      {/* Divisórias verticais, por cima de tudo (cabeçalho + linhas juntos) */}
      {offsets.slice(1).map((offset, index) => (
        <line
          key={`v-${index}`}
          x1={x + offset}
          y1={headerY}
          x2={x + offset}
          y2={y + height}
          stroke="#000"
          strokeWidth={0.25}
        />
      ))}
      <rect x={x} y={headerY} width={width} height={height - titleHeight} fill="none" stroke="#000" strokeWidth={0.5} />

      {/* Botõezinhos de ação (não vão pro PDF impresso? vão — mas ficam
          discretos, no mesmo espírito dos botões de vista/cota já
          existentes na folha). */}
      <g className="opacity-0 transition-opacity hover:opacity-100" style={{ pointerEvents: "all" }}>
        <rect x={x + width - 12} y={y - 4.6} width={12} height={4.4} rx={0.8} fill="#ffffff" stroke="#90a4ae" strokeWidth={0.2} />
        <text
          x={x + width - 9}
          y={y - 1.5}
          textAnchor="middle"
          fontSize={2.4}
          fill="#1565c0"
          style={{ cursor: "pointer" }}
          onClick={(e) => {
            e.stopPropagation();
            onRefresh();
          }}
        >
          atualizar
        </text>
        <text
          x={x + width - 2}
          y={y - 1.5}
          textAnchor="middle"
          fontSize={2.4}
          fill="#c62828"
          style={{ cursor: "pointer" }}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          ✕
        </text>
      </g>
    </g>
  );
}

// Editor do "template" da Lista de Peças: quais colunas, em que ordem, com
// que rótulo/largura/alinhamento. É o equivalente ao "Column Chooser" +
// "Parts List Style" do Inventor, simplificado num painel só — as colunas
// escolhidas aqui viajam no modelo de folha (.eksfolha, ver bomTemplateFrom),
// então dá pra padronizar o formato da lista uma vez e reusar em todo
// desenho novo.
function BomColumnsForm({
  tables,
  onInsert,
  onChange,
  onRefresh,
}: {
  tables: BomTable[];
  onInsert: () => void;
  onChange: (tableId: string, patch: Partial<BomTable>) => void;
  onRefresh: (table: BomTable) => void;
}) {
  const table = tables[0] ?? null;

  if (!table) {
    return (
      <div className="space-y-3">
        <p className="text-xs text-primary-500">
          Nenhuma lista de peças nesta folha ainda. A lista puxa os dados de cada peça vinculada da montagem (código,
          descrição, material) e calcula as variáveis geométricas (comprimento, largura, altura, volume, área e massa).
        </p>
        <button
          type="button"
          onClick={onInsert}
          className="w-full rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:opacity-90"
        >
          Inserir Lista de Peças
        </button>
      </div>
    );
  }

  function patchColumn(index: number, patch: Partial<BomColumn>) {
    const columns = table!.columns.map((c, i) => (i === index ? { ...c, ...patch } : c));
    onChange(table!.id, { columns });
  }

  // Trocar a unidade também atualiza o cabeçalho ("ÁREA (cm²)" -> "ÁREA
  // (m²)") — mas SÓ se o rótulo ainda for o padrão. Quem renomeou a coluna
  // à mão não quer o texto dele sobrescrito por causa de uma troca de
  // unidade.
  function patchColumnUnit(index: number, patch: Partial<BomColumn>) {
    const column = table!.columns[index];
    const wasDefaultLabel = column.label === defaultColumnLabel(column);
    const next = { ...column, ...patch };
    patchColumn(index, { ...patch, ...(wasDefaultLabel ? { label: defaultColumnLabel(next) } : {}) });
  }

  function moveColumn(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= table!.columns.length) return;
    const columns = [...table!.columns];
    [columns[index], columns[target]] = [columns[target], columns[index]];
    onChange(table!.id, { columns });
  }

  const availableKeys = (Object.keys(BOM_COLUMN_LABELS) as BomColumnKey[]).filter(
    // "custom" pode repetir à vontade (cada uma tem seu próprio customId);
    // as demais só fazem sentido uma vez por lista.
    (key) => key === "custom" || !table.columns.some((c) => c.key === key)
  );

  return (
    <div className="space-y-3">
      <div className="flex gap-1">
        <button
          type="button"
          onClick={() => onRefresh(table)}
          className="flex-1 rounded-lg bg-primary px-2 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90"
        >
          Atualizar Lista
        </button>
        <button
          type="button"
          onClick={onInsert}
          title="Inserir outra lista nesta folha"
          className="rounded-lg bg-primary-50 px-2 py-1.5 text-xs text-primary-700 hover:bg-primary-100"
        >
          + Lista
        </button>
      </div>

      <label className="block text-xs text-primary-600">
        Título da lista
        <input
          value={table.title}
          onChange={(e) => onChange(table.id, { title: e.target.value })}
          className="mt-0.5 w-full rounded border border-primary-200 px-1.5 py-1 text-xs"
        />
      </label>

      <div className="grid grid-cols-3 gap-1.5">
        <label className="text-[11px] text-primary-600">
          Alt. linha
          <input
            type="number"
            step={0.5}
            value={table.rowHeight}
            onChange={(e) => onChange(table.id, { rowHeight: Math.max(2, Number(e.target.value)) })}
            className="mt-0.5 w-full rounded border border-primary-200 px-1 py-0.5 text-xs"
          />
        </label>
        <label className="text-[11px] text-primary-600">
          Alt. cabeç.
          <input
            type="number"
            step={0.5}
            value={table.headerHeight}
            onChange={(e) => onChange(table.id, { headerHeight: Math.max(2, Number(e.target.value)) })}
            className="mt-0.5 w-full rounded border border-primary-200 px-1 py-0.5 text-xs"
          />
        </label>
        <label className="text-[11px] text-primary-600">
          Fonte
          <input
            type="number"
            step={0.2}
            value={table.fontSize}
            onChange={(e) => onChange(table.id, { fontSize: Math.max(1, Number(e.target.value)) })}
            className="mt-0.5 w-full rounded border border-primary-200 px-1 py-0.5 text-xs"
          />
        </label>
      </div>

      <label className="flex items-center gap-1.5 text-xs text-primary-700">
        <input
          type="checkbox"
          checked={table.growUp}
          onChange={(e) => onChange(table.id, { growUp: e.target.checked })}
        />
        Crescer para cima (ancorada embaixo)
      </label>

      <div>
        <h4 className="mb-1 text-xs font-semibold text-primary-800">Colunas</h4>
        <ul className="space-y-1.5">
          {table.columns.map((column, index) => (
            <li key={`${column.key}-${column.customId ?? index}`} className="rounded-lg border border-primary-100 p-1.5">
              <div className="flex items-center gap-1">
                <input
                  value={column.label}
                  onChange={(e) => patchColumn(index, { label: e.target.value })}
                  className="min-w-0 flex-1 rounded border border-primary-200 px-1 py-0.5 text-[11px]"
                />
                <button
                  type="button"
                  onClick={() => moveColumn(index, -1)}
                  title="Mover para a esquerda"
                  className="rounded bg-primary-50 px-1 text-[11px] text-primary-700 hover:bg-primary-100"
                >
                  ←
                </button>
                <button
                  type="button"
                  onClick={() => moveColumn(index, 1)}
                  title="Mover para a direita"
                  className="rounded bg-primary-50 px-1 text-[11px] text-primary-700 hover:bg-primary-100"
                >
                  →
                </button>
                <button
                  type="button"
                  onClick={() => onChange(table.id, { columns: table.columns.filter((_, i) => i !== index) })}
                  title="Remover coluna"
                  className="rounded bg-error/10 px-1 text-[11px] text-error hover:bg-error/20"
                >
                  ✕
                </button>
              </div>
              <div className="mt-1 flex items-center gap-1">
                <span className="truncate text-[10px] text-primary-400" title={BOM_COLUMN_LABELS[column.key]}>
                  {BOM_COLUMN_LABELS[column.key]}
                </span>
                <input
                  type="number"
                  step={1}
                  value={column.width}
                  onChange={(e) => patchColumn(index, { width: Math.max(4, Number(e.target.value)) })}
                  title="Largura (mm)"
                  className="ml-auto w-12 rounded border border-primary-200 px-1 py-0.5 text-[11px]"
                />
                <select
                  value={column.align}
                  onChange={(e) => patchColumn(index, { align: e.target.value as BomColumn["align"] })}
                  className="rounded border border-primary-200 px-1 py-0.5 text-[11px]"
                >
                  <option value="left">Esq.</option>
                  <option value="center">Centro</option>
                  <option value="right">Dir.</option>
                </select>
              </div>

              {/* Unidade — só faz sentido nas colunas de área e volume; as
                  demais já vêm com a unidade fixa no rótulo. */}
              {column.key === "area" && (
                <label className="mt-1 flex items-center gap-1 text-[10px] text-primary-500">
                  Unidade
                  <select
                    value={column.areaUnit ?? DEFAULT_AREA_UNIT}
                    onChange={(e) => patchColumnUnit(index, { areaUnit: e.target.value as AreaUnit })}
                    className="ml-auto rounded border border-primary-200 px-1 py-0.5 text-[11px]"
                  >
                    {(Object.keys(AREA_UNIT_LABELS) as AreaUnit[]).map((unit) => (
                      <option key={unit} value={unit}>
                        {AREA_UNIT_LABELS[unit]}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {column.key === "volume" && (
                <label className="mt-1 flex items-center gap-1 text-[10px] text-primary-500">
                  Unidade
                  <select
                    value={column.volumeUnit ?? DEFAULT_VOLUME_UNIT}
                    onChange={(e) => patchColumnUnit(index, { volumeUnit: e.target.value as VolumeUnit })}
                    className="ml-auto rounded border border-primary-200 px-1 py-0.5 text-[11px]"
                  >
                    {(Object.keys(VOLUME_UNIT_LABELS) as VolumeUnit[]).map((unit) => (
                      <option key={unit} value={unit}>
                        {VOLUME_UNIT_LABELS[unit]}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </li>
          ))}
        </ul>

        {availableKeys.length > 0 && (
          <select
            value=""
            onChange={(e) => {
              if (!e.target.value) return;
              onChange(table.id, { columns: [...table.columns, createBomColumn(e.target.value as BomColumnKey)] });
            }}
            className="mt-2 w-full rounded-lg border border-primary-200 px-1.5 py-1 text-xs text-primary-700"
          >
            <option value="">+ Adicionar coluna…</option>
            {availableKeys.map((key) => (
              <option key={key} value={key}>
                {BOM_COLUMN_LABELS[key]}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
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

const EXTRA_ANNOTATIONS = [
  {kind: "centermark", label: "Marca de centro", icon: "⊕", hint: "Marca de centro manual: clique no centro e depois defina a extensão dos eixos."},
  {kind: "centerline", label: "Linha de centro", icon: "┄", hint: "Linha de centro manual: clique no início e no fim do eixo."},
  {kind: "leader", label: "Nota com chamada", icon: "↗", hint: "Clique no ponto de referência e depois na posição do texto."},
  {kind: "balloon", label: "Balão", icon: "①", hint: "Clique no componente e depois na posição do balão. Identificação manual, sem vínculo automático com a lista de peças."},
] as const;
