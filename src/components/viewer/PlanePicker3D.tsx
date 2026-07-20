"use client";

import { useState } from "react";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import { STANDARD_PLANES, localToWorldPoint } from "@/lib/replicad/plane";
import { planeBasisQuaternion } from "./planeBasis";
import type { SketchPlane } from "@/lib/sketch/types";

const PLANE_SIZE = 160;
const PLANE_COLORS: Record<string, string> = { xy: "#4fc3f7", xz: "#66bb6a", yz: "#ef5350" };

// Os 3 planos padrão como quads clicáveis dentro do próprio viewport 3D —
// ao estilo Inventor/SolidWorks: ao criar um esboço sem escolher uma face
// específica, esses 3 planos de origem aparecem pra escolher visualmente
// (além de ainda poder clicar numa face do sólido, se houver um).
export function PlanePicker3D({ onPick }: { onPick: (plane: SketchPlane) => void }) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  return (
    <group>
      {STANDARD_PLANES.map(({ id, label, plane }) => {
        const quaternion = planeBasisQuaternion(plane);
        const hovered = hoveredId === id;
        return (
          <group key={id}>
            <mesh
              position={plane.origin}
              quaternion={[quaternion.x, quaternion.y, quaternion.z, quaternion.w]}
              onPointerOver={(e) => {
                e.stopPropagation();
                setHoveredId(id);
              }}
              onPointerOut={(e) => {
                e.stopPropagation();
                setHoveredId((cur) => (cur === id ? null : cur));
              }}
              onClick={(e) => {
                e.stopPropagation();
                onPick(plane);
              }}
            >
              <planeGeometry args={[PLANE_SIZE, PLANE_SIZE]} />
              <meshBasicMaterial
                color={PLANE_COLORS[id]}
                transparent
                opacity={hovered ? 0.38 : 0.16}
                side={THREE.DoubleSide}
                depthWrite={false}
              />
            </mesh>
            <Html
              position={localToWorldPoint(plane, { x: PLANE_SIZE * 0.35, y: PLANE_SIZE * 0.35 })}
              center
              distanceFactor={110}
              pointerEvents="none"
            >
              <span
                className="whitespace-nowrap rounded-full border-2 border-white px-3 py-1 text-sm font-bold text-white shadow-lg"
                style={{ background: PLANE_COLORS[id] }}
              >
                {label}
              </span>
            </Html>
          </group>
        );
      })}
    </group>
  );
}
