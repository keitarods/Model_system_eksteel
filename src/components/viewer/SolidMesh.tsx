"use client";

import { useEffect, useMemo, useState } from "react";
import { type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import type { ShapeMesh } from "replicad";

// Extraído de Viewer3D.tsx pra ser reaproveitado também pelo
// AssemblyViewer3D (uma instância por componente da montagem, cada uma
// com seu próprio `transform`) — o Modelador de peça única continua
// usando isso sem `transform` (identidade), comportamento idêntico a
// antes da extração.
export function SolidMesh({
  mesh,
  wireframe,
  pickMode,
  onPick,
  onContextMenu,
  transform,
  color,
}: {
  mesh: ShapeMesh;
  wireframe: boolean;
  pickMode: boolean;
  onPick?: (origin: [number, number, number], normal: [number, number, number]) => void;
  // Botão direito numa face (fora de modo de escolha) — usado pro menu de
  // contexto "Exportar face em DXF", ao estilo Inventor.
  onContextMenu?: (
    origin: [number, number, number],
    normal: [number, number, number],
    clientX: number,
    clientY: number
  ) => void;
  // Posição/rotação rígida do corpo inteiro (montagem) — omitido = origem/
  // identidade, o único caso que existia antes desta peça virar
  // reaproveitável.
  transform?: { position: [number, number, number]; quaternion: [number, number, number, number] };
  // Cor do material — permite distinguir visualmente o componente
  // selecionado/fixo na montagem sem precisar de outro material.
  color?: string;
}) {
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(mesh.vertices, 3));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(mesh.normals, 3));
    geo.setIndex(mesh.triangles);
    return geo;
  }, [mesh]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  // Destaque da face sob o cursor durante o modo de escolha — só pra deixar
  // claro qual face vai ser escolhida ANTES de clicar (útil agora que o
  // marcador dos planos padrão não cobre mais a peça, ver PlanePicker3D).
  // Malha separada, não cor por vértice: cor por vértice vaza pras faces
  // vizinhas que compartilham vértice na aresta (bleed), já que réplicas de
  // faces adjacentes reaproveitam os mesmos vértices — uma malha à parte,
  // só com os triângulos da face sob o cursor (mesh.faceGroups), fica com
  // contorno nítido e não exige recolorir o material principal.
  const [hoveredFaceId, setHoveredFaceId] = useState<number | null>(null);

  const highlightGeometry = useMemo(() => {
    if (hoveredFaceId == null) return null;
    const group = mesh.faceGroups.find((g) => g.faceId === hoveredFaceId);
    if (!group) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(mesh.vertices, 3));
    geo.setIndex(mesh.triangles.slice(group.start, group.start + group.count));
    return geo;
  }, [mesh, hoveredFaceId]);

  useEffect(() => () => highlightGeometry?.dispose(), [highlightGeometry]);

  function worldNormalOf(event: ThreeEvent<MouseEvent>) {
    return event.face!.normal.clone().transformDirection(event.object.matrixWorld).normalize();
  }

  // faceIndex do three.js é em unidade de TRIÂNGULO (0, 1, 2, ...); start/
  // count de faceGroups são em unidade de ÍNDICE FLAT (mesh.triangles), 3
  // por triângulo — por isso o *3 pra comparar no mesmo referencial.
  function faceIdAt(event: ThreeEvent<PointerEvent>): number | null {
    if (event.faceIndex == null) return null;
    const flatIndex = event.faceIndex * 3;
    const group = mesh.faceGroups.find((g) => flatIndex >= g.start && flatIndex < g.start + g.count);
    return group?.faceId ?? null;
  }

  function handlePointerMove(event: ThreeEvent<PointerEvent>) {
    if (!pickMode) return;
    const id = faceIdAt(event);
    setHoveredFaceId((current) => (current === id ? current : id));
  }

  function handlePointerOut() {
    setHoveredFaceId(null);
  }

  function handleClick(event: ThreeEvent<MouseEvent>) {
    if (!pickMode || !onPick || !event.face) return;
    event.stopPropagation();
    const worldNormal = worldNormalOf(event);
    onPick(
      [event.point.x, event.point.y, event.point.z],
      [worldNormal.x, worldNormal.y, worldNormal.z]
    );
  }

  function handleContextMenu(event: ThreeEvent<MouseEvent>) {
    if (!onContextMenu || !event.face) return;
    event.stopPropagation();
    event.nativeEvent.preventDefault();
    const worldNormal = worldNormalOf(event);
    onContextMenu(
      [event.point.x, event.point.y, event.point.z],
      [worldNormal.x, worldNormal.y, worldNormal.z],
      event.nativeEvent.clientX,
      event.nativeEvent.clientY
    );
  }

  return (
    <group position={transform?.position} quaternion={transform?.quaternion}>
      <mesh
        geometry={geometry}
        castShadow
        receiveShadow
        onClick={pickMode ? handleClick : undefined}
        onContextMenu={!pickMode && onContextMenu ? handleContextMenu : undefined}
        onPointerMove={pickMode ? handlePointerMove : undefined}
        onPointerOut={pickMode ? handlePointerOut : undefined}
      >
        <meshStandardMaterial
          color={color ?? (pickMode ? "#78909C" : "#546E7A")}
          wireframe={wireframe}
          side={THREE.DoubleSide}
          metalness={0.05}
          roughness={0.65}
        />
      </mesh>
      {pickMode && highlightGeometry && (
        <mesh geometry={highlightGeometry}>
          <meshBasicMaterial
            color="#4fc3f7"
            side={THREE.DoubleSide}
            transparent
            opacity={0.55}
            depthTest={false}
            polygonOffset
            polygonOffsetFactor={-1}
            polygonOffsetUnits={-1}
          />
        </mesh>
      )}
    </group>
  );
}
