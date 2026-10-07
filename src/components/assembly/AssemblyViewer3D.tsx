"use client";
import { ProjectionController, ProjectionSelector, type ProjectionMode } from "@/components/viewer/ProjectionMode";

import { useEffect, useRef, useState } from "react";
import { useThree, type ThreeEvent } from "@react-three/fiber";
import { GizmoHelper, Line, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { SketchFeature } from "@/lib/features/types";
import { localToWorldPoint } from "@/lib/replicad/plane";
import type { ShapeMesh } from "replicad";
import { orientCamera, type NavigationControls } from "@/components/viewer/cameraNavigation";
import {CameraApiCapture,ViewCubeOrbitCatcher,ViewCubeRotationArrows,type CameraApi} from "@/components/viewer/ViewCubeNavigation";
import { MaterialLighting } from "@/components/materials/MaterialLighting";
import type { Appearance } from "@/lib/materials/library";
import {CadSelectionCanvas,CadSelectionProvider,useCadSelection} from '@/components/viewer/CadSelection';
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
  label?:string;
  mesh: ShapeMesh;
  placement: ComponentPlacement;
  visible: boolean;
  grounded: boolean;
  color?: string;
  appearance?: Appearance;
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

function CameraRig({ position, token }: { position: [number, number, number]; token: number }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as NavigationControls | null;
  const applied = useRef(0);
  useEffect(() => {
    if (!controls || applied.current === token) return;
    applied.current = token;
    orientCamera(camera, controls, new THREE.Vector3(...position));
  }, [camera, controls, position, token]);
  return null;
}

function FitAssembly({bodies,sketches,token}:{bodies:AssemblyBody[];sketches:{sketch:SketchFeature;placement:ComponentPlacement}[];token:number}) {
  const {camera,size} = useThree();
  const controls = useThree(s=>s.controls) as NavigationControls | null;
  const applied = useRef("");
  useEffect(()=>{
    const key = `${token}:${bodies.map(b=>b.instanceId).join(",")}:${sketches.map(s=>s.sketch.id).join(",")}`;
    if(!controls || applied.current===key) return;
    const box = new THREE.Box3();
    const point = new THREE.Vector3();
    for(const body of bodies.filter(b=>b.visible)) {
      const q=new THREE.Quaternion(...body.placement.quaternion),pos=new THREE.Vector3(...body.placement.position);
      for(let i=0;i<body.mesh.vertices.length;i+=3) box.expandByPoint(point.fromArray(body.mesh.vertices,i).applyQuaternion(q).add(pos));
    }
    for(const {sketch,placement} of sketches) {
      const q=new THREE.Quaternion(...placement.quaternion),pos=new THREE.Vector3(...placement.position);
      const points=Object.values(sketch.points).map(p=>({x:p.x,y:p.y}));
      for(const shape of sketch.shapes) if(shape.type==='circle') {const c=sketch.points[shape.center];points.push({x:c.x-shape.radius,y:c.y-shape.radius},{x:c.x+shape.radius,y:c.y+shape.radius});}
      for(const p of points) box.expandByPoint(point.fromArray(localToWorldPoint(sketch.plane,p)).applyQuaternion(q).add(pos));
    }
    if(box.isEmpty()) return;
    applied.current=key;
    const center=box.getCenter(new THREE.Vector3());
    const radius=Math.max(box.getSize(new THREE.Vector3()).length()/2,1);
    const direction=camera.position.clone().sub(controls.target).normalize();
    const fov=camera instanceof THREE.PerspectiveCamera?camera.fov:45;
    const halfAngle=Math.atan(Math.tan(fov*Math.PI/360)*Math.min(1,size.width/size.height));
    camera.position.copy(center).addScaledVector(direction,Math.max(15,radius/Math.sin(halfAngle)*1.2));
    if (camera instanceof THREE.OrthographicCamera) {
      camera.zoom = Math.min(camera.right-camera.left, camera.top-camera.bottom)/(2*radius*1.2);
      camera.updateProjectionMatrix();
    }
    controls.target.copy(center);controls.update();
  },[bodies,sketches,token,camera,controls,size.width,size.height]);
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
  sketches = [],
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
  sketches?: { sketch: SketchFeature; placement: ComponentPlacement }[];
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
  const cameraApiRef=useRef<CameraApi|null>(null);
  const [fitToken,setFitToken] = useState(0);
  const [projection, setProjection] = useState<ProjectionMode>("orthographic");
  const [wireframe, setWireframe] = useState(false);
  const [view, setView] = useState<ViewPreset>("isometrica");
  const [viewToken, setViewToken] = useState(0);

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <CadSelectionProvider assembly enabled={!pickMode&&!draggableInstanceId} resetKey={bodies} onClear={()=>onSelectInstance?.(null)} onActiveComponent={onSelectInstance}>
      <div aria-label="Visualização da montagem" className="pointer-events-none z-10 flex shrink-0 items-start justify-between gap-2 px-2 py-1">
        <div className="pointer-events-auto flex shrink-0 items-center gap-0.5 rounded-lg border border-primary-100 bg-white/95 p-1 shadow-sm">
          <ProjectionSelector value={projection} onChange={setProjection} />
          {(Object.keys(VIEW_PRESETS) as ViewPreset[]).map(preset=><button key={preset} type="button" title={`Vista ${preset}`} aria-label={`Vista ${preset}`} aria-pressed={view===preset}
            onClick={()=>{setView(preset);setViewToken(t=>t+1);}}
            className={`flex h-8 w-8 items-center justify-center rounded ${view===preset?'bg-primary text-primary-foreground':'text-primary-700 hover:bg-primary-50'}`}>
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="m4 7 8-4 8 4v10l-8 4-8-4Z M4 7l8 4 8-4 M12 11v10"/>
              {preset==='superior'&&<path d="m4 7 8-4 8 4-8 4Z" fill="currentColor" fillOpacity=".3"/>}
              {preset==='frontal'&&<path d="m4 7 8 4v10l-8-4Z" fill="currentColor" fillOpacity=".3"/>}
            </svg>
          </button>)}
          <div className="mx-1 h-5 w-px bg-primary-100"/>
          <button type="button" onClick={()=>setFitToken(t=>t+1)} title="Enquadrar tudo" aria-label="Enquadrar tudo" className="flex h-8 w-8 items-center justify-center rounded text-primary-700 hover:bg-primary-50">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M8 3H3v5 M16 3h5v5 M21 16v5h-5 M8 21H3v-5"/><rect x="7" y="7" width="10" height="10" rx="1"/></svg>
          </button>
          <button type="button" onClick={()=>setWireframe(v=>!v)} title="Wireframe — exibir arestas" aria-label="Wireframe" aria-pressed={wireframe} className={`flex h-8 w-8 items-center justify-center rounded ${wireframe?'bg-primary text-primary-foreground':'text-primary-700 hover:bg-primary-50'}`}>
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m4 7 8-4 8 4v10l-8 4-8-4Z M4 7l8 4 8-4 M12 11v10"/><path strokeDasharray="2 2" d="m4 17 8-4 8 4 M12 3v10"/></svg>
          </button>
        </div>
      </div>
      <div className={`relative min-h-0 flex-1 ${pickMode ? "cursor-crosshair" : ""}`}>
        <CadSelectionCanvas orthographic camera={{ position: VIEW_PRESETS.isometrica, zoom: 2, up: [0, 0, 1], near: 0.1, far: 100000 }}>
          <ProjectionController mode={projection} />
          <color attach="background" args={["#d5dfe9"]} />
          <MaterialLighting/>
          <ambientLight intensity={0.7} />
          <directionalLight position={[1200, -1500, 2200]} intensity={1} />
          <FitAssembly bodies={bodies} sketches={sketches} token={fitToken}/>
          <CameraRig position={VIEW_PRESETS[view]} token={viewToken} />
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
          {sketches.map(({sketch,placement}) => <group key={sketch.id} position={placement.position} quaternion={placement.quaternion}>
            {sketch.shapes.map(shape => {
              const p = sketch.points;
              let points: {x:number;y:number}[] = [];
              if(shape.type === "line") points = [p[shape.p1],p[shape.p2]];
              if(shape.type === "rect") { const a=p[shape.p1],b=p[shape.p2]; points=[a,{x:b.x,y:a.y},b,{x:a.x,y:b.y},a]; }
              if(shape.type === "circle") { const c=p[shape.center]; points=Array.from({length:65},(_,i)=>({x:c.x+shape.radius*Math.cos(i*Math.PI/32),y:c.y+shape.radius*Math.sin(i*Math.PI/32)})); }
              return points.length>1 ? <Line key={shape.id} points={points.map(point=>localToWorldPoint(sketch.plane,point))} color="#16a34a" lineWidth={2} /> : null;
            })}
          </group>)}
          {pickMarkers.map((marker, i) => (
            <PickMarker3D key={i} marker={marker} />
          ))}
          <gridHelper args={[4000, 40]} rotation={[Math.PI / 2, 0, 0]} />
          <axesHelper args={[600]} />
          <CameraApiCapture apiRef={cameraApiRef}/>
          <GizmoHelper alignment="top-right" margin={[70,70]} onTarget={()=>cameraApiRef.current?.controls?.target.clone()??new THREE.Vector3()}>
            <ViewCubeOrbitCatcher apiRef={cameraApiRef}/>
          </GizmoHelper>
          <OrbitControls makeDefault enableZoom zoomToCursor zoomSpeed={1.2} minDistance={10} maxDistance={40000} />
        </CadSelectionCanvas>
        <ViewCubeRotationArrows apiRef={cameraApiRef} orbitTarget={[0,0,0]}/>

        {bodies.length === 0 && sketches.length === 0 && !pickMode && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-primary-500">
            Insira uma peça para começar a montagem.
          </div>
        )}
        {pickMode && pickModeHint && (
          <div className="pointer-events-none absolute left-1/2 top-16 -translate-x-1/2 rounded-full bg-primary-900/95 px-4 py-2 text-sm font-semibold text-white shadow-lg">
            {pickModeHint}
          </div>
        )}
      </div>
      </CadSelectionProvider>
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
  const selection=useCadSelection();
  const beginDrag = useBodyDrag((instanceId, position) => onDragInstance?.(instanceId, position));

  return (
    <>
      {bodies
        .filter((b) => b.visible)
        .map((body) => {
          const isSelected = body.instanceId === selectedInstanceId;
          const color = isSelected ? "#2196f3" : body.color ?? (body.appearance ? undefined : body.grounded ? "#8d6e63" : undefined);
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
                !pickMode&&(!selection?.enabled||selection.filter==='component')
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
              <SolidMesh selectionLabel={body.label??body.instanceId.slice(0,8)} selectionOwner={body.instanceId}
                mesh={body.mesh}
                wireframe={wireframe}
                pickMode={pickMode}
                color={color}
                appearance={body.appearance}
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
