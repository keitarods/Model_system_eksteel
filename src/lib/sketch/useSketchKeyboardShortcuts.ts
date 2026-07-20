"use client";

import { useEffect } from "react";
import { useSketchStore } from "./store";
import { SHORTCUT_TO_TOOL } from "./tools";

// Atalhos de ferramenta (S/L/R/C/...) + Delete pra excluir a seleção —
// precisa ficar montado independente de qual painel está visível (o
// viewport 3D agora é o único lugar onde se desenha/seleciona), por isso
// vive num hook próprio chamado uma única vez no workspace, em vez de
// dentro de um painel específico que poderia deixar de existir.
export function useSketchKeyboardShortcuts() {
  const setTool = useSketchStore((s) => s.setTool);
  const selectedShapeId = useSketchStore((s) => s.selectedShapeId);
  const deleteSelectedShape = useSketchStore((s) => s.deleteSelectedShape);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const target = e.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }

      if ((e.key === "Delete" || e.key === "Backspace") && selectedShapeId) {
        e.preventDefault();
        deleteSelectedShape();
        return;
      }

      const nextTool = SHORTCUT_TO_TOOL[e.key.toLowerCase()];
      if (nextTool) {
        e.preventDefault();
        setTool(nextTool);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [setTool, selectedShapeId, deleteSelectedShape]);
}
