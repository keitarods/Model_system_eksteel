import * as THREE from "three";
import { compoundShapes, type AnyShape, type Solid } from "replicad";
import type { ComponentPlacement } from "@/lib/assembly/types";

// Mesma conversão de solver.ts (quaternion -> eixo-ângulo): Shape.rotate()
// do replicad só aceita UM eixo+ângulo (não uma quaternion), mas qualquer
// rotação 3D é representável assim (teorema de Euler), então não há perda.
function quaternionToAxisAngleDeg(q: [number, number, number, number]): { axis: [number, number, number]; angleDeg: number } {
  const quat = new THREE.Quaternion(q[0], q[1], q[2], q[3]).normalize();
  const angleRad = 2 * Math.acos(Math.min(1, Math.max(-1, quat.w)));
  if (angleRad < 1e-9) return { axis: [1, 0, 0], angleDeg: 0 };
  const s = Math.sqrt(1 - quat.w * quat.w);
  const axis: [number, number, number] =
    s < 1e-9 ? [1, 0, 0] : [quat.x / s, quat.y / s, quat.z / s];
  return { axis, angleDeg: (angleRad * 180) / Math.PI };
}

export type PlacedSolid = { solid: Solid; placement: ComponentPlacement };

// Combina os sólidos já posicionados/rotacionados num único composto — pra
// exportar a montagem inteira como 1 arquivo STEP (Inventor faz o mesmo:
// um STEP de montagem é um composto com cada peça na sua posição final,
// não vários arquivos). Clona cada sólido antes de transformar (nunca mexe
// no sólido "de verdade" guardado pra reconstrução/edição).
export function buildAssemblyCompound(parts: PlacedSolid[]): AnyShape | null {
  if (parts.length === 0) return null;

  // Rotaciona em torno da própria origem do sólido ANTES de transladar —
  // dá exatamente mundo = R·local + T, a mesma convenção de placement usada
  // no solver e no viewer (ver worldFrame em solver.ts).
  const placed = parts.map(({ solid, placement }) => {
    const clone = solid.clone();
    const { axis, angleDeg } = quaternionToAxisAngleDeg(placement.quaternion);
    if (angleDeg > 1e-6) clone.rotate(angleDeg, [0, 0, 0], axis);
    clone.translate(placement.position);
    return clone;
  });

  // Sem .delete() nos clones/composto de propósito: ação rara (1 clique em
  // "Exportar STEP"), e não há garantia documentada de que compoundShapes
  // não compartilhe as shapes de entrada internamente — arriscar um
  // use-after-free/double-free pra economizar uma quantidade pequena de
  // memória WASM numa ação esporádica não vale a pena (mesmo raciocínio já
  // usado em findClickedAxis, ver axisTools.ts).
  return placed.length === 1 ? placed[0] : compoundShapes(placed);
}

export function exportAssemblyStep(parts: PlacedSolid[]): Blob {
  const compound = buildAssemblyCompound(parts);
  if (!compound) throw new Error("Nenhuma peça vinculada para exportar.");
  return compound.blobSTEP();
}
