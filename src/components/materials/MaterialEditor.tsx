'use client';
import {useMemo,useRef,useState,useSyncExternalStore} from 'react';
import {blankPhysical,DEFAULT_APPEARANCE,PHYSICAL_FIELDS,parseMaterialLibrary,serializeMaterialLibrary,validateMaterial,type MaterialDefinition} from '@/lib/materials/library';
import {parseAdsklib,unzipAdsklib} from '@/lib/materials/adsklib';
import {byName,userMaterials,withDefaultMaterials} from '@/lib/materials/defaults';
import {useBuiltInMaterials} from '@/lib/materials/builtInLibrary';
import {type PartProperties} from '@/lib/project/partProperties';
const key='eksteel-material-library-v1';
function subscribe(onChange:()=>void){window.addEventListener('storage',onChange);window.addEventListener('eksteel-materials-changed',onChange);return ()=>{window.removeEventListener('storage',onChange);window.removeEventListener('eksteel-materials-changed',onChange);};}
function snapshot(){try{return localStorage.getItem(key);}catch{return null;}}
const serverSnapshot=()=>null;
const field='mt-1 w-full rounded border border-slate-300 bg-white p-1.5 text-sm text-slate-900';
const button='rounded border border-slate-300 px-2 py-1.5 text-xs hover:bg-slate-100';
/** Biblioteca embutida do Inventor + materiais salvos neste navegador. */
export function useMaterialLibrary(){
  const json=useSyncExternalStore(subscribe,snapshot,serverSnapshot);
  const builtIn=useBuiltInMaterials();
  return useMemo(()=>{
    const base={builtIn:builtIn.materials,builtInStatus:builtIn.status,builtInMessage:builtIn.message};
    try{return {...base,library:withDefaultMaterials(builtIn.materials,json?parseMaterialLibrary(json):[]),restoreError:''};}
    catch{return {...base,library:withDefaultMaterials(builtIn.materials,[]),restoreError:'Não foi possível restaurar os materiais salvos localmente. Importe o arquivo novamente.'};}
  },[json,builtIn]);
}
export function MaterialEditor({properties,onChange}:{properties:PartProperties;onChange:(patch:Partial<PartProperties>)=>void}){
  const {library,restoreError,builtIn,builtInStatus,builtInMessage}=useMaterialLibrary();
  const [query,setQuery]=useState('');const [message,setMessage]=useState('');const file=useRef<HTMLInputElement>(null);
  const current=properties.materialDefinition;
  function apply(m:MaterialDefinition){const copy=validateMaterial(m);onChange({material:copy.name,density:copy.physical.density??0,materialDefinition:copy});}
  function edit(patch:Partial<MaterialDefinition>){const base=current??{id:crypto.randomUUID(),name:properties.material||'Material personalizado',category:'Personalizado',source:'Definido pelo usuário',notes:'',physical:{...blankPhysical(),density:properties.density},appearance:{...DEFAULT_APPEARANCE}};apply({...base,...patch,modified:true});}
  function saveLibrary(materials:MaterialDefinition[]){const own=userMaterials(materials,builtIn);if(own.length)localStorage.setItem(key,serializeMaterialLibrary(own));else localStorage.removeItem(key);window.dispatchEvent(new Event('eksteel-materials-changed'));}
  async function importLibrary(selected:File){try{const adsk=/\.adsklib$/i.test(selected.name);if(selected.size>(adsk?60_000_000:15_000_000))throw Error(adsk?'Biblioteca .adsklib acima de 60 MB.':'Biblioteca acima de 15 MB.');const incoming=adsk?parseAdsklib(unzipAdsklib(new Uint8Array(await selected.arrayBuffer())),selected.name):parseMaterialLibrary(await selected.text());const map=new Map(library.map(m=>[m.id,m]));incoming.forEach(m=>map.set(m.id,m));saveLibrary([...map.values()]);setMessage(`${incoming.length} materiais importados. Escolha um para aplicar à peça.`);}catch(e){setMessage(e instanceof Error?e.message:'Falha na importação.');}}
  function exportLibrary(){const url=URL.createObjectURL(new Blob([serializeMaterialLibrary(library)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='materiais.eksmaterials.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  return <section className="col-span-2 space-y-3 rounded-lg border border-slate-200 p-3">
    <strong className="text-sm">Biblioteca de materiais e aparências</strong>
    <div className="flex flex-wrap gap-2"><button type="button" className={button} onClick={()=>file.current?.click()}>Importar biblioteca (.adsklib ou JSON)</button><button type="button" className={button} onClick={exportLibrary}>Exportar biblioteca</button><button type="button" className={button} onClick={()=>{try{const m=validateMaterial(current);saveLibrary([...library.filter(v=>v.id!==m.id),m]);setMessage('Material salvo na biblioteca local.');}catch(e){setMessage(e instanceof Error?e.message:'Selecione um material.');}}}>Salvar material na biblioteca</button></div>
    <a className="block text-xs text-blue-700 underline" href="/materials/export-inventor-materials.ps1" download>Baixar exportador para Inventor (Windows PowerShell 5.1)</a>
    <input ref={file} type="file" hidden accept=".json,.adsklib" onChange={e=>{const selected=e.target.files?.[0];if(selected)void importLibrary(selected);e.target.value='';}}/>
    <label className="block">Pesquisar material<input className={field} value={query} onChange={e=>setQuery(e.target.value)} placeholder="Nome, categoria ou biblioteca"/></label>
    <select aria-label="Aplicar material à peça" className={field} value={current?.id??''} onChange={e=>{const m=library.find(v=>v.id===e.target.value);if(m)apply(m);}}><option value="">Escolha um material</option>{current&&!library.some(m=>m.id===current.id)&&<option value={current.id}>{current.name} (na peça)</option>}{library.filter(m=>m.id===current?.id||`${m.name} ${m.category} ${m.source}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())).sort(byName).map(m=><option key={m.id} value={m.id}>{m.name} · {m.category}</option>)}</select>
    {builtInStatus==='loading'&&<p role="status" className="text-xs text-slate-500">Carregando a biblioteca padrão…</p>}{builtInMessage&&<p role="alert" className="text-xs text-amber-800">{builtInMessage}</p>}{restoreError&&<p role="alert" className="text-xs text-red-700">{restoreError}</p>}
    {message&&<p role="status" className="text-xs text-blue-800">{message}</p>}
    <p className="text-xs text-slate-500">A biblioteca padrão é a Inventor Material Library (valores do ativo físico). Outros .adsklib ou JSON podem ser importados; campos vazios são propriedades desconhecidas.</p>
    {current&&<p className="text-xs text-slate-500">Origem: {current.source}{current.modified?' · editado localmente':''}<br/>{current.notes}</p>}
    <label className="block">Nome do material<input className={field} value={current?.name??properties.material} onChange={e=>edit({name:e.target.value||'Material personalizado'})}/></label>
    <label className="block">Comportamento mecânico<select className={field} value={current?.behavior??"unknown"} onChange={e=>edit({behavior:e.target.value as MaterialDefinition["behavior"]})}><option value="unknown">Não confirmado</option><option value="isotropic">Isotrópico</option><option value="orthotropic">Ortotrópico (fora do solver atual)</option></select></label>
    <div className="grid grid-cols-2 gap-3">{PHYSICAL_FIELDS.map(([name,label,unit])=><label key={name}>{label} {unit&&`(${unit})`}<input className={field} type="number" step="any" value={current?.physical[name]??(name==='density'?properties.density:'')} placeholder="Não informado" onChange={e=>{const physical={...(current?.physical??{...blankPhysical(),density:properties.density}),[name]:e.target.value===''?null:Number(e.target.value)};try{edit({physical});setMessage('');}catch(err){setMessage(err instanceof Error?err.message:'Valor inválido.');}}}/></label>)}</div>
    <details><summary className="cursor-pointer font-medium">Aparência da peça</summary><div className="mt-2 grid grid-cols-2 gap-3"><label>Cor<input type="color" className={field} value={current?.appearance.color??DEFAULT_APPEARANCE.color} onChange={e=>edit({appearance:{...(current?.appearance??DEFAULT_APPEARANCE),color:e.target.value}})}/></label>{([['metalness','Metalização'],['roughness','Rugosidade'],['opacity','Opacidade']] as const).map(([name,label])=><label key={name}>{label}<input aria-label={label} className="w-full" type="range" min={0} max={1} step={.01} value={current?.appearance[name]??DEFAULT_APPEARANCE[name]} onChange={e=>edit({appearance:{...(current?.appearance??DEFAULT_APPEARANCE),[name]:Number(e.target.value)}})}/></label>)}</div><p className="mt-2 text-xs text-slate-500">Aparência convertida para o navegador. Texturas e efeitos específicos do Inventor podem diferir.</p></details>
  </section>;
}
