'use client';
import { useEffect, useMemo, useState } from 'react';
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber';
import { Bounds, OrbitControls, Html, GizmoHelper, GizmoViewcube } from '@react-three/drei';
import * as THREE from 'three';
import type { ShapeMesh } from 'replicad';
import { SolidMesh } from '@/components/viewer/SolidMesh';
import type { Study, Load } from '@/lib/simulation/types';
import {displayRange,surfaceExtrema,type ColorRange,fieldRange,fieldHue,resultValues,resultFields,type ResultField} from '@/lib/simulation/resultFields';
import {faceBoundaries,selectReference} from '@/lib/simulation/selection';
export {fieldRange};
export type {ResultField};
function Model({study,selected,onSelect,field,scale,wireframe,visibleBody,previewLoad,colorRange,showExtrema,selectionMode,multiple,selectedEdges,onEdges,onHover,selectionDisabled}:{study:Study;selected:number[];onSelect:(id:number,additive:boolean)=>void;field:ResultField;scale:number;wireframe:boolean;visibleBody?:number|null;previewLoad?:Load;colorRange?:ColorRange|null;showExtrema?:boolean;selectionMode:'face'|'edge';multiple:boolean;selectedEdges:string[];onEdges:(ids:string[])=>void;onHover:(text:string)=>void;selectionDisabled?:boolean}){
  const mesh=study.mesh!;
  const {camera,size}=useThree();
  const [hoverFace,setHoverFace]=useState<number|null>(null),[hoverEdge,setHoverEdge]=useState<string|null>(null);
  const boundaries=useMemo(()=>faceBoundaries(mesh),[mesh]);
  const position=(n:number)=>new THREE.Vector3(...mesh.nodes[n]).addScaledVector(new THREE.Vector3(...(study.results?.displacements[n]??[0,0,0])),scale);
  function edgeAt(e:ThreeEvent<PointerEvent>|ThreeEvent<MouseEvent>,faceId:number){
    const mouse=new THREE.Vector2((e.pointer.x+1)*size.width/2,(1-e.pointer.y)*size.height/2);let nearest:string|null=null,best=9;
    for(const edge of boundaries){if(!edge.faceIds.includes(faceId))continue;
      for(const [a,b] of edge.segments){const p=position(a).project(camera),q=position(b).project(camera);if(p.z< -1||p.z>1||q.z< -1||q.z>1)continue;
        const start=new THREE.Vector2((p.x+1)*size.width/2,(1-p.y)*size.height/2),end=new THREE.Vector2((q.x+1)*size.width/2,(1-q.y)*size.height/2),d=end.clone().sub(start);
        const t=Math.max(0,Math.min(1,mouse.clone().sub(start).dot(d)/Math.max(d.lengthSq(),1e-12)));const distance=mouse.distanceTo(start.addScaledVector(d,t));
        if(distance<best){best=distance;nearest=edge.id;}
      }
    }return nearest;
  }
  function hover(e:ThreeEvent<PointerEvent>){
    e.stopPropagation();if(selectionDisabled||e.faceIndex==null)return;
    const faceId=faceIds[e.faceIndex];
    if(selectionMode==='face'){setHoverFace(faceId);setHoverEdge(null);const face=mesh.faces.find(f=>f.id===faceId)!;onHover(`Face ${faceId} · área ${face.area.toFixed(2)} mm²${face.bodyId?` · corpo ${face.bodyId}`:''}`);}
    else{setHoverFace(null);const id=edgeAt(e,faceId);setHoverEdge(id);const edge=boundaries.find(b=>b.id===id);onHover(edge?`Contorno · ${edge.length.toFixed(2)} mm · faces ${edge.faceIds.join(', ')}`:'Aproxime o cursor do contorno da face');}
  }
  function pick(e:ThreeEvent<MouseEvent>){
    e.stopPropagation();if(selectionDisabled||e.button!==0||e.delta>4||e.faceIndex==null)return;
    const faceId=faceIds[e.faceIndex],additive=multiple||e.ctrlKey||e.metaKey||e.shiftKey;
    if(selectionMode==='face')onSelect(faceId,additive);
    else{const id=edgeAt(e,faceId);if(id)onEdges(selectReference(selectedEdges,id,additive));}
  }
  useEffect(()=>{setHoverFace(null);setHoverEdge(null);onHover('');},[mesh,visibleBody,selectionMode,selectionDisabled]);
  const hoverGeometry=useMemo(()=>{const g=new THREE.BufferGeometry(),vertices:number[]=[];if(hoverFace!==null&&!selected.includes(hoverFace))for(const tri of mesh.faces.find(f=>f.id===hoverFace)?.triangles??[])for(const n of tri)vertices.push(...position(n).toArray());g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));return g;},[mesh,hoverFace,selected,scale,study.results]);
  const edgeGeometry=useMemo(()=>{const g=new THREE.BufferGeometry(),vertices:number[]=[],colors:number[]=[];for(const edge of boundaries){if(visibleBody&&!edge.faceIds.some(id=>mesh.faces.some(f=>f.id===id&&f.bodyId===visibleBody)))continue;const active=selectedEdges.includes(edge.id),over=hoverEdge===edge.id;if(selectionMode!=='edge'&&!active)continue;const color=new THREE.Color(active?'#1565c0':over?'#00b8d4':'#455a64');for(const seg of edge.segments)for(const n of seg){vertices.push(...position(n).toArray());colors.push(color.r,color.g,color.b);}}g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));return g;},[boundaries,selectedEdges,hoverEdge,selectionMode,visibleBody,scale,study.results]);
  useEffect(()=>()=>hoverGeometry.dispose(),[hoverGeometry]);
  useEffect(()=>()=>edgeGeometry.dispose(),[edgeGeometry]);
  const loads=previewLoad?[...study.loads,previewLoad]:study.loads;
  const {geometry,faceIds,highlight}=useMemo(()=>{
    const geometry=new THREE.BufferGeometry(),highlight=new THREE.BufferGeometry();
    const positions:number[]=[],colors:number[]=[],faceIds:number[]=[],marked:number[]=[];
    const [min,max]=displayRange(study,field,colorRange);const data=resultValues(study,field);const color=new THREE.Color();
    for(const face of mesh.faces.filter(f=>!visibleBody||f.bodyId===visibleBody))face.triangles.forEach((triangle,index)=>{
      faceIds.push(face.id);
      for(const node of triangle){
        const xyz=mesh.nodes[node].map((v,k)=>v+(study.results?.displacements[node][k]??0)*scale);
        positions.push(...xyz);if(selected.includes(face.id))marked.push(...xyz);
        if(study.results){const value=data.values[data.nodal?node:face.elements[index]];color.setHSL(fieldHue(value,min,max,field),0.85,0.5);}else color.set('#9eb5c9');
        colors.push(color.r,color.g,color.b);
      }
    });
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geometry.computeVertexNormals();
    highlight.setAttribute('position',new THREE.Float32BufferAttribute(marked,3));highlight.computeVertexNormals();
    return {geometry,faceIds,highlight};
  },[mesh,study,selected,field,scale,visibleBody,colorRange]);
  useEffect(()=>()=>{geometry.dispose();highlight.dispose();},[geometry,highlight]);
  const extrema=useMemo(()=>showExtrema?surfaceExtrema(study,field,scale,visibleBody):[],[study,field,scale,visibleBody,showExtrema]);
  const extent=useMemo(()=>{const box=new THREE.Box3();mesh.nodes.forEach(p=>box.expandByPoint(new THREE.Vector3(...p)));return box.getSize(new THREE.Vector3()).length();},[mesh]);
  return <>
    <Bounds fit clip observe margin={1.3}><mesh geometry={geometry} onPointerMove={hover} onPointerOut={()=>{setHoverFace(null);setHoverEdge(null);onHover('');}} onClick={pick}>{study.results?<meshBasicMaterial vertexColors side={THREE.DoubleSide}/>:<meshStandardMaterial vertexColors side={THREE.DoubleSide} roughness={0.7}/>}</mesh></Bounds>
    {wireframe&&<mesh geometry={geometry}><meshBasicMaterial wireframe color="#233e51" transparent opacity={0.35}/></mesh>}
    <mesh geometry={highlight} renderOrder={2} raycast={()=>{}}><meshBasicMaterial color="#1976d2" transparent opacity={0.45} depthWrite={false} polygonOffset polygonOffsetFactor={-2} side={THREE.DoubleSide}/></mesh>
    <mesh geometry={hoverGeometry} renderOrder={3} raycast={()=>{}}><meshBasicMaterial color="#00c8e8" transparent opacity={0.35} depthWrite={false} polygonOffset polygonOffsetFactor={-3} side={THREE.DoubleSide}/></mesh>
    <lineSegments geometry={edgeGeometry} raycast={()=>{}} renderOrder={4}><lineBasicMaterial vertexColors depthWrite={false}/></lineSegments>
    {extrema.map(mark=><group key={mark.label} position={mark.position}>
      <mesh renderOrder={5}><sphereGeometry args={[Math.max(extent*0.006,0.001),12,8]}/><meshBasicMaterial color={mark.label==='Mín'?'#1d4ed8':'#dc2626'} depthTest={false}/></mesh>
      <Html center zIndexRange={[30,0]} style={{pointerEvents:'none',transform:'translateY(-24px)'}}><span className="block whitespace-nowrap rounded border bg-white/95 px-2 py-1 text-xs text-slate-900 shadow">{mark.label} superfície: {mark.value.toExponential(3)}<br/>{mark.nodal?'Nó':'Elemento'} {mark.index+1}</span></Html>
    </group>)}
    {!study.results&&mesh.faces.filter(f=>(!visibleBody||f.bodyId===visibleBody)).filter(f=>study.supports.some(s=>s.faceIds.includes(f.id))||loads.some(l=>l.faceIds.includes(f.id))).map(face=><group key={face.id} position={face.center}>
      {study.supports.some(s=>s.faceIds.includes(face.id))&&<Html distanceFactor={Math.max(extent,1)} center><span className="pointer-events-none rounded bg-emerald-700 px-1.5 py-0.5 text-xs text-white">Apoio</span></Html>}
      {loads.filter(l=>l.faceIds.includes(face.id)).map(load=>{
        const normal=load.kind==='pressure'||load.kind==='force'&&load.direction==='normal';
        const color=load.id===previewLoad?.id?0xf59e0b:0xef4444;
        if(normal){
          const outward=load.kind==='force'?load.inverted:load.pressure<0;
          const stride=Math.max(1,Math.ceil(face.triangles.length/6));
          return <group key={load.id}>{face.triangles.filter((_,i)=>i%stride===0).map((tri,i)=>{
            const [a,b,c]=tri.map(n=>new THREE.Vector3(...mesh.nodes[n]));
            const direction=b.clone().sub(a).cross(c.clone().sub(a));
            if(direction.lengthSq()<1e-24)return null;
            direction.normalize().multiplyScalar(outward?1:-1);
            const origin=a.clone().add(b).add(c).multiplyScalar(1/3).sub(new THREE.Vector3(...face.center));
            if(!outward)origin.addScaledVector(direction,-extent*0.12);
            return <arrowHelper key={i} args={[direction,origin,extent*0.12,color,extent*0.025,extent*0.015]}/>;
          })}</group>;
        }
        const direction=new THREE.Vector3(...load.vector);
        if(direction.length()===0)return null;
        return <arrowHelper key={load.id} args={[direction.normalize(),new THREE.Vector3(),extent*0.12,color,extent*0.025,extent*0.015]}/>;
      })}
    </group>)}
  </>;
}
export function SimulationViewer({study,preview,selected,onSelect,field,scale,wireframe,visibleBody,previewLoad,colorRange,showExtrema,onClear,selectionDisabled}:{study:Study;preview:ShapeMesh|null;selected:number[];onSelect:(id:number,additive:boolean)=>void;field:ResultField;scale:number;wireframe:boolean;visibleBody?:number|null;previewLoad?:Load;colorRange?:ColorRange|null;showExtrema?:boolean;onClear:()=>void;selectionDisabled?:boolean}){
  const [selectionMode,setSelectionMode]=useState<'face'|'edge'>('face');const [multiple,setMultiple]=useState(false);const [selectedEdges,setSelectedEdges]=useState<string[]>([]);const [hoverText,setHoverText]=useState('');
  const boundaries=useMemo(()=>study.mesh?faceBoundaries(study.mesh):[],[study.mesh]);
  const clear=()=>{onClear();setSelectedEdges([]);};
  useEffect(()=>{setSelectedEdges([]);setHoverText('');},[study.mesh,visibleBody]);
  useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.key==='Escape'&&!selectionDisabled&&!(e.target instanceof HTMLElement&&e.target.closest('input,textarea,select,[contenteditable=true]'))){onClear();setSelectedEdges([]);}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[onClear,selectionDisabled]);
  const [min,max]=displayRange(study,field,colorRange);
  return <div className="relative h-full min-h-72 bg-gradient-to-b from-[#b6c5d5] via-[#dbe3eb] to-[#f0f3f6]">
    <Canvas camera={{position:[180,-240,180],up:[0,0,1],near:0.01,far:100000}} onPointerMissed={e=>{if(e.type==='click'&&!selectionDisabled&&!e.ctrlKey&&!e.shiftKey&&!e.metaKey)clear();}}>
      <ambientLight intensity={1.1}/><directionalLight position={[100,-100,200]} intensity={2}/>
      {study.mesh?<Model selectionMode={selectionMode} multiple={multiple} selectedEdges={selectedEdges} onEdges={setSelectedEdges} onHover={setHoverText} selectionDisabled={selectionDisabled} colorRange={colorRange} showExtrema={showExtrema} previewLoad={previewLoad} visibleBody={visibleBody} study={study} selected={selected} onSelect={onSelect} field={field} scale={scale} wireframe={wireframe}/>:preview?<Bounds fit clip observe margin={1.3}><SolidMesh mesh={preview} pickMode={false} wireframe={false}/></Bounds>:null}
      <OrbitControls makeDefault/><axesHelper args={[10]}/><GizmoHelper alignment="top-right" margin={[72,72]}><GizmoViewcube faces={['DIREITA','ESQUERDA','TRÁS','FRENTE','TOPO','BASE']} color="#f5f7fa" hoverColor="#c5def4" textColor="#34465c" strokeColor="#8b9aab"/></GizmoHelper>
    </Canvas>
    {!study.mesh&&!preview&&<div className="pointer-events-none absolute inset-0 flex items-center justify-center p-8 text-center text-sm text-slate-500">{study.step?'Geometria carregada. Gere a malha para selecionar faces e configurar o estudo.':'Importe uma peça STEP ou uma montagem, ou use a geometria aberta no Modelador/Montagem.'}</div>}
    {study.mesh&&<div className="absolute bottom-3 left-3 max-w-[calc(100%-1.5rem)] space-y-2 rounded border border-slate-300 bg-white/95 p-2 text-xs text-slate-700 shadow md:max-w-sm">
      <fieldset disabled={selectionDisabled} className="flex flex-wrap items-center gap-2"><label>Selecionar <select aria-label="Filtro de seleção" className="rounded border p-1" value={selectionMode} onChange={e=>{clear();setSelectionMode(e.target.value as 'face'|'edge');}}><option value="face">Faces</option><option value="edge">Contornos / arestas</option></select></label><label className="flex items-center gap-1"><input type="checkbox" checked={multiple} onChange={e=>setMultiple(e.target.checked)}/>Múltipla</label><button type="button" className="rounded border px-2 py-1" onClick={clear}>Limpar · Esc</button></fieldset>
      <p>{hoverText||'Clique para selecionar · Ctrl/Shift para adicionar ou remover'}</p>
      <p>{selectionMode==='face'?`${selected.length} face(s) selecionada(s)`:`${selectedEdges.length} contorno(s) selecionado(s)`}</p>
      {selectionMode==='edge'&&<><p>Contornos reconstruídos da malha. Cargas, fixações e contatos são aplicados em faces.</p>{selectedEdges.length>0&&<button disabled={selectionDisabled} type="button" className="rounded border px-2 py-1 text-blue-800" onClick={()=>{const ids=[...new Set(boundaries.filter(b=>selectedEdges.includes(b.id)).flatMap(b=>b.faceIds))];onClear();ids.forEach((id,i)=>onSelect(id,i>0));setSelectedEdges([]);setSelectionMode('face');}}>Selecionar faces adjacentes</button>}</>}
    </div>}
    {study.results&&<div className="pointer-events-none absolute bottom-4 right-4 w-52 rounded-lg bg-white/95 p-3 text-xs text-slate-700 shadow">
      <strong>{resultFields[field]}</strong>
      <div className="my-3 flex gap-3"><div className="w-5 shrink-0 border border-slate-400" style={{background:field==='safety'?'linear-gradient(0deg, #eb1717 0%, #eb1717 10%, #ebdd17 55%, #19eb17 100%)':'linear-gradient(0deg, #1729eb, #16ddeb, #2aea19, #edd719, #eb1717)'}}/><div className="flex h-40 flex-col justify-between font-mono text-[10px]">{Array.from({length:6},(_,i)=><span key={i}>{i===0&&(colorRange||field==='safety')?'≥ ':i===5&&colorRange?'≤ ':''}{(max-(max-min)*i/5).toExponential(2)}</span>)}</div></div>
      {field==='safety'&&<p className="mt-2">Vermelho: fator menor que 1. Valores ≥ 10, inclusive tensão nula, usam a cor máxima.</p>}
      {colorRange&&<p className="mt-2">Faixa manual: valores fora dos limites mantêm a cor extrema. Os resultados não são alterados.</p>}
      {showExtrema&&<p className="mt-2">Marcadores: extremos da superfície visível.</p>}
      <p className="mt-2">Deformada: ampliação {scale}×</p>
    </div>}
  </div>;
}
