"use client";

import { useEffect, useMemo, useState } from "react";
import { useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import type { Appearance } from "@/lib/materials/library";
import type { ShapeMesh } from "replicad";

import {cadEdgeCoordinates} from '@/lib/replicad/selectionEdges';
import {useCadSelection,type CadReference} from './CadSelection';

type CadMesh=ShapeMesh&{cadEdges?:{lines:number[];edgeGroups:{start:number;count:number;edgeId:number}[]}};
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
  appearance,
  selectionOwner="part",selectionLabel,
}: {
  mesh: ShapeMesh;
  wireframe: boolean;
  pickMode: boolean;
  onPick?: (origin: [number, number, number], normal: [number, number, number], selection?: { faceId: number; endpoint: boolean; edge?: boolean; circle?: boolean }) => void;
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
  appearance?: Appearance;
  selectionOwner?:string;selectionLabel?:string;
}) {
  const selection=useCadSelection();const inspecting=!!selection?.enabled&&!pickMode;
  const {camera,size}=useThree();
  const cadEdges=(mesh as CadMesh).cadEdges;
  const reference=(kind:CadReference['kind'],id:number):CadReference=>({owner:selectionOwner,kind,id,key:`${selectionOwner}/${kind}/${id}`,label:`${kind==='edge'?'Aresta':kind==='face'?'Face':'Componente'} ${kind==='component'?(selectionLabel??selectionOwner):id}`});
  function inspectHit(event:ThreeEvent<MouseEvent|PointerEvent>):CadReference|null{
    if(!selection)return null;
    if(selection.filter==='component')return reference('component',0);
    if(selection.filter!=='face'&&cadEdges){
      const mouse=new THREE.Vector2((event.pointer.x+1)*size.width/2,(1-event.pointer.y)*size.height/2);let best=9,edgeId:number|null=null;
      for(const group of cadEdges.edgeGroups)for(let i=group.start*3;i<(group.start+group.count)*3;i+=6){
        const a=new THREE.Vector3().fromArray(cadEdges.lines,i).applyMatrix4(event.object.matrixWorld),b=new THREE.Vector3().fromArray(cadEdges.lines,i+3).applyMatrix4(event.object.matrixWorld);
        // Only consider edges close in depth to the frontmost surface hit.
        const mid=a.clone().add(b).multiplyScalar(.5),surfaceDepth=event.point.distanceTo(camera.position);
        if(mid.distanceTo(camera.position)>surfaceDepth+a.distanceTo(b)*.5+Math.max(.001,surfaceDepth*.01))continue;
        a.project(camera);b.project(camera);if(a.z< -1||a.z>1||b.z< -1||b.z>1)continue;
        const start=new THREE.Vector2((a.x+1)*size.width/2,(1-a.y)*size.height/2),end=new THREE.Vector2((b.x+1)*size.width/2,(1-b.y)*size.height/2),delta=end.clone().sub(start);
        const t=Math.max(0,Math.min(1,mouse.clone().sub(start).dot(delta)/Math.max(1e-12,delta.lengthSq()))),distance=mouse.distanceTo(start.addScaledVector(delta,t));
        if(distance<best){best=distance;edgeId=group.edgeId;}
      }
      if(edgeId!==null)return reference('edge',edgeId);
    }
    if(selection.filter==='edge')return null;
    const faceId=faceIdAt(event);return faceId===null?null:reference('face',faceId);
  }
  const inspection=useMemo(()=>{
    const faceGeometry=new THREE.BufferGeometry(),edgeGeometry=new THREE.BufferGeometry();const indices:number[]=[],lines:number[]=[],colors:number[]=[],edgeColors:number[]=[];
    if(inspecting&&selection){
      const refs=selection.items.filter(x=>x.owner===selectionOwner);const hovered=selection.hover?.owner===selectionOwner?selection.hover:null;
      for(const group of mesh.faceGroups){const active=refs.some(x=>x.kind==='component'||x.kind==='face'&&x.id===group.faceId),over=hovered&&(hovered.kind==='component'||hovered.kind==='face'&&hovered.id===group.faceId);if(active||over){const color=new THREE.Color(active?'#1976d2':'#00c8e8');for(const index of mesh.triangles.slice(group.start,group.start+group.count)){indices.push(...mesh.vertices.slice(index*3,index*3+3));colors.push(color.r,color.g,color.b);}}}
      for(const group of cadEdges?.edgeGroups??[]){const active=refs.some(x=>x.kind==='edge'&&x.id===group.edgeId),over=hovered?.kind==='edge'&&hovered.id===group.edgeId;if(active||over){const coordinates=cadEdgeCoordinates(cadEdges!.lines,group);lines.push(...coordinates);const color=new THREE.Color(active?'#1976d2':'#00c8e8');for(let i=0;i<coordinates.length;i+=3)edgeColors.push(color.r,color.g,color.b);}}
    }
    faceGeometry.setAttribute('position',new THREE.Float32BufferAttribute(indices,3));faceGeometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));edgeGeometry.setAttribute('position',new THREE.Float32BufferAttribute(lines,3));edgeGeometry.setAttribute('color',new THREE.Float32BufferAttribute(edgeColors,3));return {faceGeometry,edgeGeometry};
  },[mesh,cadEdges,selection?.items,selection?.hover,inspecting,selectionOwner]);
  useEffect(()=>()=>{inspection.faceGeometry.dispose();inspection.edgeGeometry.dispose();},[inspection]);
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
  function faceIdAt(event: ThreeEvent<PointerEvent | MouseEvent>): number | null {
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
    const faceId = faceIdAt(event);
    onPick(
      [event.point.x, event.point.y, event.point.z],
      [worldNormal.x, worldNormal.y, worldNormal.z],
      faceId === null ? undefined : { faceId, endpoint: event.shiftKey && event.altKey, edge: event.shiftKey && !event.altKey, circle: event.altKey && !event.shiftKey }
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
        onClick={pickMode ? handleClick : inspecting ? event=>{event.stopPropagation();if(event.button!==0||event.delta>4)return;const hit=inspectHit(event);if(hit){selection!.pick(hit,event.ctrlKey||event.metaKey||event.shiftKey);}}:undefined}
        onContextMenu={!pickMode && onContextMenu ? handleContextMenu : undefined}
        onPointerMove={pickMode ? handlePointerMove : inspecting?event=>{event.stopPropagation();const hit=inspectHit(event);if(hit?.key!==selection!.hover?.key)selection!.setHover(hit);}:undefined}
        onPointerOut={pickMode ? handlePointerOut : inspecting?()=>selection!.setHover(null):undefined}
      >
        <meshStandardMaterial
          color={color ?? appearance?.color ?? (pickMode ? "#78909C" : "#546E7A")}
          wireframe={wireframe}
          side={THREE.DoubleSide}
          metalness={appearance?.metalness ?? 0.05}
          roughness={appearance?.roughness ?? 0.65}
          transparent={(appearance?.opacity ?? 1)<1}
          opacity={appearance?.opacity ?? 1}
          depthWrite={(appearance?.opacity ?? 1)>=1}
        />
      </mesh>
      {inspecting&&<><mesh geometry={inspection.faceGeometry} raycast={()=>{}} renderOrder={3}><meshBasicMaterial vertexColors transparent opacity={0.45} depthWrite={false} polygonOffset polygonOffsetFactor={-2} side={THREE.DoubleSide}/></mesh><lineSegments geometry={inspection.edgeGeometry} raycast={()=>{}} renderOrder={4}><lineBasicMaterial vertexColors depthWrite={false}/></lineSegments></>}
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
