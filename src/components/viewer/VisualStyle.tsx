'use client';
import {useEffect,useMemo,useState} from 'react';
import * as THREE from 'three';
import {VISUAL_STYLES,isVisualStyle,visualStyleSettings,type VisualStyle} from '@/lib/viewer/visualStyles';
import type {Appearance} from '@/lib/materials/library';
export type {VisualStyle};

export function useVisualStyle(tool:'modelador'|'montagem'|'simulacao'){
  const [style,setStyle]=useState<VisualStyle>('realistic');
  const key=`eksteel:visual-style:${tool}`;
  useEffect(()=>{try{const saved=localStorage.getItem(key);if(isVisualStyle(saved))setStyle(saved);}catch{/* Storage may be disabled. */}},[key]);
  const change=(next:VisualStyle)=>{setStyle(next);try{localStorage.setItem(key,next);}catch{/* Keep the current session preference. */}};
  return [style,change] as const;
}

export function VisualStyleSelector({value,onChange}:{value:VisualStyle;onChange:(style:VisualStyle)=>void}){
  return <label className="flex min-w-0 items-center gap-2 text-xs text-primary-700">
    <span className="shrink-0">Estilo visual</span>
    <select aria-label="Estilo visual" className="min-w-0 max-w-60 rounded border border-primary-200 bg-white px-2 py-1.5" value={value} onChange={e=>{if(isVisualStyle(e.target.value))onChange(e.target.value);}}>
      {VISUAL_STYLES.map(style=><option key={style.id} value={style.id}>{style.label}</option>)}
    </select>
  </label>;
}

/** Invisible surfaces still support picking and occlude hidden edges. FEA result
 * colors remain unlit and retain their scientific palette in all filled styles.
 */
export function VisualSurfaceMaterial({style,color='#546E7A',appearance,vertexColors=false,results=false}:{style:VisualStyle;color?:string;appearance?:Appearance;vertexColors?:boolean;results?:boolean}){
  const settings=visualStyleSettings(style);
  if(!settings.faces)return <meshBasicMaterial key="depth" colorWrite={false} depthWrite={settings.hidden!=='solid'} side={THREE.DoubleSide} polygonOffset polygonOffsetFactor={1} polygonOffsetUnits={1}/>;
  // These are different uses of MeshBasicMaterial. Remount on transition so
  // R3F cannot retain the depth-only pass's disabled color/depth writes.
  if(results)return <meshBasicMaterial key="results" colorWrite depthWrite vertexColors={vertexColors} side={THREE.DoubleSide} toneMapped={false} polygonOffset polygonOffsetFactor={1} polygonOffsetUnits={1}/>;
  const realistic=style==='realistic',opacity=appearance?.opacity??1;
  return <meshStandardMaterial key="surface" colorWrite color={style==='monochrome'?'#b8bec5':color} vertexColors={vertexColors&&style!=='monochrome'}
    side={THREE.DoubleSide} metalness={realistic?(appearance?.metalness??0.05):0} roughness={realistic?(appearance?.roughness??0.65):1}
    envMapIntensity={realistic?1:0} transparent={opacity<1} opacity={opacity} depthWrite={opacity>=1}
    polygonOffset polygonOffsetFactor={1} polygonOffsetUnits={1}/>;
}

export function VisualEdges({positions,style}:{positions:number[];style:VisualStyle}){
  const settings=visualStyleSettings(style);
  const {geometry,dash}=useMemo(()=>{
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    const distances:number[]=[];
    for(let i=0;i<positions.length;i+=6)distances.push(0,Math.hypot(positions[i+3]-positions[i],positions[i+4]-positions[i+1],positions[i+5]-positions[i+2]));
    geometry.setAttribute('lineDistance',new THREE.Float32BufferAttribute(distances,1));
    geometry.computeBoundingSphere();
    return {geometry,dash:Math.max((geometry.boundingSphere?.radius??1)*0.015,0.001)};
  },[positions]);
  useEffect(()=>()=>geometry.dispose(),[geometry]);
  if(!settings.edges)return null;
  return <>
    <lineSegments geometry={geometry} raycast={()=>{}} renderOrder={1}>
      <lineBasicMaterial color="#243746" depthTest={settings.hidden!=='solid'} depthWrite={false} toneMapped={false}/>
    </lineSegments>
    {settings.hidden==='dashed'&&<lineSegments geometry={geometry} raycast={()=>{}} renderOrder={2}>
      <lineDashedMaterial color="#617586" transparent opacity={0.55} dashSize={dash} gapSize={dash*0.65}
        depthFunc={THREE.GreaterDepth} depthWrite={false} toneMapped={false}/>
    </lineSegments>}
  </>;
}
