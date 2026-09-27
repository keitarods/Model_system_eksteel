'use client';
import { useEffect, useRef, useState } from 'react';
import { CadToolButton } from '@/components/ui/CadToolButton';
import { IconLoadDoc, IconAddView, IconSketch, IconJoinPoints, IconFixed, IconWeldTool, IconExtrude, IconRevolve, IconFace } from '@/components/icons/ToolIcons';
import type { Feature, SketchFeature } from '@/lib/features/types';
import { useAssemblyStore } from '@/lib/assembly/store';
import { IDENTITY_PLACEMENT, type ComponentInstance } from '@/lib/assembly/types';
import { createAssemblyOperation, createAssemblySketch, type ProfileParameters } from '@/lib/assembly/modeling';
import { parseProject, serializeProject } from '@/lib/project/nativeFormat';
import { resolveLinkedFile } from '@/lib/project/linkedFiles';
import { measureVolume } from 'replicad';
import { rebuildModel } from '@/lib/replicad/build-model';
import { loadOpenCascade } from '@/lib/replicad/opencascade';

const button = 'rounded border border-chrome-border px-3 py-2 text-xs font-medium hover:bg-chrome-surface-alt disabled:opacity-40 disabled:cursor-not-allowed';
const input = 'w-full rounded border border-primary-200 bg-white px-2 py-1.5 text-sm text-primary-900';
type Command = 'sketch'|'extrude'|'revolve'|'weld';
export function AssemblyModelingRibbon({selectedId,onSelect,onInsert,onConstraint,onEdit,onMaterial,onError,treeCollapsed,onToggleTree}: {
  treeCollapsed:boolean; onToggleTree:()=>void;
  selectedId:string|null; onSelect:(id:string)=>void; onInsert:()=>void; onConstraint:()=>void; onEdit:(id:string)=>void; onMaterial:(id:string)=>void; onError:(message:string|null)=>void;
}) {
  const instances = useAssemblyStore(s=>s.instances);
  const selected = instances.find(i=>i.id===selectedId);
  const [collapsed,setCollapsed] = useState(false);
  const [tab,setTab] = useState('Montar');
  const [command,setCommand] = useState<Command|null>(null);
  const dialogRef = useRef<HTMLFormElement>(null);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState<string|null>(null);
  const [profile,setProfile] = useState<ProfileParameters>({shape:'rectangle',plane:'XY',x:0,y:0,offset:0,width:30,height:20});
  const [value,setValue] = useState(10);
  const [cut,setCut] = useState(false);
  const [reversed,setReversed] = useState(false);
  const [axis,setAxis] = useState<'X'|'Y'>('Y');
  const [process,setProcess] = useState('MIG/MAG');
  const [sketchId,setSketchId] = useState('');
  const sketches = (selected?.assemblyFeatures ?? []).filter((f):f is SketchFeature=>f.type==='sketch');
  const sketch = sketches.find(f=>f.id===sketchId) ?? sketches[sketches.length-1];
  useEffect(()=>{
    if(!command) return;
    const previous = document.activeElement as HTMLElement | null;
    const form = dialogRef.current;
    form?.querySelector<HTMLElement>('input,select,button')?.focus();
    function key(event:KeyboardEvent) {
      if(event.key==='Escape'&&!busy) {event.preventDefault();setCommand(null);}
      if(event.key==='Tab'&&form) {
        const fields = Array.from(form.querySelectorAll<HTMLElement>('input,select,button')).filter(el=>!el.hasAttribute('disabled'));
        const first=fields[0],last=fields[fields.length-1];
        if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
        else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
      }
    }
    window.addEventListener('keydown',key);
    return ()=>{window.removeEventListener('keydown',key);previous?.focus();};
  },[command,busy]);
  function open(next:Command) {
    setCommand(next);setError(null);setReversed(false);
    setValue(next==='revolve'?360:next==='weld'?50:10);
    if(next==='weld') setProfile(p=>({...p,shape:'triangle',width:5,height:5}));
  }
  async function baseFeatures(instance:ComponentInstance):Promise<Feature[]> {
    if(instance.embeddedPart) return parseProject(instance.embeddedPart).features;
    const resolved = await resolveLinkedFile(instance.linkKey);
    if(!resolved.ok) throw new Error('Religue a peça antes de aplicar uma operação.');
    return resolved.features;
  }
  async function validate(instance:ComponentInstance, features:Feature[]) {
    await loadOpenCascade();
    const base = await baseFeatures(instance);
    const last = features[features.length-1];
    let before:number|null = null;
    if(last && 'cut' in last && last.cut) {
      const original = rebuildModel([...base,...features.slice(0,-1)],{});
      if(!original) throw new Error('Crie um sólido antes de remover material.');
      try {before=measureVolume(original);} finally {original.delete();}
    }
    const solid = rebuildModel([...base,...features],{});
    if(!solid) throw new Error('A operação não produziu um sólido.');
    try {
      const volume=measureVolume(solid);
      if(volume<=1e-9) throw new Error('A operação remove todo o componente. Use Remover componente na árvore.');
      if(before!==null && before-volume<=Math.max(1e-7,before*1e-9)) throw new Error('O corte não intercepta o componente. Confira o plano, a posição e o sentido.');
      solid.mesh();
    } finally { solid.delete(); }
  }
  async function apply() {
    setBusy(true);setError(null);onError(null);
    const snapshot = useAssemblyStore.getState().instances;
    try {
      const id = crypto.randomUUID();
      if(command==='weld') {
        const weldSketch = createAssemblySketch({...profile,shape:'triangle',height:profile.width},crypto.randomUUID());
        const operation = createAssemblyOperation(weldSketch,'extrude',value,false,reversed,'Y',crypto.randomUUID());
        const weld:ComponentInstance = {id,label:`Solda de filete ${profile.width} mm · ${process}`,linkKey:id,sourceFileName:'solda.eks3d',embeddedPart:serializeProject([]),assemblyFeatures:[weldSketch,{...operation,label:'Cordão de solda'}],weld:{process,size:profile.width,length:value},grounded:false,visible:true,suppressed:false,placementSeed:structuredClone(IDENTITY_PLACEMENT)};
        await validate(weld,weld.assemblyFeatures!);
        if(useAssemblyStore.getState().instances!==snapshot) throw new Error('A montagem mudou durante o cálculo. Tente novamente.');
        useAssemblyStore.getState().addInstance(weld);onSelect(id);
      } else if(command==='sketch') {
        const feature = createAssemblySketch(profile,id);
        if(selected) useAssemblyStore.getState().updateInstance(selected.id,{assemblyFeatures:[...(selected.assemblyFeatures??[]),feature]});
        else {
          useAssemblyStore.getState().addInstance({id,label:`Componente ${instances.length+1}`,linkKey:id,sourceFileName:'componente.eks3d',embeddedPart:serializeProject([]),assemblyFeatures:[feature],grounded:instances.length===0,visible:true,suppressed:false,placementSeed:structuredClone(IDENTITY_PLACEMENT)});
          onSelect(id);
        }
        setSketchId(id);setTab("Modelo 3D");
      } else {
        if(!selected || !sketch || !command) throw new Error('Crie e selecione um sketch do componente.');
        if(selected.suppressed) throw new Error('Reative o componente antes de modelar.');
        const base = await baseFeatures(selected);
        if(cut && ![...base,...(selected.assemblyFeatures??[])].some(f=>!['sketch','plane','axis'].includes(f.type))) throw new Error('Crie um sólido antes de remover material.');
        const operation = createAssemblyOperation(sketch,command,value,cut,reversed,axis,id);
        const features = [...(selected.assemblyFeatures??[]),operation];
        await validate(selected,features);
        if(useAssemblyStore.getState().instances!==snapshot) throw new Error('A montagem mudou durante o cálculo. Tente novamente.');
        useAssemblyStore.getState().updateInstance(selected.id,{assemblyFeatures:features});
      }
      setCommand(null);
    } catch(e) {setError(e instanceof Error?e.message:'Não foi possível criar a operação.');}
    finally {setBusy(false);}
  }
  return <>
    <section aria-label="Ferramentas da montagem" className="shrink-0 border-b border-chrome-border bg-chrome-bg text-chrome-text">
      <div className="flex items-center gap-1 px-2">
        <button type="button" onClick={onToggleTree} aria-expanded={!treeCollapsed} aria-controls="assembly-component-tree" title={treeCollapsed?'Mostrar componentes':'Recolher componentes'} aria-label={treeCollapsed?'Mostrar componentes':'Recolher componentes'} className="hidden h-8 w-8 shrink-0 items-center justify-center rounded hover:bg-chrome-surface-alt md:flex">
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>{treeCollapsed?<path d="m13 9 3 3-3 3"/>:<path d="m17 9-3 3 3 3"/>}</svg>
        </button>
        <div className="flex min-w-0 flex-1 overflow-x-auto" role="tablist" aria-label="Ambientes da montagem">
          {['Montar','Modelo 3D','Soldagem','Usinagem'].map(t=><button type="button" role="tab" aria-selected={tab===t} key={t} onClick={()=>{setTab(t);setCollapsed(false);}} className={`shrink-0 whitespace-nowrap border-b-2 px-3 py-1.5 text-xs font-semibold ${tab===t?'border-primary bg-chrome-surface-alt':'border-transparent'}`}>{t}</button>)}
        </div>
        <button type="button" onClick={()=>setCollapsed(v=>!v)} aria-expanded={!collapsed} aria-controls="assembly-ribbon-commands" aria-label={collapsed?'Expandir ferramentas':'Recolher ferramentas'} title={collapsed?'Expandir ferramentas':'Recolher ferramentas'} className="flex h-8 w-8 shrink-0 items-center justify-center rounded hover:bg-chrome-surface-alt">
          <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6"><path d={collapsed?'m5 7 5 5 5-5':'m5 12 5-5 5 5'}/></svg>
        </button>
      </div>
      <div id="assembly-ribbon-commands" hidden={collapsed}>
      <div className="flex items-center gap-2 overflow-x-auto px-2 py-1">
        {tab==='Montar' ? <>
          <Group label="Componentes">
            <CadToolButton icon={IconLoadDoc} label="Inserir peça" description="Vincule uma peça existente à montagem." onClick={onInsert}/>
            <CadToolButton icon={IconAddView} label="Criar componente" description="Crie um componente na montagem a partir de um sketch." onClick={()=>{onSelect('');open('sketch');}}/>
            <CadToolButton icon={IconSketch} label="Editar peça" description="Abra a peça vinculada no Modelador para editar em contexto." disabled={!selected} onClick={()=>selected&&onEdit(selected.id)}/>
            <CadToolButton icon={IconFace} label="Material" description="Material da peça (altera o arquivo da peça) e aparência deste componente na montagem." disabled={!selected} onClick={()=>selected&&onMaterial(selected.id)}/>
          </Group>
          <Group label="Posicionar">
            <CadToolButton icon={IconJoinPoints} label="Restringir" description="Selecione referências entre dois componentes para posicioná-los." disabled={instances.length<2} onClick={onConstraint}/>
            <CadToolButton icon={IconFixed} label={selected?.grounded?'Soltar componente':'Fixar componente'} description="Alterne a fixação do componente na montagem." active={selected?.grounded} disabled={!selected} onClick={()=>selected&&useAssemblyStore.getState().updateInstance(selected.id,{grounded:!selected.grounded})}/>
          </Group>
        </> : tab==='Soldagem' ? <Group label="Soldagem"><CadToolButton icon={IconWeldTool} label="Solda de filete" description="Crie um cordão reto com seção triangular, cateto, comprimento e processo." onClick={()=>open('weld')}/></Group> : <>
          <Group label="Esboço"><CadToolButton icon={IconSketch} label="Criar sketch" description="Defina um perfil dimensionado no plano do componente." disabled={!!selected?.suppressed} onClick={()=>open('sketch')}/></Group>
          <Group label={tab==='Usinagem'?'Remover material':'Modelar'}>
            <CadToolButton icon={IconExtrude} label="Extrude" description="Adicione ou remova material por extrusão de um sketch." disabled={!sketch||selected?.suppressed} onClick={()=>{setCut(tab==='Usinagem');open('extrude');}}/>
            <CadToolButton icon={IconRevolve} label="Revolve" description="Adicione ou remova material girando o perfil ao redor de um eixo." disabled={!sketch||selected?.suppressed} onClick={()=>{setCut(tab==='Usinagem');open('revolve');}}/>
          </Group>
        </>}
        <span title={selected?.label??'Selecione uma peça na árvore ou crie um componente'} className="ml-auto hidden max-w-52 truncate text-xs text-chrome-text-muted sm:block">{selected?.label??'Nenhum componente selecionado'}</span>
      </div>
      {!!selected?.assemblyFeatures?.length && <details className="border-t border-chrome-border text-xs">
        <summary className="cursor-pointer px-3 py-1 text-chrome-text-muted">Operações do componente ({selected.assemblyFeatures.length})</summary>
        <div className="flex gap-2 overflow-x-auto px-3 pb-2" aria-label="Histórico de operações do componente">
        {selected.assemblyFeatures.map((f,index)=><span key={f.id} className="flex shrink-0 items-center gap-1 rounded border border-chrome-border px-2 py-1"><button type="button" onClick={()=>{if(f.type==='sketch'){setSketchId(f.id);setTab('Modelo 3D');}}} className={f.id===sketch?.id?'font-bold text-primary':''}>{index+1}. {f.label}</button><button type="button" aria-label={`Remover ${f.label} e operações posteriores`} title="Remover esta operação e as posteriores" onClick={()=>{if(window.confirm('Remover esta operação e todas as posteriores deste componente?'))useAssemblyStore.getState().updateInstance(selected.id,{assemblyFeatures:selected.assemblyFeatures!.slice(0,index)});}}>×</button></span>)}
        </div>
      </details>}
      </div>
    </section>
    {command && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="assembly-command-title" onSubmit={e=>{e.preventDefault();void apply();}} className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-xl bg-white p-5 text-primary-900 shadow-2xl">
        <h2 id="assembly-command-title" className="mb-1 text-lg font-semibold">{command==='sketch'?'Criar sketch':command==='weld'?'Solda de filete':command==='extrude'?'Extrude · Extrusão':'Revolve · Revolução'}</h2>
        <p className="mb-4 text-xs text-primary-600">{command==='weld'?'Coordenadas globais da montagem. O cordão pode ser posicionado e restringido como componente.':`${selected?.label??'Novo componente na origem'} · Coordenadas locais em milímetros`}</p>
        {(command==='sketch'||command==='weld') ? <>
          <div className="grid grid-cols-2 gap-3">
            {command==='sketch'&&<label className="text-xs">Perfil<select className={input} value={profile.shape} onChange={e=>setProfile({...profile,shape:e.target.value as ProfileParameters['shape']})}><option value="rectangle">Retângulo</option><option value="circle">Círculo</option><option value="triangle">Triângulo</option></select></label>}
            <label className="text-xs">Plano<select className={input} value={profile.plane} onChange={e=>setProfile({...profile,plane:e.target.value as ProfileParameters['plane']})}>{['XY','XZ','YZ'].map(p=><option key={p}>{p}</option>)}</select></label>
            {(['x','y','offset','width',...(command==='sketch'&&profile.shape!=='circle'?['height']:[])] as (keyof ProfileParameters)[]).map(key=><NumberField key={key} label={key==='width'?(command==='weld'?'Cateto (mm)':profile.shape==='circle'?'Diâmetro (mm)':'Largura (mm)'):key==='height'?'Altura (mm)':key==='offset'?'Deslocamento do plano (mm)':`${key.toUpperCase()} (mm)`} value={profile[key] as number} positive={key==='width'||key==='height'} onChange={n=>setProfile({...profile,[key]:n})}/>)}
          </div>
          <svg viewBox="-10 -10 120 90" role="img" aria-label="Prévia do perfil (sem escala)" className="my-3 h-32 w-full rounded border border-primary-100 bg-primary-50">
            {command==='weld'||profile.shape==='triangle'?<path d="M10 60 L90 60 L90 10 Z" fill="#bfdbfe" stroke="#2563eb"/>:profile.shape==='circle'?<circle cx="50" cy="35" r="28" fill="#bfdbfe" stroke="#2563eb"/>:<rect x="10" y="10" width="80" height="50" fill="#bfdbfe" stroke="#2563eb"/>}
          </svg>
          {command==='weld'&&<div className="grid grid-cols-2 gap-3"><NumberField label="Comprimento (mm)" value={value} positive onChange={setValue}/><label className="text-xs">Processo<select className={input} value={process} onChange={e=>setProcess(e.target.value)}>{['MIG/MAG','TIG','Eletrodo revestido','Arco submerso'].map(p=><option key={p}>{p}</option>)}</select></label></div>}
        </> : <div className="grid grid-cols-2 gap-3">
          <label className="col-span-2 text-xs">Sketch<select className={input} value={sketch?.id??''} onChange={e=>setSketchId(e.target.value)}>{sketches.map((f,i)=><option key={f.id} value={f.id}>{i+1}. {f.label}</option>)}</select></label>
          <label className="text-xs">Operação<select className={input} value={cut?'cut':'join'} onChange={e=>setCut(e.target.value==='cut')}><option value="join">Adicionar material</option><option value="cut">Remover material</option></select></label>
          <NumberField label={command==='extrude'?'Distância (mm)':'Ângulo (°)'} value={value} positive onChange={setValue}/>
          {command==='revolve'&&<label className="text-xs">Eixo pela origem do sketch<select className={input} value={axis} onChange={e=>setAxis(e.target.value as 'X'|'Y')}><option>X</option><option>Y</option></select></label>}
        </div>}
        {command!=='sketch'&&<label className="mt-3 flex items-center gap-2 text-xs"><input type="checkbox" checked={reversed} onChange={e=>setReversed(e.target.checked)}/>Inverter sentido</label>}
        {error&&<p role="alert" className="mt-3 rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}
        <div className="mt-5 flex justify-end gap-2"><button type="button" disabled={busy} className={button} onClick={()=>setCommand(null)}>Cancelar</button><button type="submit" disabled={busy} className="rounded bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">{busy?'Calculando…':command==='sketch'?'Concluir sketch':'Aplicar'}</button></div>
      </form>
    </div>}
  </>;
}
function Group({label,children}:{label:string;children:React.ReactNode}) {return <div aria-label={label} role="group" className="flex shrink-0 items-center border-r border-chrome-border pr-2"><div className="flex items-center gap-1">{children}</div></div>;}
function NumberField({label,value,onChange,positive=false}:{label:string;value:number;onChange:(n:number)=>void;positive?:boolean}) {return <label className="text-xs">{label}<input required type="number" step="any" min={positive?0.001:undefined} value={Number.isNaN(value)?'':value} onChange={e=>onChange(e.target.valueAsNumber)} className={input}/></label>;}
