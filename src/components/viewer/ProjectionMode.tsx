"use client";
import { useLayoutEffect, useRef } from "react";
import { useThree } from "@react-three/fiber";
import { OrthographicCamera, PerspectiveCamera, Vector3 } from "three";
import { cameraWithProjection } from "./cameraProjection";
import type { NavigationControls } from "./cameraNavigation";

export type ProjectionMode = "orthographic" | "perspective";
export function ProjectionSelector({ value, onChange }: { value: ProjectionMode; onChange: (mode: ProjectionMode) => void }) {
  return <label className="flex items-center gap-1 text-sm">Projeção
    <select aria-label="Tipo de projeção" className="rounded border bg-white px-2 py-1 text-primary-700" value={value} onChange={e => onChange(e.target.value as ProjectionMode)}>
      <option value="orthographic">Plana (ortográfica)</option><option value="perspective">Perspectiva</option>
    </select>
  </label>;
}

export function ProjectionController({ mode }: { mode: ProjectionMode }) {
  const get = useThree(s => s.get);
  const set = useThree(s => s.set);
  const controls = useThree(s => s.controls) as NavigationControls | null;
  const pendingTarget = useRef<Vector3 | null>(null);
  useLayoutEffect(() => {
    const { camera, size, controls: currentControls } = get();
    if ((camera instanceof OrthographicCamera) === (mode === "orthographic")) return;
    const target = (currentControls as NavigationControls | null)?.target.clone() ?? new Vector3();
    const next = cameraWithProjection(camera as OrthographicCamera | PerspectiveCamera, target, size, mode);
    pendingTarget.current = target;
    set({ camera: next });
  }, [mode, get, set]);
  useLayoutEffect(() => {
    if (controls && pendingTarget.current) {
      controls.target.copy(pendingTarget.current);
      controls.update();
      pendingTarget.current = null;
    }
  }, [controls]);
  return null;
}
