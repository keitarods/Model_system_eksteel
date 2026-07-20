"use client";

import { useRef } from "react";
import { Line, Html } from "@react-three/drei";
import { useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { offsetOrigin, planeYDir } from "@/lib/replicad/plane";
import { planeBasisQuaternion } from "./planeBasis";
import type { SketchPlane } from "@/lib/sketch/types";

const PLANE_SIZE = 200;
const COLOR = "#f59e0b"; // âmbar — distingue do azul do plano de esboço/seletor

// Plano arrastável ao longo da própria normal (1 grau de liberdade), ao
// estilo "Plane" do Inventor/SolidWorks: clicar e arrastar desliza o plano
// pra frente/trás da referência; soltar não confirma nada sozinho (quem
// chama decide quando virar operação de verdade). O arrasto usa um plano
// auxiliar invisível que CONTÉM o eixo de deslocamento e é escolhido pra
// não ficar de perfil pra câmera — raycastar direto no quad que se move
// não funcionaria (todo ponto dele tem o mesmo deslocamento, por definição).
export function PlaneOffsetDragger3D({
  basePlane,
  offset,
  onOffsetChange,
}: {
  basePlane: SketchPlane;
  offset: number;
  onOffsetChange: (offset: number) => void;
}) {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const dragState = useRef<{
    axis: THREE.Vector3;
    origin: THREE.Vector3;
    auxPlane: THREE.Plane;
    startOffset: number;
  } | null>(null);

  const origin = offsetOrigin(basePlane, offset);
  const quaternion = planeBasisQuaternion(basePlane);

  function handlePointerDown(e: ThreeEvent<PointerEvent>) {
    if (e.button !== 0) return;
    e.stopPropagation();
    gl.domElement.setPointerCapture(e.pointerId);

    const axis = new THREE.Vector3(...basePlane.normal).normalize();
    const originVec = new THREE.Vector3(...origin);

    const camDir = new THREE.Vector3();
    camera.getWorldDirection(camDir);
    const xDir = new THREE.Vector3(...basePlane.xDir);
    const yDir = new THREE.Vector3(...planeYDir(basePlane));
    // tangente menos alinhada com a direção da câmera — evita que o plano
    // auxiliar de arrasto fique quase de perfil (degenerado) na maioria
    // dos ângulos de vista razoáveis.
    const tangent = Math.abs(camDir.dot(xDir)) < Math.abs(camDir.dot(yDir)) ? xDir : yDir;
    const auxNormal = new THREE.Vector3().crossVectors(axis, tangent).normalize();
    const auxPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(auxNormal, originVec);

    dragState.current = { axis, origin: originVec, auxPlane, startOffset: offset };
  }

  function handlePointerMove(e: ThreeEvent<PointerEvent>) {
    const state = dragState.current;
    if (!state) return;
    e.stopPropagation();

    const hit = new THREE.Vector3();
    if (!e.ray.intersectPlane(state.auxPlane, hit)) return;

    const delta = hit.sub(state.origin).dot(state.axis);
    onOffsetChange(state.startOffset + delta);
  }

  function handlePointerUp(e: ThreeEvent<PointerEvent>) {
    if (!dragState.current) return;
    e.stopPropagation();
    dragState.current = null;
  }

  return (
    <group>
      <mesh
        position={origin}
        quaternion={[quaternion.x, quaternion.y, quaternion.z, quaternion.w]}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <planeGeometry args={[PLANE_SIZE, PLANE_SIZE]} />
        <meshBasicMaterial color={COLOR} transparent opacity={0.28} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <Line points={[basePlane.origin, origin]} color={COLOR} lineWidth={2} />
      <Html position={origin} center distanceFactor={80} pointerEvents="none">
        <span className="whitespace-nowrap rounded-full border-2 border-white bg-amber-500 px-3 py-1.5 text-sm font-bold text-white shadow-lg">
          {offset.toFixed(1)}mm — arraste ou digite o valor
        </span>
      </Html>
    </group>
  );
}
