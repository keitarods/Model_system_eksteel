'use client';
import { useEffect, useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { Bounds, OrbitControls, Html, GizmoHelper, GizmoViewcube } from '@react-three/drei';
import * as THREE from 'three';
import type { ShapeMesh } from 'replicad';
import { SolidMesh } from '@/components/viewer/SolidMesh';
import type { Study, Load } from '@/lib/simulation/types';
import {displayRange,surfaceExtrema,type ColorRange,fieldRange,fieldHue,resultValues,resultFields,type ResultField} from '@/lib/simulation/resultFields';
export {fieldRange};
export type {ResultField};
function Model({study,selected,onSelect,field,scale,wireframe,visibleBody,previewLoad,colorRange,showExtrema}:{study:Study;selected:number[];onSelect:(id:number)=>void;field:ResultField;scale:number;wireframe:boolean;visibleBody?:number|null;previewLoad?:Load;colorRange?:ColorRange|null;showExtrema?:boolean}){
  const mesh=study.mesh!;
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
    <Bounds fit clip observe margin={1.3}><mesh geometry={geometry} onClick={e=>{e.stopPropagation();if(e.faceIndex!=null)onSelect(faceIds[e.faceIndex]);}}>{study.results?<meshBasicMaterial vertexColors side={THREE.DoubleSide}/>:<meshStandardMaterial vertexColors side={THREE.DoubleSide} roughness={0.7}/>}</mesh></Bounds>
    {wireframe&&<mesh geometry={geometry}><meshBasicMaterial wireframe color="#233e51" transparent opacity={0.35}/></mesh>}
    <mesh geometry={highlight} renderOrder={2}><meshBasicMaterial color="#f59e0b" transparent opacity={0.45} depthTest={false} side={THREE.DoubleSide}/></mesh>
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
export function SimulationViewer({study,preview,selected,onSelect,field,scale,wireframe,visibleBody,previewLoad,colorRange,showExtrema}:{study:Study;preview:ShapeMesh|null;selected:number[];onSelect:(id:number)=>void;field:ResultField;scale:number;wireframe:boolean;visibleBody?:number|null;previewLoad?:Load;colorRange?:ColorRange|null;showExtrema?:boolean}){
  const [min,max]=displayRange(study,field,colorRange);
  return <div className="relative h-full min-h-72 bg-gradient-to-b from-[#b6c5d5] via-[#dbe3eb] to-[#f0f3f6]">
    <Canvas camera={{position:[180,-240,180],up:[0,0,1],near:0.01,far:100000}} onPointerMissed={()=>{}}>
      <ambientLight intensity={1.1}/><directionalLight position={[100,-100,200]} intensity={2}/>
      {study.mesh?<Model colorRange={colorRange} showExtrema={showExtrema} previewLoad={previewLoad} visibleBody={visibleBody} study={study} selected={selected} onSelect={onSelect} field={field} scale={scale} wireframe={wireframe}/>:preview?<Bounds fit clip observe margin={1.3}><SolidMesh mesh={preview} pickMode={false} wireframe={false}/></Bounds>:null}
      <OrbitControls makeDefault/><axesHelper args={[10]}/><GizmoHelper alignment="top-right" margin={[72,72]}><GizmoViewcube faces={['DIREITA','ESQUERDA','TRÁS','FRENTE','TOPO','BASE']} color="#f5f7fa" hoverColor="#c5def4" textColor="#34465c" strokeColor="#8b9aab"/></GizmoHelper>
    </Canvas>
    {!study.mesh&&!preview&&<div className="pointer-events-none absolute inset-0 flex items-center justify-center p-8 text-center text-sm text-slate-500">{study.step?'Geometria carregada. Gere a malha para selecionar faces e configurar o estudo.':'Importe uma peça STEP ou uma montagem, ou use a geometria aberta no Modelador/Montagem.'}</div>}
    {study.mesh&&!study.results&&<p className="pointer-events-none absolute bottom-3 left-3 rounded bg-white/90 px-3 py-2 text-xs text-slate-600">Clique nas faces para selecionar ou desmarcar · {selected.length} selecionada(s)</p>}
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
