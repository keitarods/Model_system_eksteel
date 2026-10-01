'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { importSTEP, type ShapeMesh } from 'replicad';
import { useAssemblyStore } from '@/lib/assembly/store';
import { parseAssembly } from '@/lib/project/assemblyFormat';
import { snapshotAssembly } from '@/lib/simulation/assemblyImport';
import { HeaderIcon } from '@/components/icons/HeaderIcon';
import { usePartPropertiesStore } from '@/lib/features/propertiesStore';
import { toSimulationMaterial } from '@/lib/materials/library';
import { simulationPresets } from '@/lib/materials/defaults';
import { useMaterialLibrary } from '@/components/materials/MaterialEditor';
import { useFeatureStore } from '@/lib/features/store';
import { rebuildModel } from '@/lib/replicad/build-model';
import { loadOpenCascade } from '@/lib/replicad/opencascade';
import { useSimulationStore } from '@/lib/simulation/store';
import { emptyStudy, type Study, type Vec3, type Load } from '@/lib/simulation/types';
import { parseStudy, serializeStudy, validateGeneratedMesh, validateResults } from '@/lib/simulation/format';
import {convergenceRow, hasConverged, refinedStudy, verifyFaceReferences} from '@/lib/simulation/convergence';
import { feaRequest, runFeaJob } from '@/lib/simulation/client';
import { loadDraft, scheduleDraftSave, flushDraftSave } from '@/lib/project/autosave';
import {ContactPanel} from './ContactPanel';
import { SimulationViewer, type ResultField } from './SimulationViewer';
import { CadToolButton } from '@/components/ui/CadToolButton';
import { ApplicationFileMenu } from '@/components/modelador/ApplicationFileMenu';
import { AccountBadge, MenuDivider, WorkspaceSwitcher } from '@/components/layout/WorkspaceChrome';
import { IconLoadDoc, IconAddView, IconFixed, IconExtrude, IconMeasure } from '@/components/icons/ToolIcons';

const input='w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-800';
function AssemblyIcon(){return <HeaderIcon kind="assembly"/>;}
const toolbarButton='rounded-lg border border-chrome-border px-3 py-1.5 text-xs font-semibold text-chrome-text-muted hover:bg-chrome-surface-alt disabled:cursor-not-allowed disabled:opacity-40';
const button='rounded border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40';
const tabs=['Geometria','Material','Malha','Contatos','Fixações','Cargas','Resultados'] as const;
function download(data:string,name:string,type='application/json'){const url=URL.createObjectURL(new Blob([data],{type}));const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export function SimulationWorkspace({userEmail=''}:{userEmail?:string}){
  const {library:materialLibrary,builtInMessage}=useMaterialLibrary();const presets=useMemo(()=>simulationPresets(materialLibrary),[materialLibrary]);
  const study=useSimulationStore(s=>s.study);const setStudy=useSimulationStore(s=>s.setStudy);
  const [visibleBody,setVisibleBody]=useState<number|null>(null);
  const [materialRegion,setMaterialRegion]=useState('common');
  const [convergenceTolerance,setConvergenceTolerance]=useState(5);
  const [tab,setTab]=useState<typeof tabs[number]>('Material');const [selected,setSelected]=useState<number[]>([]);
  const [preview,setPreview]=useState<ShapeMesh|null>(null);const [busy,setBusy]=useState(false);const [cancellable,setCancellable]=useState(false);const [status,setStatus]=useState('');const [error,setError]=useState('');
  const [service,setService]=useState('Verificando serviço…');const [ready,setReady]=useState(false);const restored=useRef(false);
  const [meshId,setMeshId]=useState<string|null>(null);const [solveId,setSolveId]=useState<string|null>(null);
  const controller=useRef<AbortController|null>(null);const stepInput=useRef<HTMLInputElement>(null);const studyInput=useRef<HTMLInputElement>(null);const assemblyInput=useRef<HTMLInputElement>(null);
  const [axes,setAxes]=useState<[boolean,boolean,boolean]>([true,true,true]);const [kind,setKind]=useState<Load['kind']>('force');
  const [force,setForce]=useState<Vec3>([0,0,-1000]);const [pressure,setPressure]=useState(1);const [localSize,setLocalSize]=useState(3);
  const [field,setField]=useState<ResultField>('stress');const [scale,setScale]=useState(0);const [wireframe,setWireframe]=useState(true);const [panelOpen,setPanelOpen]=useState(true);
  useEffect(()=>{let live=true;void loadDraft('simulacao').then(json=>{if(live&&json&&!useSimulationStore.getState().study.step)setStudy(parseStudy(json));}).catch(()=>{if(live)setError('Não foi possível restaurar o rascunho de simulação.');}).finally(()=>{if(live){restored.current=true;setReady(true);}});return()=>{live=false;controller.current?.abort();};},[setStudy]);
  useEffect(()=>{if(ready&&restored.current)scheduleDraftSave('simulacao',serializeStudy(study));},[study,ready]);
  useEffect(()=>{let live=true;void feaRequest().then(h=>{if(live)setService(h.ready?'Gmsh + CalculiX disponíveis':'Serviço iniciado, mas Gmsh ou CalculiX está ausente.');}).catch(e=>{if(live)setService(e.message);});return()=>{live=false;};},[]);
  useEffect(()=>{const flush=()=>{if(restored.current)flushDraftSave('simulacao',serializeStudy(useSimulationStore.getState().study));};window.addEventListener('pagehide',flush);return()=>window.removeEventListener('pagehide',flush);},[]);
  const preparation=study.preparation??{heal:false,removeSmall:false,closeGaps:false,unite:study.geometryMode==='assemblyBonded',tolerance:0.001};
  const meshControls=study.meshControls??{minimumSize:study.size,curvature:0,qualityTarget:0.3};
  const activeMaterialRegion=study.mesh?.regions?.some(r=>String(r.id)===materialRegion)?materialRegion:'common';
  const editedMaterial=activeMaterialRegion==='common'?study.material:study.regionMaterials?.[activeMaterialRegion]??study.material;
  function changeMaterial(material:Study['material']){update(activeMaterialRegion==='common'?{material}:{regionMaterials:{...study.regionMaterials,[activeMaterialRegion]:material}});}
  function prepare(patch:Partial<typeof preparation>,geometryMode=study.geometryMode){setSelected([]);update({geometryMode,preparation:{...preparation,...patch},supports:[],loads:[],refinements:[],regionMaterials:{},contacts:[]},true);}
  function update(patch:Partial<Study>,invalidateMesh=false){setStudy({...study,...patch,convergence:undefined,results:null,...(invalidateMesh?{mesh:null}:{})});setSolveId(null);if(invalidateMesh)setMeshId(null);}
  async function withBusy(action:()=>Promise<void>){if(busy)return;setBusy(true);setError('');try{await action();}catch(e){if(e instanceof Error&&e.name==='AbortError')setStatus('Cancelado.');else setError(e instanceof Error?e.message:'Erro no estudo.');}finally{setBusy(false);setCancellable(false);controller.current=null;}}
  function canReplace(){return !study.step||window.confirm('Substituir o estudo atual? Salve o arquivo se quiser preservar esta análise.');}
  async function importModel(){if(!canReplace())return;await withBusy(async()=>{setStatus('Preparando geometria…');await loadOpenCascade();const solid=rebuildModel(useFeatureStore.getState().features);if(!solid)throw new Error('Abra ou crie uma peça no Modelador antes de usar este comando.');try{const properties=usePartPropertiesStore.getState().properties;const material=properties.materialDefinition?toSimulationMaterial(properties.materialDefinition,properties.density):null;const step=await solid.blobSTEP().text();setPreview(solid.mesh());setStudy({...emptyStudy(),step,sourceName:'Peça do Modelador',...(material?{material}:{})});setSelected([]);setMeshId(null);setSolveId(null);setStatus(material?'Peça e material copiados. Gere a malha.':'Peça copiada sem material completo. Configure o material do estudo antes de calcular.');}finally{solid.delete();}});}
  async function importAssembly(file?:File){
    if(file&&file.size>64_000_000){setError('Montagem acima de 64 MB.');return;}
    if(!canReplace())return;
    await withBusy(async()=>{
      setStatus('Preparando componentes da montagem…');
      let doc: import('@/lib/assembly/types').AssemblyDocument;
      if(file)doc=parseAssembly(await file.text());
      else {
        const current=useAssemblyStore.getState();
        doc={instances:current.instances,constraints:current.constraints};
        if(!doc.instances.length){const draft=await loadDraft('montagem');if(draft)doc=parseAssembly(draft);}
      }
      await loadOpenCascade();
      const snapshot=await snapshotAssembly(doc);
      setPreview(snapshot.preview);
      setStudy({...emptyStudy(),step:snapshot.step,geometryMode:'assemblyBonded',components:snapshot.components,sourceName:file?.name??'Montagem aberta',name:'Estudo da montagem'});
      setSelected([]);setMeshId(null);setSolveId(null);setScale(0);setTab('Material');
      setStatus(`${snapshot.components.length} componente(s) copiado(s) nas posições da montagem. Confira o material comum e defina as fixações FEA.`);
    });
  }
  async function openStep(file:File){if(file.size>12000000){setError('STEP acima de 12 MB.');return;}if(!canReplace())return;await withBusy(async()=>{const step=await file.text();if(!step.includes('ISO-10303-21;'))throw new Error('Arquivo STEP inválido.');await loadOpenCascade();const shape=await importSTEP(file);try{if(!('mesh' in shape))throw new Error('A geometria deve conter um sólido.');setPreview(shape.mesh());}finally{shape.delete();}setStudy({...emptyStudy(),step,sourceName:file.name});setSelected([]);setMeshId(null);setSolveId(null);setStatus('STEP importado.');});}
  async function mesh(){await withBusy(async()=>{controller.current=new AbortController();setCancellable(true);setStatus('Enviando geometria…');setMeshId(null);let generatedId:string|null=null;const output=await runFeaJob({action:'mesh',elementType:study.elementType??'C3D4',materialMode:study.materialMode,geometryMode:study.geometryMode??'part',step:study.step,size:study.size,refinements:study.refinements,preparation:study.preparation,meshControls:study.meshControls},controller.current.signal,id=>{generatedId=id;},setStatus);validateGeneratedMesh(output.mesh,study);if(study.mesh)verifyFaceReferences(study.mesh,output.mesh,study);const ids=new Set(output.mesh.faces.map((f:{id:number})=>f.id));if([...study.supports,...study.loads].some(c=>c.faceIds.some(id=>!ids.has(id))))throw new Error('As referências de face mudaram. Reabra a geometria para definir novas condições.');setMeshId(generatedId);setStudy({...study,mesh:output.mesh,results:null,convergence:undefined});setSolveId(null);setSelected([]);setStatus('Malha gerada. Selecione as faces para configurar fixações e cargas.');setTab('Fixações');});}
  async function solve(){await withBusy(async()=>{if(!study.mesh||!meshId)throw new Error('Gere novamente a malha para iniciar uma nova análise nesta sessão.');controller.current=new AbortController();setCancellable(true);setStatus('Enviando análise…');const output=await runFeaJob({action:'solve',meshId,study:{material:study.material,regionMaterials:study.regionMaterials,contacts:study.contacts,supports:study.supports,loads:study.loads}},controller.current.signal,setSolveId,setStatus);validateResults(output.results,study.mesh,study.contacts);setStudy({...study,results:output.results,convergence:undefined});setTab('Resultados');setScale(0);setStatus('Análise concluída. Confira o equilíbrio e compare refinamentos antes de interpretar os resultados.');});}
  async function convergence(){await withBusy(async()=>{
    if(!study.mesh||!meshId)throw new Error('Gere a malha antes de verificar convergência.');
    if(!Number.isFinite(convergenceTolerance)||convergenceTolerance<=0||convergenceTolerance>100)throw new Error('Informe tolerância entre 0 e 100%.');
    controller.current=new AbortController();setCancellable(true);setTab('Resultados');
    const signal=controller.current.signal;
    const runs:import('@/lib/simulation/types').ConvergenceRun[]=[];
    let current=study,currentMeshId=meshId;
    for(let iteration=0;iteration<4;iteration++){
      if(signal.aborted)throw new DOMException('Cancelado','AbortError');
      if(iteration>0){
        const next=refinedStudy(current);
        let nextId='';
        const output=await runFeaJob({action:'mesh',elementType:next.elementType??'C3D4',materialMode:next.materialMode,geometryMode:next.geometryMode??'part',step:next.step,size:next.size,refinements:next.refinements,preparation:next.preparation,meshControls:next.meshControls},signal,id=>{nextId=id;},status=>setStatus(`Refinamento ${iteration+1}/4 · ${status}`));
        validateGeneratedMesh(output.mesh,next);verifyFaceReferences(current.mesh!,output.mesh,next);
        current={...next,mesh:output.mesh};currentMeshId=nextId;
      }
      let resultId='';
      const output=await runFeaJob({action:'solve',meshId:currentMeshId,study:{material:current.material,regionMaterials:current.regionMaterials,contacts:current.contacts,supports:current.supports,loads:current.loads}},signal,id=>{resultId=id;},status=>setStatus(`Análise ${iteration+1}/4 · ${status}`));
      validateResults(output.results,current.mesh!,current.contacts);
      runs.push(convergenceRow(current.mesh!,output.results,runs.at(-1)));
      current={...current,results:output.results,convergence:{tolerance:convergenceTolerance,runs:[...runs]}};
      setStudy(current);setMeshId(currentMeshId);setSolveId(resultId);setSelected([]);setScale(0);
      if(hasConverged(runs,convergenceTolerance))break;
    }
    setStatus(hasConverged(runs,convergenceTolerance)?'Critérios de convergência atendidos em dois refinamentos consecutivos.':'Limite de 4 malhas atingido sem atender todos os critérios. Examine singularidades e refinamentos locais.');
  });}
  function addSupport(){if(!selected.length||!axes.some(Boolean))return;update({supports:[...study.supports,{id:crypto.randomUUID(),faceIds:[...selected],axes:[...axes]}]});setSelected([]);}
  function addLoad(){if(kind!=='gravity'&&!selected.length)return;if(!force.every(Number.isFinite)||!Number.isFinite(pressure)){setError('Informe cargas numéricas válidas.');return;}update({loads:[...study.loads,{id:crypto.randomUUID(),kind,faceIds:kind==='gravity'?[]:[...selected],vector:[...force],pressure}]});setSelected([]);}
  async function openStudy(file:File){if(file.size>64000000){setError('Estudo acima de 64 MB.');return;}if(!canReplace())return;await withBusy(async()=>{const loaded=parseStudy(await file.text());setStudy(loaded);setPreview(null);setMeshId(null);setSolveId(null);setSelected([]);setStatus('Estudo aberto. Para recalcular, gere uma nova malha.');setTab(loaded.results?'Resultados':'Material');});}
  const saveStudy=()=>download(serializeStudy(study),`${study.name||'estudo'}.eksfea`);
  function closeStudy(){if(!canReplace())return;setStudy(emptyStudy());setPreview(null);setMeshId(null);setSolveId(null);setSelected([]);setScale(0);setTab('Material');setStatus('Estudo fechado.');}
  return <div className="cad-workspace flex h-dvh min-w-0 flex-col overflow-hidden bg-background text-foreground">
    <header className="cad-header flex shrink-0 items-center gap-2 overflow-x-auto border-b border-chrome-border bg-chrome-bg px-3 py-1.5 text-chrome-text">
      <ApplicationFileMenu current="simulacao">
        <button type="button" onClick={()=>studyInput.current?.click()} disabled={busy||!ready} title="Abra um arquivo .eksfea com geometria, condições, malha e resultados." className="rounded-lg px-2 py-1.5 text-xs text-chrome-text-muted hover:bg-chrome-surface-alt disabled:cursor-not-allowed disabled:opacity-40"><HeaderIcon kind="open"/>Abrir estudo</button>
        <button type="button" onClick={()=>void importModel()} disabled={busy||!ready} title="Copie a geometria atual do Modelador para um estudo independente." className="rounded-lg px-2 py-1.5 text-xs text-chrome-text-muted hover:bg-chrome-surface-alt disabled:cursor-not-allowed disabled:opacity-40"><HeaderIcon kind="open"/>Usar peça do Modelador</button>
        <button type="button" onClick={()=>void importAssembly()} disabled={busy||!ready} title="Copie os componentes ativos da montagem aberta." className="rounded-lg px-2 py-1.5 text-xs text-chrome-text-muted hover:bg-chrome-surface-alt disabled:cursor-not-allowed disabled:opacity-40"><HeaderIcon kind="assembly"/>Usar montagem aberta</button>
        <button type="button" onClick={()=>assemblyInput.current?.click()} disabled={busy||!ready} title="Abra uma montagem .eks3dasm." className="rounded-lg px-2 py-1.5 text-xs text-chrome-text-muted hover:bg-chrome-surface-alt disabled:cursor-not-allowed disabled:opacity-40"><HeaderIcon kind="open"/>Importar montagem</button>
        <button type="button" onClick={()=>stepInput.current?.click()} disabled={busy||!ready} title="Importe uma peça sólida em milímetros." className="rounded-lg px-2 py-1.5 text-xs text-chrome-text-muted hover:bg-chrome-surface-alt disabled:cursor-not-allowed disabled:opacity-40"><HeaderIcon kind="step"/>Importar STEP</button>
        <MenuDivider/>
        <button type="button" onClick={saveStudy} disabled={busy} title="Baixe um arquivo .eksfea com as configurações e os resultados atuais." className="rounded-lg px-2 py-1.5 text-xs text-chrome-text-muted hover:bg-chrome-surface-alt disabled:cursor-not-allowed disabled:opacity-40"><HeaderIcon kind="save"/>Salvar estudo</button>
        <MenuDivider/>
        <button type="button" onClick={closeStudy} disabled={busy} title="Fechar o estudo atual (volta a um estudo vazio)" className="rounded-lg px-2 py-1.5 text-xs text-chrome-text-muted hover:bg-chrome-surface-alt disabled:cursor-not-allowed disabled:opacity-40"><HeaderIcon kind="close"/>Fechar estudo</button>
      </ApplicationFileMenu>
      <button type="button" onClick={saveStudy} disabled={busy} title="Salvar estudo (.eksfea)" aria-label="Salvar estudo" className="rounded p-2 hover:bg-chrome-surface-alt disabled:opacity-30"><HeaderIcon kind="save"/></button>
      <div className="hidden h-7 w-px bg-chrome-border sm:block"/>
      <span className="hidden whitespace-nowrap text-sm font-semibold uppercase tracking-wide text-chrome-text-muted 2xl:inline" style={{fontFamily:'var(--font-oswald)'}}>Simulação · Estática</span>
      <input aria-label="Nome do estudo" className="min-w-28 max-w-60 rounded border border-chrome-border bg-chrome-surface-alt px-2 py-1 text-sm text-chrome-text" value={study.name} disabled={busy} onChange={e=>setStudy({...study,name:e.target.value})}/>
      <span className="hidden text-xs text-chrome-text-subtle lg:block">mm · N · MPa</span>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        <WorkspaceSwitcher current="simulacao" disabled={busy}/>
        <AccountBadge userEmail={userEmail}/>
      </div>
    </header>
    <div className="flex shrink-0 items-center gap-2 overflow-x-auto border-b border-chrome-border bg-chrome-bg px-2 py-1 text-chrome-text">
      <CadToolButton icon={IconAddView} label="Usar peça do Modelador" description="Copie a geometria atual do Modelador para um estudo independente." disabled={busy||!ready} onClick={()=>void importModel()}/>
      <CadToolButton icon={AssemblyIcon} label="Usar montagem aberta" description="Copie os componentes ativos, incluindo os ocultos, com suas posições, operações e soldas. Peças suprimidas não entram no estudo." disabled={busy||!ready} onClick={()=>void importAssembly()}/>
      <CadToolButton icon={IconLoadDoc} label="Importar montagem" description="Abra uma montagem .eks3dasm com peças incorporadas ou vínculos locais disponíveis." disabled={busy||!ready} onClick={()=>assemblyInput.current?.click()}/>
      <CadToolButton icon={IconLoadDoc} label="Importar STEP" description="Importe uma peça sólida em milímetros para análise." disabled={busy||!ready} onClick={()=>stepInput.current?.click()}/>
      <CadToolButton icon={IconMeasure} label="Gerar malha" description="Gere tetraedros com tamanho global e refinamentos locais." disabled={busy||!study.step||!Number.isFinite(study.size)||study.size<0.01} onClick={()=>void mesh()}/>
      <CadToolButton icon={IconFixed} label="Fixações" disabled={busy||!study.mesh} onClick={()=>{setTab('Fixações');setPanelOpen(true);}}/>
      <CadToolButton icon={IconExtrude} label="Resolver" description="Execute o cálculo estático no CalculiX." disabled={busy||!meshId||!study.mesh||!study.supports.length||!study.loads.length} onClick={()=>void solve()}/>
      <button className={toolbarButton} aria-expanded={panelOpen} onClick={()=>setPanelOpen(v=>!v)}>{panelOpen?'Recolher painel':'Mostrar painel'}</button>
      {busy&&<button className={toolbarButton} onClick={()=>controller.current?.abort()} disabled={!cancellable}>Cancelar cálculo</button>}
      <span className="ml-auto max-w-64 truncate text-xs text-chrome-text-muted" title={study.sourceName}>{study.sourceName||'Nenhuma geometria'}</span>
    </div>
    <input ref={stepInput} type="file" accept=".step,.stp" className="hidden" onChange={e=>{const f=e.target.files?.[0];e.target.value='';if(f)void openStep(f);}}/>
    <input ref={assemblyInput} type="file" accept=".eks3dasm" className="hidden" onChange={e=>{const f=e.target.files?.[0];e.target.value='';if(f)void importAssembly(f);}}/>
    <input ref={studyInput} type="file" accept=".eksfea" className="hidden" onChange={e=>{const f=e.target.files?.[0];e.target.value='';if(f)void openStudy(f);}}/>
    {error&&<div role="alert" className="flex shrink-0 items-center justify-between bg-red-50 px-3 py-2 text-xs text-red-800">{error}<button aria-label="Fechar erro" onClick={()=>setError('')}>×</button></div>}
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      {panelOpen&&<aside className="max-h-[45dvh] w-full shrink-0 overflow-y-auto border-r bg-white md:max-h-none md:w-80">
        <div className="sticky top-0 z-10 flex overflow-x-auto border-b bg-white">{tabs.map(t=><button key={t} className={`shrink-0 px-2 py-2 text-xs ${tab===t?'border-b-2 border-primary font-bold text-primary':'text-slate-500'}`} onClick={()=>setTab(t)}>{t}</button>)}</div>
        {study.geometryMode==='assemblyBonded'&&<div className="space-y-2 border-b bg-blue-50 p-3 text-xs text-blue-950">
          <strong>Montagem · {study.components?.length??0} componentes</strong>
          <p>Escolha material comum ou materiais por corpo na etapa Material. Com a união ativa, regiões encostadas ou sobrepostas são unidas para a análise, sem deslizamento ou separação. Microfolgas podem ser tratadas na etapa Geometria, dentro da tolerância informada.</p>
          <p>Defina fixações FEA: peças fixas e restrições da Montagem apenas posicionam a geometria.</p>
          <details><summary className="cursor-pointer">Componentes incluídos</summary><ul className="mt-1 max-h-32 overflow-y-auto">{study.components?.map((c,i)=><li key={`${c.id}-${i}`}>{c.label}</li>)}</ul></details>
        </div>}
        <fieldset disabled={busy||!ready} className="space-y-4 p-4 disabled:opacity-60">
          {tab==='Geometria'&&<>
            <label className="block text-xs">Tipo de geometria<select className={input} value={study.geometryMode??'part'} onChange={e=>prepare({},e.target.value as Study['geometryMode'])}><option value="part">Peça · sólido único</option><option value="assemblyBonded">Montagem · múltiplos sólidos</option></select></label>
            <p className="text-xs text-slate-500">Prepare a cópia da geometria usada na simulação. Alterar estas opções limpa cargas, apoios, contatos, refinamentos e materiais por corpo, pois as faces podem mudar.</p>
            {([['heal','Reparar e costurar faces'],['removeSmall','Remover arestas e faces pequenas'],['unite','Unir partes encostadas ou sobrepostas'],['closeGaps','Fechar microfolgas na união']] as const).map(([key,label])=><label key={key} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={preparation[key]} onChange={e=>prepare({[key]:e.target.checked,...(key==='closeGaps'&&e.target.checked?{unite:true}:{}),...(key==='unite'&&!e.target.checked?{closeGaps:false}:{})})}/>{label}</label>)}
            <NumberField label="Tolerância de reparo / união (mm)" value={preparation.tolerance} min={0.0000001} onChange={tolerance=>prepare({tolerance})}/>
            <p className="text-xs text-slate-500">Microfolgas: união por tolerância, até 1 mm. Não desloca componentes nem cria preenchimentos de grandes vãos. Confira os corpos conectados e a variação de volume após gerar a malha.</p>
            <button className={button} disabled={!study.step} onClick={()=>void mesh()}>Aplicar preparação e gerar malha</button>
            {study.mesh?.preparationReport&&<div className="rounded border p-2 text-xs">Sólidos: {study.mesh.preparationReport.originalBodies} → {study.mesh.preparationReport.preparedBodies}<br/>Variação de volume: {study.mesh.preparationReport.volumeChangePercent.toFixed(4)}%</div>}
          </>}
          {tab==='Material'&&<>
            <label className="block text-xs">Distribuição de materiais<select className={input} value={study.materialMode??'uniform'} onChange={e=>{setSelected([]);setMaterialRegion('common');update({materialMode:e.target.value as Study['materialMode'],regionMaterials:{},supports:[],loads:[],refinements:[],contacts:[]},true);}}><option value="uniform">Material comum</option><option value="regions">Material por corpo volumétrico</option></select></label>
            {study.materialMode==='regions'&&<>
              <p className="text-xs text-slate-500">Gere a malha para identificar os corpos. Interfaces encostadas compartilham nós quando a união está ativa. Sobreposições são rejeitadas. Alterar o modo limpa as condições existentes.</p>
              <label className="block text-xs">Corpo a editar<select className={input} value={activeMaterialRegion} onChange={e=>{setMaterialRegion(e.target.value);const region=study.mesh?.regions?.find(r=>String(r.id)===e.target.value);const elements=new Set(region?.elements);setSelected(region?study.mesh!.faces.filter(f=>f.elements.some(i=>elements.has(i))).map(f=>f.id):[]);}}><option value="common">Material padrão dos corpos</option>{study.mesh?.regions?.map(r=><option key={r.id} value={r.id}>Corpo {r.id} · centro {r.center.map(v=>v.toFixed(1)).join(', ')} mm</option>)}</select></label>
              {activeMaterialRegion!=='common'&&<button className={button} onClick={()=>{const materials={...study.regionMaterials};delete materials[activeMaterialRegion];update({regionMaterials:materials});}}>Usar material padrão neste corpo</button>}
            </>}

            <p className="text-xs text-slate-500">Material isotrópico em cada corpo. Confira os valores para a liga e condição reais da peça.</p>
            {builtInMessage&&<p role="alert" className="rounded bg-amber-50 p-2 text-xs text-amber-800">{builtInMessage}</p>}
            <label className="block text-xs">Predefinição<select className={input} value={presets.find(m=>m.name===editedMaterial.name)?.name??'personalizado'} onChange={e=>{const m=presets.find(m=>m.name===e.target.value);if(m)changeMaterial({...m});}}><option value="personalizado">Personalizado</option>{presets.map(m=><option key={m.name}>{m.name}</option>)}</select></label>
            {([['young','Módulo E (MPa)'],['poisson','Coeficiente de Poisson'],['density','Densidade (kg/m³)'],['yieldStress','Escoamento (MPa)']] as const).map(([key,label])=><NumberField key={key} label={label} value={editedMaterial[key]} onChange={value=>changeMaterial({...editedMaterial,name:'Personalizado',[key]:value})}/>)}
            <p className="rounded bg-slate-50 p-2 text-xs">Hipóteses: pequenas deformações, elasticidade linear e {preparation.unite?'união contínua das regiões unidas':(study.contacts?.some(c=>c.kind==='frictionless')?(study.contacts.some(c=>c.kind==='bonded')?'contatos aderidos e sem atrito com pequenos deslizamentos':'contato planar sem atrito com pequenos deslizamentos'):study.contacts?.length?'corpos ligados por contatos aderidos':'corpos sólidos sem contato entre si')}. Atrito, grandes deslizamentos, plasticidade e flambagem não estão incluídos.</p>
          </>}
          {tab==='Malha'&&<>
            <label className="block text-xs">Formulação<select className={input} value={study.elementType??'C3D4'} onChange={e=>{setMeshId(null);update({elementType:e.target.value as Study['elementType']});}}><option value="C3D10">Quadrática · C3D10 (10 nós)</option><option value="C3D4">Linear · C3D4 (4 nós)</option></select></label>
            <NumberField label="Tamanho global (mm)" value={study.size} min={0.01} onChange={size=>{setMeshId(null);update({size,meshControls:{...meshControls,minimumSize:Math.min(meshControls.minimumSize,size)},refinements:study.refinements.filter(r=>r.size<=size)});}}/>
            <NumberField label="Tamanho mínimo por curvatura (mm)" value={meshControls.minimumSize} min={0.01} onChange={minimumSize=>{setMeshId(null);update({meshControls:{...meshControls,minimumSize}});}}/>
            <NumberField label="Elementos por volta de curvatura (0 = desligado)" value={meshControls.curvature} min={0} onChange={curvature=>{setMeshId(null);update({meshControls:{...meshControls,curvature}});}}/>
            <NumberField label="Qualidade alvo minSICN (0,01 a 0,9)" value={meshControls.qualityTarget} min={0.01} onChange={qualityTarget=>{setMeshId(null);update({meshControls:{...meshControls,qualityTarget}});}}/>
            {study.mesh?.quality.belowTarget!==undefined&&<p className="text-xs">Elementos abaixo da qualidade alvo: {study.mesh.quality.belowTarget} · percentil 5: {study.mesh.quality.p05?.toFixed(3)}</p>}
            <p className="text-xs text-slate-500">C3D10 melhora a interpolação dos deslocamentos, especialmente em flexão. As arestas geométricas permanecem retas: refine também superfícies curvas. Verifique a convergência antes de interpretar os resultados.</p>
            <button className={button} disabled={!study.step||!Number.isFinite(study.size)||study.size<0.01} onClick={()=>void mesh()}>Gerar / atualizar malha</button>
            {study.mesh&&<><p className="text-xs">{study.mesh.nodes.length.toLocaleString()} nós · {study.mesh.tetrahedra.length.toLocaleString()} elementos{study.mesh.bodyCount!==undefined&&<> · {study.mesh.bodyCount} corpo(s) conectado(s)</>}<br/>Qualidade mínima: {study.mesh.quality.minimum.toFixed(3)} · média: {study.mesh.quality.mean.toFixed(3)}<br/>Índice minSICN: próximo de 1 é melhor.</p><p className="text-xs">Selecione faces no modelo para refinar a região.</p><NumberField label="Tamanho local (mm)" value={localSize} min={0.01} onChange={setLocalSize}/><button className={button} disabled={!selected.length||!Number.isFinite(localSize)||localSize<0.01||localSize>study.size} onClick={()=>{setMeshId(null);update({refinements:[...study.refinements.filter(r=>!selected.includes(r.faceId)),...selected.map(faceId=>({faceId,size:localSize}))]});}}>Refinar faces selecionadas</button></>}
            {study.refinements.map(r=><Row key={r.faceId} onRemove={()=>{setMeshId(null);update({refinements:study.refinements.filter(v=>v.faceId!==r.faceId)});}}>Face {r.faceId}: {r.size} mm</Row>)}
            {study.mesh&&!meshId&&<p className="text-xs text-amber-700">Gere a malha novamente antes de resolver. A malha exibida é a última disponível.</p>}
          </>}
          {tab==='Contatos'&&<ContactPanel study={study} selected={selected} onUpdate={update} onSelect={setSelected} onPrepare={()=>{setVisibleBody(null);prepare({unite:false,closeGaps:false},'assemblyBonded');}}/>}
          {tab==='Fixações'&&<>
            <Selection selected={selected} onClear={()=>setSelected([])}/><p className="text-xs">Selecione faces e marque os deslocamentos que devem ser zero.</p>
            <div className="flex gap-4">{['X','Y','Z'].map((axis,i)=><label className="flex items-center gap-1 text-sm" key={axis}><input type="checkbox" checked={axes[i]} onChange={e=>setAxes(axes.map((v,k)=>k===i?e.target.checked:v) as typeof axes)}/>{axis}</label>)}</div>
            <button className={button} disabled={!selected.length||!axes.some(Boolean)||!study.mesh} onClick={addSupport}>Adicionar fixação</button>
            {study.supports.map((s,i)=><Row key={s.id} onRemove={()=>update({supports:study.supports.filter(v=>v.id!==s.id)})}>Apoio {i+1} · faces {s.faceIds.join(', ')} · {s.axes.map((a,i)=>a?'XYZ'[i]:'').join('')}</Row>)}
          </>}
          {tab==='Cargas'&&<>
            <Selection selected={selected} onClear={()=>setSelected([])}/>
            <label className="block text-xs">Tipo<select className={input} value={kind} onChange={e=>{const k=e.target.value as typeof kind;setKind(k);setForce(k==='gravity'?[0,0,-9.80665]:[0,0,-1000]);}}><option value="force">Força total nas faces</option><option value="pressure">Pressão uniforme</option><option value="gravity">Gravidade</option></select></label>
            {kind==='pressure'?<NumberField label="Pressão (MPa) · positiva para dentro" value={pressure} onChange={setPressure}/>:<>{['X','Y','Z'].map((a,i)=><NumberField key={a} label={`${a} (${kind==='gravity'?'m/s²':'N'})`} value={force[i]} onChange={value=>setForce(force.map((v,k)=>k===i?value:v) as Vec3)}/>)}</>}
            <p className="text-xs text-slate-500">{kind==='force'?'O vetor é a força total, distribuída pela área conjunta das faces selecionadas.':kind==='pressure'?'A pressão atua na normal de cada triângulo. Valores negativos representam tração.':'A aceleração atua no volume inteiro usando a densidade do material.'}</p>
            <button className={button} disabled={!study.mesh||(kind!=='gravity'&&!selected.length)} onClick={addLoad}>Adicionar carga</button>
            {study.loads.map((l,i)=><Row key={l.id} onRemove={()=>update({loads:study.loads.filter(v=>v.id!==l.id)})}>Carga {i+1} · {l.kind==='pressure'?`${l.pressure} MPa`:l.vector.join(', ')+(l.kind==='gravity'?' m/s²':' N')}<br/>{l.kind==='gravity'?'Volume inteiro':`Faces ${l.faceIds.join(', ')}`}</Row>)}
          </>}
          {tab==='Resultados'&&<>
            <button className={button} disabled={!meshId||!study.mesh||!study.supports.length||!study.loads.length} onClick={()=>void solve()}>Resolver análise</button>
            <NumberField label="Tolerância de convergência (%)" value={convergenceTolerance} min={0.01} onChange={setConvergenceTolerance}/>
            <button className={button} disabled={!meshId||!study.mesh||!study.supports.length||!study.loads.length} onClick={()=>void convergence()}>Verificar convergência · até 4 malhas</button>
            <p className="text-xs text-slate-500">Reduz os tamanhos em 30% por etapa. Compara deslocamento, pico de tensão e energia em dois refinamentos consecutivos. Picos singulares podem não convergir.</p>
            {study.convergence&&<div className="overflow-x-auto text-xs"><p>{hasConverged(study.convergence.runs,study.convergence.tolerance)?'Critérios atendidos':'Convergência ainda não demonstrada'} · tolerância {study.convergence.tolerance}%</p><table className="mt-2 w-full text-right"><thead><tr><th>h (mm)</th><th>Elementos</th><th>Δu %</th><th>Δσ %</th><th>Δenergia %</th></tr></thead><tbody>{study.convergence.runs.map((r,i)=><tr key={i}><td>{r.size.toPrecision(3)}</td><td>{r.elements}</td><td>{r.displacementChange?.toFixed(2)??'—'}</td><td>{r.stressChange?.toFixed(2)??'—'}</td><td>{r.energyChange?.toFixed(2)??'—'}</td></tr>)}</tbody></table></div>}
            {!!study.results?.nonlinearHistory?.length&&<div className="text-xs"><strong>Convergência do contato</strong>{study.results.nonlinearHistory.map((h,i)=><p key={i}>Carga {(h.loadFactor*100).toFixed(1)}% · {h.iterations} iterações · {h.activePoints} pontos ativos</p>)}</div>}
            {study.results?.contacts?.map((c,i)=><div key={c.id} className="rounded border p-2 text-xs"><strong>{c.kind==='frictionless'?'Contato sem atrito':'Contato aderido'} {i+1}</strong>{c.kind==='frictionless'?<><p>{c.activePoints} / {c.contactPoints} pontos em compressão</p><p>Pressão máxima: {c.maxPressure?.toFixed(3)} MPa</p><p>Abertura / penetração: {c.maxOpening?.toExponential(2)} / {c.maxPenetration?.toExponential(2)} mm</p><p>Energia de penalidade: {c.contactEnergy?.toExponential(3)} N·mm</p></>:<p>{c.bondedNodes} nós vinculados</p>}<p>Força na dependente X/Y/Z (N): {c.slaveForce.map(v=>v.toFixed(3)).join(' / ')}</p><p>Descontinuidade máxima: {c.maxRelativeDisplacement.toExponential(2)} mm</p></div>)}
            {study.results?<>
              <label className="block text-xs">Campo<select className={input} value={field} onChange={e=>setField(e.target.value as ResultField)}><option value="stress">Tensão de von Mises (MPa)</option><option value="displacement">Deslocamento total (mm)</option><option value="strainX">Deformação εxx (mm/mm)</option></select></label>
              <NumberField label="Ampliação da deformada (0 = original)" value={scale} min={0} onChange={value=>setScale(Number.isFinite(value)?Math.max(0,Math.min(100000,value)):0)}/>
              <div className="space-y-2 rounded border p-3 text-xs"><p>Deslocamento máximo: <strong>{study.results.summary.maxDisplacement.toExponential(4)} mm</strong></p><p>Von Mises máximo: <strong>{study.results.summary.maxVonMises.toFixed(3)} MPa</strong></p><p>Razão escoamento / tensão: <strong>{study.results.summary.minSafetyFactor?.toFixed(3)??'—'}</strong></p><p>Reações X/Y/Z (N): {study.results.summary.reaction.map(v=>v.toFixed(3)).join(' / ')}</p><p>Energia de deformação: {study.results.summary.strainEnergy?.toExponential(3)??'—'} N·mm</p><p>Erro de momentos: {study.results.summary.momentBalanceError?.toExponential(2)??'—'} N·mm</p><p>Erro de equilíbrio: {study.results.summary.balanceError.toExponential(2)} N</p></div>
              <p className="text-xs text-slate-500">C3D4: tensão constante. C3D10: von Mises máximo dos 4 pontos de integração por elemento; tensores e deformações médios. Sem suavização no mapa. A razão de escoamento não verifica flambagem, fadiga, contatos ou concentração singular de tensão.</p>
              <button className={button} onClick={()=>download(JSON.stringify(study.results,null,2),'resultados-fea.json')}>Exportar resultados JSON</button>
              {solveId&&<button className={button} onClick={()=>void withBusy(async()=>{const response=await fetch(`/api/simulation?jobId=${solveId}&input=1`);if(!response.ok)throw new Error('Entrada indisponível. Recalcule o estudo.');download(await response.text(),'analysis.inp','text/plain');})}>{study.contacts?.some(c=>c.kind==='frictionless')?'Exportar última linearização CalculiX':'Exportar entrada CalculiX'}</button>}
            </>:<p className="text-xs text-slate-500">Gere a malha, adicione fixações e cargas e resolva. Alterações nas condições invalidam os resultados anteriores.</p>}
          </>}
        </fieldset>
        <details className="border-t p-3 text-xs text-slate-500"><summary className="cursor-pointer">Serviço de cálculo</summary><p className="mt-2 break-words">{service}</p><p className="mt-2">Limite: 30 mil nós, 100 mil elementos, 240 s por trabalho.</p></details>
      </aside>}
      <main className="relative min-h-0 min-w-0 flex-1"><SimulationViewer visibleBody={study.mesh?.faces.some(f=>f.bodyId===visibleBody)?visibleBody:null} study={study} preview={preview} selected={selected} onSelect={id=>{if(!busy)setSelected(ids=>ids.includes(id)?ids.filter(v=>v!==id):[...ids,id]);}} field={field} scale={study.results?scale:0} wireframe={wireframe}/><label className="absolute left-3 top-3 flex items-center gap-2 rounded bg-white/90 px-2 py-1 text-xs"><input type="checkbox" checked={wireframe} onChange={e=>setWireframe(e.target.checked)}/>Exibir malha</label>{study.mesh?.faces.some(f=>f.bodyId!==undefined)&&<label className="absolute left-3 top-12 rounded bg-white/90 px-2 py-1 text-xs">Corpo visível<select className="ml-2 rounded border" value={study.mesh.faces.some(f=>f.bodyId===visibleBody)?visibleBody!:0} onChange={e=>setVisibleBody(Number(e.target.value)||null)}><option value={0}>Todos</option>{[...new Set(study.mesh.faces.map(f=>f.bodyId).filter((id):id is number=>id!==undefined))].sort((a,b)=>a-b).map(id=><option key={id} value={id}>Corpo {id}</option>)}</select></label>}</main>
    </div>
    <footer role="status" className="shrink-0 bg-primary-100 px-4 py-1.5 text-xs text-primary-800">{status||'Estudo independente da peça original · selecione uma etapa para começar.'}</footer>
  </div>;
}
function NumberField({label,value,onChange,min}:{label:string;value:number;onChange:(n:number)=>void;min?:number}){return <label className="block text-xs">{label}<input type="number" step="any" min={min} value={Number.isFinite(value)?value:''} className={input} onChange={e=>onChange(e.target.valueAsNumber)}/></label>;}
function Selection({selected,onClear}:{selected:number[];onClear:()=>void}){return <div className="rounded bg-amber-50 p-2 text-xs">Faces: {selected.length?selected.join(', '):'clique no modelo'}{selected.length>0&&<button className="ml-2 underline" onClick={onClear}>Limpar</button>}</div>;}
function Row({children,onRemove}:{children:React.ReactNode;onRemove:()=>void}){return <div className="flex items-center justify-between gap-2 rounded border p-2 text-xs"><span>{children}</span><button aria-label="Remover condição" className="rounded px-2 py-1 text-red-700 hover:bg-red-50" onClick={onRemove}>×</button></div>;}
