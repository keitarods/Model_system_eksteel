"use client";

import { useRef, useState } from "react";
import { Canvas, useThree, type ThreeEvent } from "@react-three/fiber";
import { Line, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { ShapeMesh } from "replicad";
import { SolidMesh } from "@/components/viewer/SolidMesh";
import type { ComponentPlacement } from "@/lib/assembly/types";

type ViewPreset = "isometrica" | "frontal" | "superior";

const VIEW_PRESETS: Record<ViewPreset, [number, number, number]> = {
  isometrica: [1800, -1800, 1800],
  frontal: [0, -2600, 0],
  superior: [0, 0, 2600],
};

export type AssemblyBody = {
  instanceId: string;
  mesh: ShapeMesh;
  placement: ComponentPlacement;
  visible: boolean;
  grounded: boolean;
};

export type FacePick = {
  instanceId: string;
  point: [number, number, number];
  normal: [number, number, number];
};

export type PickMarker = {
  point: [number, number, number];
  normal: [number, number, number];
  color: string;
};

const MARKER_LINE_LENGTH = 25;

// Marca visualmente uma referência já escolhida (1ª face de uma restrição
// em andamento) — sem isso, nada no viewport confirma que um clique durante
// "Nova Restrição" funcionou, o que parecia "clicar não faz nada" mesmo
// quando o clique era reconhecido corretamente.
function PickMarker3D({ marker }: { marker: PickMarker }) {
  const end: [number, number, number] = [
    marker.point[0] + marker.normal[0] * MARKER_LINE_LENGTH,
    marker.point[1] + marker.normal[1] * MARKER_LINE_LENGTH,
    marker.point[2] + marker.normal[2] * MARKER_LINE_LENGTH,
  ];
  return (
    <>
      <mesh position={marker.point}>
        <sphereGeometry args={[4, 16, 16]} />
        <meshBasicMaterial color={marker.color} depthTest={false} />
      </mesh>
      <Line points={[marker.point, end]} color={marker.color} lineWidth={2.5} />
    </>
  );
}

function CameraRig({ position }: { position: [number, number, number] }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as { update?: () => void } | null;
  const applied = useRef<string | null>(null);
  const key = position.join(",");
  if (applied.current !== key) {
    applied.current = key;
    camera.position.set(position[0], position[1], position[2]);
    camera.up.set(0, 0, 1);
    camera.lookAt(0, 0, 0);
    controls?.update?.();
  }
  return null;
}

// Arrasto de translação livre de um componente sem restrição — mesma
// técnica de PlaneOffsetDragger3D (plano auxiliar perpendicular à direção
// de visão da câmera, ray.intersectPlane, pointer capture), só que aqui em
// translação plena (2 eixos na tela) em vez de 1 grau de liberdade ao
// longo de uma normal fixa.
function useBodyDrag(onDragMove: (instanceId: string, position: [number, number, number]) => void) {
  const { camera, gl } = useThree();
  const dragState = useRef<{
    instanceId: string;
    plane: THREE.Plane;
    startHit: THREE.Vector3;
    startPosition: THREE.Vector3;
  } | null>(null);

  function beginDrag(instanceId: string, startPosition: [number, number, number], event: ThreeEvent<PointerEvent>) {
    event.stopPropagation();
    const viewDir = new THREE.Vector3();
    camera.getWorldDirection(viewDir);
    const anchor = new THREE.Vector3(...startPosition);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(viewDir, anchor);
    const hit = new THREE.Vector3();
    if (!event.ray.intersectPlane(plane, hit)) return;

    dragState.current = { instanceId, plane, startHit: hit.clone(), startPosition: anchor.clone() };
    gl.domElement.setPointerCapture(event.pointerId);

    function handleMove(moveEvent: PointerEvent) {
      const state = dragState.current;
      if (!state) return;
      const rect = gl.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((moveEvent.clientX - rect.left) / rect.width) * 2 - 1,
        -((moveEvent.clientY - rect.top) / rect.height) * 2 + 1
      );
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(ndc, camera);
      const hitPoint = new THREE.Vector3();
      if (!raycaster.ray.intersectPlane(state.plane, hitPoint)) return;
      const delta = hitPoint.clone().sub(state.startHit);
      const nextPosition = state.startPosition.clone().add(delta);
      onDragMove(state.instanceId, [nextPosition.x, nextPosition.y, nextPosition.z]);
    }

    function handleUp() {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      dragState.current = null;
    }

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  }

  return beginDrag;
}

export function AssemblyViewer3D({
  bodies,
  pickMode = false,
  pickModeHint,
  onPickFace,
  selectedInstanceId = null,
  onSelectInstance,
  draggableInstanceId = null,
  onDragInstance,
  pickMarkers = [],
  onEditInstance,
}: {
  bodies: AssemblyBody[];
  pickMode?: boolean;
  pickModeHint?: string;
  onPickFace?: (pick: FacePick) => void;
  selectedInstanceId?: string | null;
  onSelectInstance?: (id: string | null) => void;
  // Instância liberada pra arrastar livremente (sem restrição nenhuma
  // ainda) — só ela recebe o handler de arrastar; as demais só selecionam
  // ao clicar.
  draggableInstanceId?: string | null;
  onDragInstance?: (instanceId: string, position: [number, number, number]) => void;
  // Referências já escolhidas numa restrição em andamento (ver
  // PickMarker3D) — confirmação visual de que o clique foi reconhecido.
  pickMarkers?: PickMarker[];
  // Duplo clique num componente, fora do modo de escolha — ao estilo
  // Inventor, abre a peça pra editar (ver src/lib/project/editInContext.ts).
  onEditInstance?: (instanceId: string) => void;
}) {
  const [wireframe, setWireframe] = useState(false);
  const [view, setView] = useState<ViewPreset>("isometrica");

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-primary-100 bg-primary-50 px-3 py-2 text-sm">
        {(Object.keys(VIEW_PRESETS) as ViewPreset[]).map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => setView(preset)}
            className={`rounded-lg px-3 py-1.5 capitalize transition ${
              view === preset ? "bg-primary text-primary-foreground" : "bg-white text-primary-700 hover:bg-primary-100"
            }`}
          >
            {preset}
          </button>
        ))}
        <label className="ml-auto flex items-center gap-2 text-primary-700">
          <input type="checkbox" checked={wireframe} onChange={(e) => setWireframe(e.target.checked)} />
          Wireframe
        </label>
      </div>

      <div className={`relative flex-1 ${pickMode ? "cursor-crosshair" : ""}`}>
        <Canvas camera={{ position: VIEW_PRESETS.isometrica, fov: 45, up: [0, 0, 1], near: 0.1, far: 100000 }}>
          <color attach="background" args={["#ffffff"]} />
          <ambientLight intensity={0.7} />
          <directionalLight position={[1200, -1500, 2200]} intensity={1} />
          <CameraRig position={VIEW_PRESETS[view]} />
          <AssemblyBodies
            bodies={bodies}
            wireframe={wireframe}
            pickMode={pickMode}
            onPickFace={onPickFace}
            selectedInstanceId={selectedInstanceId}
            onSelectInstance={onSelectInstance}
            draggableInstanceId={draggableInstanceId}
            onDragInstance={onDragInstance}
            onEditInstance={onEditInstance}
          />
          {pickMarkers.map((marker, i) => (
            <PickMarker3D key={i} marker={marker} />
          ))}
          <gridHelper args={[4000, 40]} rotation={[Math.PI / 2, 0, 0]} />
          <axesHelper args={[600]} />
          <OrbitControls makeDefault enableZoom zoomToCursor zoomSpeed={1.2} minDistance={10} maxDistance={40000} />
        </Canvas>

        {bodies.length === 0 && !pickMode && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-primary-500">
            Insira uma peça para começar a montagem.
          </div>
        )}
        {pickMode && pickModeHint && (
          <div className="pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 rounded-full bg-primary-900/95 px-4 py-2 text-sm font-semibold text-white shadow-lg">
            {pickModeHint}
          </div>
        )}
      </div>
    </div>
  );
}

function AssemblyBodies({
  bodies,
  wireframe,
  pickMode,
  onPickFace,
  selectedInstanceId,
  onSelectInstance,
  draggableInstanceId,
  onDragInstance,
  onEditInstance,
}: {
  bodies: AssemblyBody[];
  wireframe: boolean;
  pickMode: boolean;
  onPickFace?: (pick: FacePick) => void;
  selectedInstanceId: string | null;
  onSelectInstance?: (id: string | null) => void;
  draggableInstanceId: string | null;
  onDragInstance?: (instanceId: string, position: [number, number, number]) => void;
  onEditInstance?: (instanceId: string) => void;
}) {
  const beginDrag = useBodyDrag((instanceId, position) => onDragInstance?.(instanceId, position));

  return (
    <>
      {bodies
        .filter((b) => b.visible)
        .map((body) => {
          const isSelected = body.instanceId === selectedInstanceId;
          const color = isSelected ? "#2196f3" : body.grounded ? "#8d6e63" : undefined;
          const isDraggable = !pickMode && body.instanceId === draggableInstanceId;

          return (
            <group
              key={body.instanceId}
              onClick={(e: ThreeEvent<MouseEvent>) => {
                if (pickMode) return;
                e.stopPropagation();
                onSelectInstance?.(body.instanceId);
              }}
              onDoubleClick={
                !pickMode
                  ? (e: ThreeEvent<MouseEvent>) => {
                      e.stopPropagation();
                      onEditInstance?.(body.instanceId);
                    }
                  : undefined
              }
              onPointerDown={
                isDraggable
                  ? (e: ThreeEvent<PointerEvent>) => beginDrag(body.instanceId, body.placement.position, e)
                  : undefined
              }
            >
              <SolidMesh
                mesh={body.mesh}
                wireframe={wireframe}
                pickMode={pickMode}
                color={color}
                transform={body.placement}
                onPick={
                  pickMode
                    ? (point, normal) => onPickFace?.({ instanceId: body.instanceId, point, normal })
                    : undefined
                }
              />
            </group>
          );
        })}
    </>
  );
}
