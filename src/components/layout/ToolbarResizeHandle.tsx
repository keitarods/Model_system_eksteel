'use client';
import {useEffect,useRef,useState,type CSSProperties} from 'react';
import './viewport-layout.css';

/** Keep independent heights for the compact and expanded ribbons. */
export function useToolbarSize(workspace:string,compact:boolean,defaultHeight?:number){
 const ref=useRef<HTMLElement|null>(null);
 const [sizes,setSizes]=useState<Record<string,number>>({});
 const key=`eksteel.toolbar-height.${workspace}`;
 const mode=compact?'compact':'expanded';
 useEffect(()=>{try{const saved=JSON.parse(localStorage.getItem(key)||'{}');const valid:Record<string,number>={};for(const m of ['compact','expanded'])if(Number.isFinite(saved?.[m]))valid[m]=Math.max(56,Math.min(320,saved[m]));setSizes(valid);}catch{/* Storage is optional. */}},[key]);
 const change=(height:number|null)=>setSizes(previous=>{
  const next={...previous};
  if(height===null)delete next[mode];else next[mode]=Math.round(Math.max(56,Math.min(320,window.innerHeight*.45,height)));
  try{localStorage.setItem(key,JSON.stringify(next));}catch{/* Resizing still works without storage. */}
  return next;
 });
 const style:CSSProperties={height:sizes[mode]??defaultHeight,maxHeight:'min(320px,45dvh)',overflow:'auto',flexShrink:0};
 return {ref,style,change,height:sizes[mode]??defaultHeight};
}
export function ToolbarResizeHandle({toolbar,label}:{toolbar:ReturnType<typeof useToolbarSize>;label:string}){
 const drag=useRef<{y:number;height:number}|null>(null);
 return <div className="cad-toolbar-resizer" data-cad-divider="toolbar" role="separator" tabIndex={0}
  aria-label={`Altura das ferramentas · ${label}`} aria-orientation="horizontal" aria-valuemin={56} aria-valuemax={320} aria-valuenow={toolbar.height}
  title="Arraste para ajustar a altura. Setas ↑/↓ ajustam; duplo clique restaura."
  onDoubleClick={()=>toolbar.change(null)}
  onKeyDown={e=>{if(['ArrowUp','ArrowDown','Home'].includes(e.key)){e.preventDefault();toolbar.change(e.key==='Home'?null:(toolbar.ref.current?.getBoundingClientRect().height??100)+(e.key==='ArrowDown'?8:-8));}}}
  onPointerDown={e=>{if(e.button!==0)return;e.preventDefault();drag.current={y:e.clientY,height:toolbar.ref.current?.getBoundingClientRect().height??100};e.currentTarget.setPointerCapture(e.pointerId);}}
  onPointerMove={e=>{if(drag.current)toolbar.change(drag.current.height+e.clientY-drag.current.y);}}
  onPointerUp={e=>{drag.current=null;if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);}}
  onPointerCancel={()=>{drag.current=null;}} onLostPointerCapture={()=>{drag.current=null;}}
 ><span/></div>;
}
