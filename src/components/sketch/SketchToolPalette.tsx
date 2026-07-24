"use client";

import { useState, type ComponentType } from "react";
import { useSketchStore } from "@/lib/sketch/store";
import { SKETCH_TOOLS, TOOL_GROUPS } from "@/lib/sketch/tools";
import {
  IconSelect,
  IconLine,
  IconCenterline,
  IconRect,
  IconCircle,
  IconMeasure,
  IconDimension,
  IconPoint,
  IconJoinPoints,
  IconHorizontal,
  IconVertical,
  IconPerpendicular,
  IconTangent,
  IconFillet,
  IconChamfer,
  IconSlotCenterToCenter,
  IconSlotCenterPoint,
  IconPatternRect,
  IconPatternCircular,
} from "@/components/icons/ToolIcons";
import type { SketchTool } from "@/lib/sketch/types";

const ICONS: Record<SketchTool, ComponentType<{ className?: string }>> = {
  select: IconSelect,
  line: IconLine,
  centerline: IconCenterline,
  rect: IconRect,
  circle: IconCircle,
  measure: IconMeasure,
  dimension: IconDimension,
  point: IconPoint,
  joinPoints: IconJoinPoints,
  horizontal: IconHorizontal,
  vertical: IconVertical,
  perpendicular: IconPerpendicular,
  tangent: IconTangent,
  fillet2d: IconFillet,
  chamfer2d: IconChamfer,
  slotCenterToCenter: IconSlotCenterToCenter,
  slotCenterPoint: IconSlotCenterPoint,
};

// Ribbon horizontal de ferramentas — ao estilo Inventor/SolidWorks/Fusion
// (ferramentas de sketch ficam numa faixa no topo da tela, não flutuando
// sobre o canvas). Mesmo componente usado uma única vez, no topo do
// workspace — como a ferramenta ativa mora na store global, funciona
// igual pros dois painéis (2D e 3D) ao mesmo tempo.
export function SketchToolPalette({ className = "" }: { className?: string }) {
  const tool = useSketchStore((s) => s.tool);
  const setTool = useSketchStore((s) => s.setTool);
  const filletRadius = useSketchStore((s) => s.filletRadius);
  const setFilletRadius = useSketchStore((s) => s.setFilletRadius);
  const chamferDistance = useSketchStore((s) => s.chamferDistance);
  const setChamferDistance = useSketchStore((s) => s.setChamferDistance);
  const pendingSlot = useSketchStore((s) => s.pendingSlot);
  const shapes = useSketchStore((s) => s.shapes);
  const selectedShapeId = useSketchStore((s) => s.selectedShapeId);
  const patternShapeRectangular = useSketchStore((s) => s.patternShapeRectangular);
  const patternShapeCircular = useSketchStore((s) => s.patternShapeCircular);
  const hasValidSelection = shapes.some((s) => s.id === selectedShapeId);

  // Padrão 2D — ação de um disparo sobre a forma SELECIONADA (não é uma
  // SketchTool: virar `tool` limpa selectedShapeId no store, o que
  // quebraria exatamente o que essa ação precisa; ver setTool). Painel
  // local, some assim que aplica ou cancela.
  const [patternMode, setPatternMode] = useState<"rectangular" | "circular" | null>(null);
  const [patternDir1, setPatternDir1] = useState<"x" | "y">("x");
  const [patternCount1, setPatternCount1] = useState(3);
  const [patternSpacing1, setPatternSpacing1] = useState(20);
  const [patternDir2Enabled, setPatternDir2Enabled] = useState(false);
  const [patternDir2, setPatternDir2] = useState<"x" | "y">("y");
  const [patternCount2, setPatternCount2] = useState(3);
  const [patternSpacing2, setPatternSpacing2] = useState(20);
  const [patternCenterX, setPatternCenterX] = useState(0);
  const [patternCenterY, setPatternCenterY] = useState(0);
  const [patternCount, setPatternCount] = useState(4);
  const [patternAngle, setPatternAngle] = useState(360);

  return (
    <div className={`flex flex-nowrap items-center gap-1 overflow-x-auto md:flex-wrap ${className}`}>
      {tool === "fillet2d" && (
        <label className="flex shrink-0 items-center gap-1.5 rounded-lg bg-primary-50 px-2 py-1 text-xs text-primary-700">
          Raio (mm)
          <input
            type="number"
            min={0.1}
            step={0.5}
            value={filletRadius}
            onChange={(e) => setFilletRadius(Number(e.target.value))}
            className="w-16 rounded border border-primary-200 px-1 py-0.5 text-right"
          />
        </label>
      )}
      {tool === "chamfer2d" && (
        <label className="flex shrink-0 items-center gap-1.5 rounded-lg bg-primary-50 px-2 py-1 text-xs text-primary-700">
          Distância (mm)
          <input
            type="number"
            min={0.1}
            step={0.5}
            value={chamferDistance}
            onChange={(e) => setChamferDistance(Number(e.target.value))}
            className="w-16 rounded border border-primary-200 px-1 py-0.5 text-right"
          />
        </label>
      )}
      {(tool === "slotCenterToCenter" || tool === "slotCenterPoint") && (
        <span className="shrink-0 rounded-lg bg-primary-50 px-2 py-1 text-xs text-primary-700">
          {!pendingSlot
            ? tool === "slotCenterToCenter"
              ? "Clique no 1º centro do rasgo"
              : "Clique no ponto médio do rasgo"
            : pendingSlot.kind === "ready"
              ? "Arraste para definir a largura"
              : tool === "slotCenterToCenter"
                ? "Clique no 2º centro"
                : "Clique numa extremidade"}
        </span>
      )}
      {TOOL_GROUPS.map((group, gi) => (
        <div key={gi} className="flex shrink-0 items-center gap-1">
          {gi > 0 && <div className="mx-1 h-6 w-px shrink-0 bg-primary-200" />}
          {group.map((id) => {
            const meta = SKETCH_TOOLS.find((t) => t.id === id);
            const Icon = ICONS[id];
            if (!meta) return null;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setTool(id)}
                title={`${meta.label} (${meta.shortcut})`}
                className={`flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm transition ${
                  tool === id
                    ? "bg-primary text-primary-foreground"
                    : "bg-white text-primary-700 hover:bg-primary-100"
                }`}
              >
                <Icon className="shrink-0" />
                <span className="hidden lg:inline">{meta.label}</span>
              </button>
            );
          })}
        </div>
      ))}

      <div className="mx-1 h-6 w-px shrink-0 bg-primary-200" />
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={() => setPatternMode(patternMode === "rectangular" ? null : "rectangular")}
          disabled={!hasValidSelection}
          title="Padrão Retangular — repete a forma selecionada numa grade (eixos X/Y do esboço)"
          className={`flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm transition disabled:cursor-not-allowed disabled:opacity-40 ${
            patternMode === "rectangular" ? "bg-primary text-primary-foreground" : "bg-white text-primary-700 hover:bg-primary-100"
          }`}
        >
          <IconPatternRect className="shrink-0" />
          <span className="hidden lg:inline">Padrão Retangular</span>
        </button>
        <button
          type="button"
          onClick={() => setPatternMode(patternMode === "circular" ? null : "circular")}
          disabled={!hasValidSelection}
          title="Padrão Circular — repete a forma selecionada em torno de um centro no esboço"
          className={`flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm transition disabled:cursor-not-allowed disabled:opacity-40 ${
            patternMode === "circular" ? "bg-primary text-primary-foreground" : "bg-white text-primary-700 hover:bg-primary-100"
          }`}
        >
          <IconPatternCircular className="shrink-0" />
          <span className="hidden lg:inline">Padrão Circular</span>
        </button>
      </div>

      {patternMode === "rectangular" && selectedShapeId && (
        <div className="flex shrink-0 items-center gap-1.5 rounded-lg bg-primary-50 px-2 py-1 text-xs text-primary-700">
          <select
            value={patternDir1}
            onChange={(e) => setPatternDir1(e.target.value as "x" | "y")}
            className="rounded border border-primary-200 px-1 py-0.5"
          >
            <option value="x">Dir. X</option>
            <option value="y">Dir. Y</option>
          </select>
          <input
            type="number"
            min={1}
            step={1}
            value={patternCount1}
            title="Quantidade"
            onChange={(e) => setPatternCount1(Number(e.target.value))}
            className="w-10 rounded border border-primary-200 px-1 py-0.5 text-right"
          />
          x
          <input
            type="number"
            step={1}
            value={patternSpacing1}
            title="Espaço (mm)"
            onChange={(e) => setPatternSpacing1(Number(e.target.value))}
            className="w-14 rounded border border-primary-200 px-1 py-0.5 text-right"
          />
          mm
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={patternDir2Enabled} onChange={(e) => setPatternDir2Enabled(e.target.checked)} />
            2ª dir.
          </label>
          {patternDir2Enabled && (
            <>
              <select
                value={patternDir2}
                onChange={(e) => setPatternDir2(e.target.value as "x" | "y")}
                className="rounded border border-primary-200 px-1 py-0.5"
              >
                <option value="x">Dir. X</option>
                <option value="y">Dir. Y</option>
              </select>
              <input
                type="number"
                min={1}
                step={1}
                value={patternCount2}
                title="Quantidade"
                onChange={(e) => setPatternCount2(Number(e.target.value))}
                className="w-10 rounded border border-primary-200 px-1 py-0.5 text-right"
              />
              x
              <input
                type="number"
                step={1}
                value={patternSpacing2}
                title="Espaço (mm)"
                onChange={(e) => setPatternSpacing2(Number(e.target.value))}
                className="w-14 rounded border border-primary-200 px-1 py-0.5 text-right"
              />
              mm
            </>
          )}
          <button
            type="button"
            onClick={() => {
              const dirVec = (d: "x" | "y") => (d === "x" ? { x: 1, y: 0 } : { x: 0, y: 1 });
              patternShapeRectangular(
                selectedShapeId,
                dirVec(patternDir1),
                patternCount1,
                patternSpacing1,
                patternDir2Enabled ? dirVec(patternDir2) : undefined,
                patternDir2Enabled ? patternCount2 : undefined,
                patternDir2Enabled ? patternSpacing2 : undefined
              );
              setPatternMode(null);
            }}
            className="rounded bg-primary px-2 py-0.5 font-semibold text-primary-foreground hover:bg-primary-hover"
          >
            Aplicar
          </button>
          <button type="button" onClick={() => setPatternMode(null)} className="rounded px-2 py-0.5 text-primary-500 hover:bg-primary-100">
            Cancelar
          </button>
        </div>
      )}

      {patternMode === "circular" && selectedShapeId && (
        <div className="flex shrink-0 items-center gap-1.5 rounded-lg bg-primary-50 px-2 py-1 text-xs text-primary-700">
          Centro
          <input
            type="number"
            step={1}
            value={patternCenterX}
            title="Centro X (mm)"
            onChange={(e) => setPatternCenterX(Number(e.target.value))}
            className="w-14 rounded border border-primary-200 px-1 py-0.5 text-right"
          />
          <input
            type="number"
            step={1}
            value={patternCenterY}
            title="Centro Y (mm)"
            onChange={(e) => setPatternCenterY(Number(e.target.value))}
            className="w-14 rounded border border-primary-200 px-1 py-0.5 text-right"
          />
          Qtd.
          <input
            type="number"
            min={2}
            step={1}
            value={patternCount}
            onChange={(e) => setPatternCount(Number(e.target.value))}
            className="w-10 rounded border border-primary-200 px-1 py-0.5 text-right"
          />
          Ângulo
          <input
            type="number"
            min={1}
            max={360}
            step={1}
            value={patternAngle}
            onChange={(e) => setPatternAngle(Number(e.target.value))}
            className="w-14 rounded border border-primary-200 px-1 py-0.5 text-right"
          />
          °
          <button
            type="button"
            onClick={() => {
              patternShapeCircular(selectedShapeId, { x: patternCenterX, y: patternCenterY }, patternCount, patternAngle);
              setPatternMode(null);
            }}
            className="rounded bg-primary px-2 py-0.5 font-semibold text-primary-foreground hover:bg-primary-hover"
          >
            Aplicar
          </button>
          <button type="button" onClick={() => setPatternMode(null)} className="rounded px-2 py-0.5 text-primary-500 hover:bg-primary-100">
            Cancelar
          </button>
        </div>
      )}
    </div>
  );
}
