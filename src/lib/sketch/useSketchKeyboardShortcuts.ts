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
  const copySelectedShape = useSketchStore((s) => s.copySelectedShape);
  const pasteShape = useSketchStore((s) => s.pasteShape);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }

      // Ctrl/Cmd+C e Ctrl/Cmd+V primeiro, ANTES do early-return genérico de
      // modificador logo abaixo (senão nunca chegariam a disparar).
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.altKey && e.key.toLowerCase() === "c" && selectedShapeId) {
        e.preventDefault();
        copySelectedShape();
        return;
      }
      if (mod && !e.altKey && e.key.toLowerCase() === "v") {
        e.preventDefault();
        pasteShape();
        return;
      }

      if (e.metaKey || e.ctrlKey || e.altKey) return;

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
  }, [setTool, selectedShapeId, deleteSelectedShape, copySelectedShape, pasteShape]);
}
