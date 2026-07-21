"use client";

import type { ComponentType } from "react";
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
    </div>
  );
}
