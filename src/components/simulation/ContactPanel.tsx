'use client';
import {useMemo,useState} from 'react';
import type {Study} from '@/lib/simulation/types';
import {suggestBondedPairs} from '@/lib/simulation/contacts';
const input='w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs';
const button='rounded border border-slate-300 px-3 py-2 text-xs disabled:opacity-40';
export function ContactPanel({study,selected,onUpdate,onSelect,onPrepare}:{study:Study;selected:number[];onUpdate:(patch:Partial<Study>)=>void;onSelect:(ids:number[])=>void;onPrepare:()=>void}){
  const [master,setMaster]=useState(0),[slave,setSlave]=useState(0);
  const [kind,setKind]=useState<'bonded'|'frictionless'>('bonded'),[stiffness,setStiffness]=useState(1e6),[distance,setDistance]=useState(.1);
  const faces=study.mesh?.faces??[];
  const suggestions=useMemo(()=>study.mesh?suggestBondedPairs(study.mesh):[],[study.mesh]);
  const masterFace=faces.find(f=>f.id===master),slaveFace=faces.find(f=>f.id===slave);
  const valid=masterFace&&slaveFace&&master!==slave&&masterFace.bodyId!==undefined&&slaveFace.bodyId!==undefined&&masterFace.bodyId!==slaveFace.bodyId;
  function choose(m:number,s:number){setMaster(m);setSlave(s);onSelect([m,s].filter(id=>faces.some(f=>f.id===id)));}
  return <>
    <label className="text-xs">Tipo de contato<select className={input} value={kind} onChange={e=>setKind(e.target.value as typeof kind)}><option value="bonded">Aderido</option><option value="frictionless">Sem atrito · abertura e fechamento</option></select></label>
    {kind==='frictionless'&&<><p className="text-xs text-slate-600">Contato por penalidade entre faces planas, com pequenos deslizamentos. Transmite apenas compressão. Cada corpo ou grupo unido por contatos aderidos precisa de apoios suficientes mesmo com o contato sem atrito aberto. Você pode combinar os dois tipos na mesma montagem.</p><label className="text-xs">Rigidez normal (MPa/mm)<input className={input} type="number" min={1} max={1e9} value={stiffness} onChange={e=>setStiffness(Number(e.target.value))}/></label><label className="text-xs">Distância de busca / folga inicial máxima (mm)<input className={input} type="number" min={0} max={10} step={.01} value={distance} onChange={e=>setDistance(Number(e.target.value))}/></label></>}
    {kind==='bonded'&&<p className="text-xs text-slate-600">Contato aderido: transmite tração, compressão e cisalhamento entre faces planas coincidentes de corpos independentes. Não permite abertura nem deslizamento.</p>}
    <button className={button} disabled={!study.step} onClick={()=>{choose(0,0);onPrepare();}}>Preparar corpos independentes</button>
    <p className="text-xs text-slate-500">Este comando desativa a união geométrica e limpa condições e materiais por corpo. Gere a malha novamente. A abertura inicial do contato sem atrito só fecha se os deslocamentos forem suficientes.</p>
    {study.mesh&&<>
      <p className="text-xs">{study.mesh.bodyCount} corpos independentes. Use a lista de faces para acessar interfaces internas ou isole um corpo no visor.</p>
      {(['master','slave'] as const).map(role=><div key={role} className="space-y-1"><label className="block text-xs">{role==='master'?'Face mestre (preferir malha mais grossa)':'Face dependente (preferir malha mais fina)'}<select className={input} value={role==='master'?(masterFace?master:0):(slaveFace?slave:0)} onChange={e=>choose(role==='master'?Number(e.target.value):master,role==='slave'?Number(e.target.value):slave)}><option value={0}>Selecione uma face</option>{faces.map(f=><option key={f.id} value={f.id}>Face {f.id} · corpo {f.bodyId??'?'} · centro {f.center.map(v=>v.toFixed(1)).join(', ')} mm</option>)}</select></label><button className={button} disabled={selected.length!==1} onClick={()=>choose(role==='master'?selected[0]:master,role==='slave'?selected[0]:slave)}>Usar face selecionada</button></div>)}
      <button className={button} onClick={()=>choose(slave,master)}>Inverter mestre / dependente</button>
      <button className={button} disabled={!valid||(kind==='frictionless'&&(!Number.isFinite(stiffness)||stiffness<1||stiffness>1e9||!Number.isFinite(distance)||distance<0||distance>10))||(study.contacts?.length??0)>=100} onClick={()=>{onUpdate({contacts:[...(study.contacts??[]),{id:crypto.randomUUID(),masterFaceId:master,slaveFaceId:slave,...(kind==='bonded'?{kind:'bonded' as const}:{kind:'frictionless' as const,normalStiffness:stiffness,searchDistance:distance})}]});choose(0,0);}}>Adicionar contato</button>
      <p className="text-xs text-slate-500">A face dependente deve caber integralmente na mestre. Evite apoios em nós dependentes e vínculos repetidos. Compare refinamentos: malhas diferentes podem alterar as tensões locais na interface.</p>
      <details className="text-xs"><summary className="cursor-pointer">Pares sugeridos ({suggestions.length})</summary><p className="my-2">Sugestões geométricas; o solver verifica o encaixe completo.</p>{suggestions.map(([m,s])=><button key={`${m}-${s}`} className={`${button} mb-1 mr-1`} onClick={()=>choose(m,s)}>Faces {m} → {s}</button>)}</details>
    </>}
    {(study.contacts??[]).map((c,i)=><div key={c.id} className="flex items-center gap-2 rounded border p-2 text-xs"><button className="flex-1 text-left" onClick={()=>choose(c.masterFaceId,c.slaveFaceId)}>{c.kind==='frictionless'?'Sem atrito':'Aderido'} {i+1} · mestre {c.masterFaceId} → dependente {c.slaveFaceId}</button><button aria-label="Remover contato" onClick={()=>onUpdate({contacts:study.contacts!.filter(v=>v.id!==c.id)})}>×</button></div>)}
  </>;
}
