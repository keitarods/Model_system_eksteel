"use client";

import { useMemo, useRef, useState } from "react";
import { useFeatureStore } from "@/lib/features/store";
import { useDrawingStore, createSheetObject } from "@/lib/drawing/store";
import { loadOpenCascade } from "@/lib/replicad/opencascade";
import { rebuildModel } from "@/lib/replicad/build-model";
import { buildDrawingView, suggestScale, scaleToLabel } from "@/lib/replicad/technicalDrawing";
import { createId, distance } from "@/lib/sketch/render";
import { projectOntoSegment } from "@/lib/sketch/hitTest";
import {
  VIEW_ORIENTATION_LABELS,
  sheetDimensionsMm,
  type DrawingSheet,
  type DrawingView,
  type SheetSize,
  type ViewOrientation,
} from "@/lib/drawing/types";

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

const SHEET_MARGIN_MM = 12;
const TITLE_BLOCK_WIDTH_MM = 85;
const TITLE_BLOCK_HEIGHT_MM = 32;
const LINE_HIT_TOLERANCE_MM = 3;
const DIM_OFFSET_MM = 8;

type Point = { x: number; y: number };
type LineHit = { viewId: string; a: Point; b: Point };

// Arrastar vista e arrastar cota são gestos diferentes (livre em x/y vs.
// restrito à normal do segmento medido) — um único ref discriminado por
// `kind` evita duplicar toda a mecânica de pointerdown/move/up só pra
// trocar o que exatamente está sendo movido.
type DragState =
  | { kind: "view"; viewId: string; startClientX: number; startClientY: number; origX: number; origY: number }
  | { kind: "dimension"; dimensionId: string; nx: number; ny: number; startClientX: number; startClientY: number; startOffset: number };

function useActiveSheet(): { sheet: DrawingSheet | null; sheets: DrawingSheet[] } {
  const sheets = useDrawingStore((s) => s.sheets);
  const activeSheetId = useDrawingStore((s) => s.activeSheetId);
  const sheet = sheets.find((s) => s.id === activeSheetId) ?? sheets[0] ?? null;
  return { sheet, sheets };
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

export function DrawingSheetWorkspace() {
  const features = useFeatureStore((s) => s.features);
  const { sheet: activeSheet, sheets } = useActiveSheet();
  const addSheet = useDrawingStore((s) => s.addSheet);
  const removeSheet = useDrawingStore((s) => s.removeSheet);
  const setActiveSheet = useDrawingStore((s) => s.setActiveSheet);
  const renameSheet = useDrawingStore((s) => s.renameSheet);
  const setSheetSize = useDrawingStore((s) => s.setSheetSize);
  const setSheetOrientation = useDrawingStore((s) => s.setSheetOrientation);
  const addView = useDrawingStore((s) => s.addView);
  const updateView = useDrawingStore((s) => s.updateView);
  const removeView = useDrawingStore((s) => s.removeView);
  const moveView = useDrawingStore((s) => s.moveView);
  const addDimension = useDrawingStore((s) => s.addDimension);
  const updateDimension = useDrawingStore((s) => s.updateDimension);
  const removeDimension = useDrawingStore((s) => s.removeDimension);
  const updateTitleBlock = useDrawingStore((s) => s.updateTitleBlock);

  const hasSheetMetal = features.some((f) => f.type === "sheetMetal");

  const [addingView, setAddingView] = useState(false);
  const [pendingOrientation, setPendingOrientation] = useState<ViewOrientation>("front");
  const [pendingFlattened, setPendingFlattened] = useState(false);
  const [computing, setComputing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [dimensionMode, setDimensionMode] = useState(false);
  const [pendingLinePick, setPendingLinePick] = useState<LineHit | null>(null);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [dragPreview, setDragPreview] = useState<{ viewId: string; x: number; y: number } | null>(null);
  const [dimensionDragPreview, setDimensionDragPreview] = useState<{ dimensionId: string; offset: number } | null>(null);

  const sheetDims = activeSheet ? sheetDimensionsMm(activeSheet) : { width: 297, height: 210 };

  async function handleAddView() {
    if (!activeSheet) return;
    setComputing(true);
    setErrorMessage(null);
    let solid = null;
    try {
      await loadOpenCascade();
      solid = rebuildModel(features, { flatten: pendingFlattened });
      if (!solid) {
        setErrorMessage("Nenhum sólido modelado ainda — crie a peça no Modelador antes de adicionar uma vista.");
        return;
      }
      const raw = buildDrawingView(solid, pendingOrientation, pendingFlattened);
      const maxW = sheetDims.width - SHEET_MARGIN_MM * 2;
      const maxH = sheetDims.height - SHEET_MARGIN_MM * 2 - TITLE_BLOCK_HEIGHT_MM;
      const scale = suggestScale(raw.box, maxW * 0.9, maxH * 0.9);
      const cascade = activeSheet.views.length * 12;
      const view: DrawingView = {
        ...raw,
        scale,
        scaleLabel: scaleToLabel(scale),
        label: VIEW_ORIENTATION_LABELS[pendingOrientation],
        x: sheetDims.width / 2 + cascade,
        y: (sheetDims.height - TITLE_BLOCK_HEIGHT_MM) / 2 + cascade,
      };
      addView(activeSheet.id, view);
      setAddingView(false);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Erro ao gerar a vista.");
    } finally {
      solid?.delete();
      setComputing(false);
    }
  }

  function handleViewPointerDown(e: React.PointerEvent<SVGRectElement>, view: DrawingView) {
    if (dimensionMode) return;
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
    } else {
      const delta = dx * drag.nx + dy * drag.ny;
      setDimensionDragPreview({ dimensionId: drag.dimensionId, offset: drag.startOffset + delta });
    }
  }

  function handleSheetPointerUp() {
    const drag = dragRef.current;
    if (drag?.kind === "view" && dragPreview && activeSheet) {
      moveView(activeSheet.id, drag.viewId, dragPreview.x, dragPreview.y);
    } else if (drag?.kind === "dimension" && dimensionDragPreview && activeSheet) {
      updateDimension(activeSheet.id, drag.dimensionId, { offset: dimensionDragPreview.offset });
    }
    dragRef.current = null;
    setDragPreview(null);
    setDimensionDragPreview(null);
  }

  // 1º clique perto de uma aresta reta "arma" a seleção (pendingLinePick);
  // 2º clique decide o que fazer, ao estilo Inventor/esboço (ver
  // handleRawUp em sketch/store.ts, mesmo espírito): clique vazio OU na
  // MESMA aresta comita o comprimento dela; clique numa aresta DIFERENTE
  // comita a distância entre as duas.
  function handleSheetClick(e: React.MouseEvent<SVGSVGElement>) {
    if (!dimensionMode || !activeSheet || !svgRef.current) return;
    const point = toSheetPoint(svgRef.current, e.clientX, e.clientY);
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

            <div className="mx-1 h-6 w-px shrink-0 bg-primary-200" />
            <button
              type="button"
              onClick={() => setAddingView((v) => !v)}
              className={`rounded-lg px-3 py-1.5 transition ${
                addingView ? "bg-primary text-primary-foreground" : "bg-white text-primary-700 hover:bg-primary-100"
              }`}
            >
              Adicionar Vista
            </button>
            <button
              type="button"
              onClick={() => {
                setDimensionMode((v) => !v);
                setPendingLinePick(null);
              }}
              className={`rounded-lg px-3 py-1.5 transition ${
                dimensionMode ? "bg-primary text-primary-foreground" : "bg-white text-primary-700 hover:bg-primary-100"
              }`}
              title="Clique numa aresta pra cotar o comprimento dela, ou em 2 arestas diferentes pra cotar a distância entre as duas"
            >
              Cota
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

      {addingView && activeSheet && (
        <div className="flex flex-wrap items-center gap-2 border-b border-primary-100 bg-primary-50/60 px-3 py-2 text-sm">
          {(Object.keys(VIEW_ORIENTATION_LABELS) as ViewOrientation[]).map((orientation) => (
            <button
              key={orientation}
              type="button"
              onClick={() => setPendingOrientation(orientation)}
              className={`rounded-lg px-3 py-1.5 transition ${
                pendingOrientation === orientation ? "bg-primary text-primary-foreground" : "bg-white text-primary-700 hover:bg-primary-100"
              }`}
            >
              {VIEW_ORIENTATION_LABELS[orientation]}
            </button>
          ))}
          {hasSheetMetal && (
            <label className="flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-primary-700">
              <input type="checkbox" checked={pendingFlattened} onChange={(e) => setPendingFlattened(e.target.checked)} />
              Planificada
            </label>
          )}
          <button
            type="button"
            onClick={handleAddView}
            disabled={computing}
            className="rounded-lg bg-primary px-3 py-1.5 text-primary-foreground disabled:opacity-50"
          >
            {computing ? "Gerando…" : "Confirmar"}
          </button>
        </div>
      )}

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
            >
              <rect x={0.5} y={0.5} width={sheetDims.width - 1} height={sheetDims.height - 1} fill="white" stroke="#333" strokeWidth={0.5} />

              {activeSheet.views.map((view) => (
                <DrawingViewGroup
                  key={view.id}
                  view={view}
                  effective={dragPreview?.viewId === view.id ? dragPreview : null}
                  onDragStart={handleViewPointerDown}
                  onRemove={() => removeView(activeSheet.id, view.id)}
                  onCycleScale={() => {
                    const idx = COMMON_SCALE_STEPS.indexOf(view.scale);
                    const next = COMMON_SCALE_STEPS[(idx + 1 + COMMON_SCALE_STEPS.length) % COMMON_SCALE_STEPS.length] ?? 1;
                    updateView(activeSheet.id, view.id, { scale: next, scaleLabel: scaleToLabel(next) });
                  }}
                />
              ))}

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

              <TitleBlockSvg
                sheet={activeSheet}
                x={sheetDims.width - SHEET_MARGIN_MM - TITLE_BLOCK_WIDTH_MM}
                y={sheetDims.height - SHEET_MARGIN_MM - TITLE_BLOCK_HEIGHT_MM}
                width={TITLE_BLOCK_WIDTH_MM}
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
    </div>
  );
}

const COMMON_SCALE_STEPS = [1 / 10, 1 / 5, 1 / 2, 1, 2, 5];

function DrawingViewGroup({
  view,
  effective,
  onDragStart,
  onRemove,
  onCycleScale,
}: {
  view: DrawingView;
  effective: { x: number; y: number } | null;
  onDragStart: (e: React.PointerEvent<SVGRectElement>, view: DrawingView) => void;
  onRemove: () => void;
  onCycleScale: () => void;
}) {
  const x = effective?.x ?? view.x;
  const y = effective?.y ?? view.y;
  const cx = view.box.minX + view.box.width / 2;
  const cy = view.box.minY + view.box.height / 2;
  const transform = `translate(${x} ${y}) scale(${view.scale}) translate(${-cx} ${-cy})`;
  const halfW = (view.box.width * view.scale) / 2;
  const halfH = (view.box.height * view.scale) / 2;

  return (
    <g className="group">
      <g transform={transform}>
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

function TitleBlockSvg({ sheet, x, y, width, height }: { sheet: DrawingSheet; x: number; y: number; width: number; height: number }) {
  const rowH = height / 4;
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} fill="white" stroke="#333" strokeWidth={0.4} />
      <line x1={x} y1={y + rowH} x2={x + width} y2={y + rowH} stroke="#333" strokeWidth={0.3} />
      <line x1={x} y1={y + rowH * 2.6} x2={x + width} y2={y + rowH * 2.6} stroke="#333" strokeWidth={0.3} />
      <text x={x + 3} y={y + rowH * 0.7} fontSize={5} fontWeight="bold" fill="#0d1b2a">
        {sheet.titleBlock.partName || "(sem nome)"}
      </text>
      <text x={x + 3} y={y + rowH * 1.9} fontSize={3.4} fill="#455a64">
        Material: {sheet.titleBlock.material || "—"}
      </text>
      <text x={x + 3} y={y + height - 3} fontSize={3.2} fill="#607d8b">
        {sheet.titleBlock.drawnBy || "—"} · {sheet.titleBlock.date}
      </text>
    </g>
  );
}

function TitleBlockForm({
  sheet,
  onChange,
}: {
  sheet: DrawingSheet;
  onChange: (patch: Partial<DrawingSheet["titleBlock"]>) => void;
}) {
  const fields = useMemo(
    () => [
      { key: "partName" as const, label: "Nome da peça" },
      { key: "material" as const, label: "Material" },
      { key: "drawnBy" as const, label: "Desenhado por" },
      { key: "date" as const, label: "Data" },
      { key: "notes" as const, label: "Observações" },
    ],
    []
  );

  return (
    <div className="flex flex-col gap-2">
      {fields.map((field) => (
        <label key={field.key} className="flex flex-col gap-1">
          <span className="text-xs text-primary-500">{field.label}</span>
          {field.key === "notes" ? (
            <textarea
              value={sheet.titleBlock[field.key]}
              onChange={(e) => onChange({ [field.key]: e.target.value })}
              rows={3}
              className="rounded border border-primary-200 px-2 py-1"
            />
          ) : (
            <input
              type={field.key === "date" ? "date" : "text"}
              value={sheet.titleBlock[field.key]}
              onChange={(e) => onChange({ [field.key]: e.target.value })}
              className="rounded border border-primary-200 px-2 py-1"
            />
          )}
        </label>
      ))}
    </div>
  );
}
