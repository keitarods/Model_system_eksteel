"use client";
import {useEffect,useState} from 'react';
import './viewport-layout.css';

export function useViewportLayout(){
 const [compact,setCompact]=useState(true);
 const [focused,setFocused]=useState(false);
 useEffect(()=>{
  if(!focused)return;
  const escape=(e:KeyboardEvent)=>{if(e.key==='Escape'&&!(e.target instanceof Element&&e.target.closest('input,textarea,select,[contenteditable=true]')))setFocused(false);};
  window.addEventListener('keydown',escape);return ()=>window.removeEventListener('keydown',escape);
 },[focused]);
 return {compact,setCompact,focused,setFocused};
}
export function ViewportLayoutControls({layout}:{layout:ReturnType<typeof useViewportLayout>}){
 return <div className="viewport-layout-controls" role="group" aria-label="Área de visualização 3D">
  <button type="button" aria-pressed={layout.compact} title="Alternar entre comandos compactos e faixa expandida" onClick={()=>layout.setCompact(!layout.compact)}>Barra compacta</button>
  <button type="button" aria-pressed={layout.focused} title="Recolher barras e painéis para ampliar o 3D. Esc restaura o layout." onClick={()=>layout.setFocused(!layout.focused)}>{layout.focused?'Restaurar painéis':'Ampliar 3D'}</button>
 </div>;
}
