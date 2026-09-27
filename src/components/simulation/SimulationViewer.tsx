'use client';
import { useEffect, useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { Bounds, OrbitControls, Html } from '@react-three/drei';
import * as THREE from 'three';
import type { ShapeMesh } from 'replicad';
import { SolidMesh } from '@/components/viewer/SolidMesh';
import type { Study } from '@/lib/simulation/types';
export type ResultField='displacement'|'stress'|'strainX';
export function fieldRange(study:Study,field:ResultField):[number,number]{
  const r=study.results;if(!r)return [0,0];
  const values=field==='displacement'?r.displacementMagnitude:field==='stress'?r.elementVonMises:r.elementStrain.map(s=>s[0]);
  let min=Infinity,max=-Infinity;for(const v of values){min=Math.min(min,v);max=Math.max(max,v);}return [min,max];
}
function Model({study,selected,onSelect,field,scale,wireframe}:{study:Study;selected:number[];onSelect:(id:number)=>void;field:ResultField;scale:number;wireframe:boolean}){
  const mesh=study.mesh!;
  const {geometry,faceIds,highlight}=useMemo(()=>{
    const geometry=new THREE.BufferGeometry(),highlight=new THREE.BufferGeometry();
    const positions:number[]=[],colors:number[]=[],faceIds:number[]=[],marked:number[]=[];
    const [min,max]=fieldRange(study,field);const color=new THREE.Color();
    for(const face of mesh.faces)face.triangles.forEach((triangle,index)=>{
      faceIds.push(face.id);
      for(const node of triangle){
        const xyz=mesh.nodes[node].map((v,k)=>v+(study.results?.displacements[node][k]??0)*scale);
        positions.push(...xyz);if(selected.includes(face.id))marked.push(...xyz);
        if(study.results){const value=field==='displacement'?study.results.displacementMagnitude[node]:field==='stress'?study.results.elementVonMises[face.elements[index]]:study.results.elementStrain[face.elements[index]][0];color.setHSL((1-(max===min?0:(value-min)/(max-min)))*0.66,0.85,0.5);}else color.set('#9eb5c9');
        colors.push(color.r,color.g,color.b);
      }
    });
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geometry.computeVertexNormals();
    highlight.setAttribute('position',new THREE.Float32BufferAttribute(marked,3));highlight.computeVertexNormals();
    return {geometry,faceIds,highlight};
  },[mesh,study,selected,field,scale]);
  useEffect(()=>()=>{geometry.dispose();highlight.dispose();},[geometry,highlight]);
  const extent=useMemo(()=>{const box=new THREE.Box3();mesh.nodes.forEach(p=>box.expandByPoint(new THREE.Vector3(...p)));return box.getSize(new THREE.Vector3()).length();},[mesh]);
  return <>
    <Bounds fit clip observe margin={1.3}><mesh geometry={geometry} onClick={e=>{e.stopPropagation();if(e.faceIndex!=null)onSelect(faceIds[e.faceIndex]);}}><meshStandardMaterial vertexColors side={THREE.DoubleSide} roughness={0.7}/></mesh></Bounds>
    {wireframe&&<mesh geometry={geometry}><meshBasicMaterial wireframe color="#233e51" transparent opacity={0.35}/></mesh>}
    <mesh geometry={highlight} renderOrder={2}><meshBasicMaterial color="#f59e0b" transparent opacity={0.45} depthTest={false} side={THREE.DoubleSide}/></mesh>
    {!study.results&&mesh.faces.filter(f=>study.supports.some(s=>s.faceIds.includes(f.id))||study.loads.some(l=>l.faceIds.includes(f.id))).map(face=><group key={face.id} position={face.center}>
      {study.supports.some(s=>s.faceIds.includes(face.id))&&<Html distanceFactor={Math.max(extent,1)} center><span className="pointer-events-none rounded bg-emerald-700 px-1.5 py-0.5 text-xs text-white">Apoio</span></Html>}
      {study.loads.filter(l=>l.faceIds.includes(face.id)).map(load=>{const direction=new THREE.Vector3(...load.vector);if(load.kind==='pressure'){const tri=face.triangles[0];direction.subVectors(new THREE.Vector3(...mesh.nodes[tri[1]]),new THREE.Vector3(...mesh.nodes[tri[0]])).cross(new THREE.Vector3(...mesh.nodes[tri[2]]).sub(new THREE.Vector3(...mesh.nodes[tri[0]]))).multiplyScalar(load.pressure>=0?-1:1);}if(direction.length()===0)return null;return <arrowHelper key={load.id} args={[direction.normalize(),new THREE.Vector3(),extent*0.12,0xef4444,extent*0.025,extent*0.015]}/>;})}
    </group>)}
  </>;
}
export function SimulationViewer({study,preview,selected,onSelect,field,scale,wireframe}:{study:Study;preview:ShapeMesh|null;selected:number[];onSelect:(id:number)=>void;field:ResultField;scale:number;wireframe:boolean}){
  const [min,max]=fieldRange(study,field);
  return <div className="relative h-full min-h-72 bg-slate-50">
    <Canvas camera={{position:[180,-240,180],up:[0,0,1],near:0.01,far:100000}} onPointerMissed={()=>{}}>
      <ambientLight intensity={1.1}/><directionalLight position={[100,-100,200]} intensity={2}/>
      {study.mesh?<Model study={study} selected={selected} onSelect={onSelect} field={field} scale={scale} wireframe={wireframe}/>:preview?<Bounds fit clip observe margin={1.3}><SolidMesh mesh={preview} pickMode={false} wireframe={false}/></Bounds>:null}
      <OrbitControls makeDefault/><axesHelper args={[10]}/>
    </Canvas>
    {!study.mesh&&!preview&&<div className="pointer-events-none absolute inset-0 flex items-center justify-center p-8 text-center text-sm text-slate-500">{study.step?'Geometria carregada. Gere a malha para selecionar faces e configurar o estudo.':'Importe uma peça STEP ou uma montagem, ou use a geometria aberta no Modelador/Montagem.'}</div>}
    {study.mesh&&!study.results&&<p className="pointer-events-none absolute bottom-3 left-3 rounded bg-white/90 px-3 py-2 text-xs text-slate-600">Clique nas faces para selecionar ou desmarcar · {selected.length} selecionada(s)</p>}
    {study.results&&<div className="pointer-events-none absolute bottom-4 right-4 w-52 rounded-lg bg-white/95 p-3 text-xs text-slate-700 shadow">
      <strong>{field==='stress'?'Von Mises · MPa (elemento)':field==='strainX'?'Deformação εxx · mm/mm':'Deslocamento total · mm'}</strong>
      <div className="my-2 h-3 rounded" style={{background:'linear-gradient(90deg, #1729eb, #16ddeb, #2aea19, #edd719, #eb1717)'}}/>
      <div className="flex justify-between"><span>{min.toExponential(3)}</span><span>{max.toExponential(3)}</span></div>
      <p className="mt-2">Deformada: ampliação {scale}×</p>
    </div>}
  </div>;
}
