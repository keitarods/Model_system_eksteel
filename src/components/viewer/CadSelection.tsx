'use client';
import {createContext,useContext,useEffect,useState,type ReactNode,type ComponentProps} from 'react';
import {Canvas} from '@react-three/fiber';
export type CadFilter='face'|'edge'|'mixed'|'component';
export type CadReference={key:string;owner:string;kind:'face'|'edge'|'component';id:number;label:string};
export function toggleCadReference(items:CadReference[],item:CadReference,additive:boolean){return additive?(items.some(x=>x.key===item.key)?items.filter(x=>x.key!==item.key):[...items,item]):[item];}
type Selection={filter:CadFilter;items:CadReference[];hover:CadReference|null;enabled:boolean;multiple:boolean;setHover:(item:CadReference|null)=>void;pick:(item:CadReference,additive:boolean)=>void;clear:()=>void;};
const Context=createContext<Selection|null>(null);
export const useCadSelection=()=>useContext(Context);
export function CadSelectionProvider({children,enabled,resetKey,assembly=false,onClear,onActiveComponent}:{children:ReactNode;enabled:boolean;resetKey:unknown;assembly?:boolean;onClear?:()=>void;onActiveComponent?:(id:string|null)=>void}){
 const [filter,setFilter]=useState<CadFilter>(assembly?'component':'mixed'),[items,setItems]=useState<CadReference[]>([]),[hover,setHover]=useState<CadReference|null>(null),[multiple,setMultiple]=useState(false);
 const update=(next:CadReference[])=>{setItems(next);onActiveComponent?.([...next].reverse().find(item=>item.kind==='component')?.owner??null);};
 const clear=()=>{setItems([]);setHover(null);onClear?.();};
 useEffect(()=>{setItems([]);setHover(null);},[resetKey,enabled]);
 useEffect(()=>{const key=(e:KeyboardEvent)=>{if(enabled&&e.key==='Escape'&&!(e.target instanceof HTMLElement&&e.target.closest('input,textarea,select,[contenteditable=true]')))clear();};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[enabled,onClear]);
 return <Context.Provider value={{filter,items,hover,enabled,multiple,setHover,pick:(item,additive)=>update(toggleCadReference(items,item,additive||multiple)),clear}}>
  <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-300 bg-slate-50 px-3 py-1 text-xs text-slate-700" aria-label="Filtros de seleção CAD">
   <label>Selecionar <select aria-label="Filtro de seleção CAD" disabled={!enabled} className="rounded border bg-white px-2 py-1" value={filter} onChange={e=>{clear();setFilter(e.target.value as CadFilter);}}><option value="face">Faces</option><option value="edge">Arestas</option><option value="mixed">Faces e arestas</option><option value="component">{assembly?'Componente':'Peça inteira'}</option></select></label>
   <label className="flex items-center gap-1"><input disabled={!enabled} type="checkbox" checked={multiple} onChange={e=>setMultiple(e.target.checked)}/>Múltipla</label>
   <button type="button" disabled={!enabled||!items.length} className="rounded border px-2 py-1 disabled:opacity-40" onClick={clear}>Limpar · Esc</button>
   <span role="status">{enabled?(hover?.label??`${items.length} referência(s) · Ctrl/Shift adiciona ou remove`):'Seleção guiada pelo comando ativo'}</span>
   {enabled&&items.length>0&&<span className="flex max-w-lg gap-1 overflow-x-auto">{items.map(item=><button key={item.key} type="button" className="shrink-0 rounded border border-blue-200 bg-blue-50 px-2 py-1" aria-label={`Remover ${item.label}`} onClick={()=>{const next=items.filter(x=>x.key!==item.key);update(next);if(!next.length)onClear?.();}}>{item.label} ×</button>)}</span>}
   {assembly&&enabled&&items.length>1&&<span className="text-slate-500">Operações usam o último componente ativado.</span>}
  </div>{children}
 </Context.Provider>;
}

export function CadSelectionCanvas(props:ComponentProps<typeof Canvas>){
 const selection=useCadSelection();
 return <Canvas {...props} onPointerMissed={event=>{props.onPointerMissed?.(event);if(event.type==='click'&&selection?.enabled&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey)selection.clear();}}/>;
}
