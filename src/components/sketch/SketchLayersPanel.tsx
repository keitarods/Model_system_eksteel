"use client";
import { useState } from "react";
import { useSketchStore } from "@/lib/sketch/store";
import { createId } from "@/lib/sketch/render";
export function SketchLayersPanel(){
  const [open,setOpen]=useState(false);
  const layers=useSketchStore(s=>s.layers),active=useSketchStore(s=>s.activeLayerId);
  return <div className="flex flex-wrap items-center gap-2 text-xs [&_button]:rounded-lg [&_button]:bg-white [&_button]:px-3 [&_button]:py-1.5 [&_button]:font-semibold [&_button]:text-primary-700 [&_button:hover]:bg-primary-100 [&_button:disabled]:opacity-50"><button type="button" onClick={()=>setOpen(!open)}>Camadas</button>
    {open&&<>
      <select aria-label="Camada ativa" value={active} onChange={e=>useSketchStore.setState({activeLayerId:e.target.value})}>{layers.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select>
      <button type="button" onClick={()=>{const id=createId();useSketchStore.setState({layers:[...layers,{id,name:`Camada ${layers.length+1}`,visible:true,locked:false}],activeLayerId:id});}}>Nova camada</button>
      <button type="button" onClick={()=>{const s=useSketchStore.getState();if(layers.find(l=>l.id===active)?.locked)return;const selected=new Set(s.multiProfileSelection.length?s.multiProfileSelection:[s.selectedShapeId]);useSketchStore.setState({shapes:s.shapes.map(shape=>selected.has(shape.id)&&!layers.find(l=>l.id===(shape.layerId??'0'))?.locked?{...shape,layerId:active}:shape)});}}>Mover seleção para camada</button>
      {layers.map(layer=><label key={layer.id} className="flex items-center gap-1 border px-1">
        <input aria-label={`Nome da camada ${layer.name}`} className="w-24" defaultValue={layer.name} onBlur={e=>{const name=e.target.value.trim();if(name)useSketchStore.setState({layers:layers.map(l=>l.id===layer.id?{...l,name}:l)});}}/>
        <input aria-label={`Visível ${layer.name}`} type="checkbox" checked={layer.visible} onChange={e=>useSketchStore.setState({layers:layers.map(l=>l.id===layer.id?{...l,visible:e.target.checked}:l),selectedShapeId:null,multiProfileSelection:[],selectDrag:null,dragPreview:{}})}/>Visível
        <input aria-label={`Bloquear ${layer.name}`} type="checkbox" checked={layer.locked} onChange={e=>useSketchStore.setState({layers:layers.map(l=>l.id===layer.id?{...l,locked:e.target.checked}:l),selectedShapeId:null,multiProfileSelection:[],selectDrag:null,dragPreview:{}})}/>Bloquear
      </label>)}
    </>}
  </div>;
}
