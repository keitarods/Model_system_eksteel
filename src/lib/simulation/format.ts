import { emptyStudy, type Study, type FeaMesh, type FeaResults, type Contact } from './types';
const finite = (n:unknown):n is number => typeof n==='number'&&Number.isFinite(n);
const vector = (v:unknown):v is number[] => Array.isArray(v)&&v.length===3&&v.every(finite);
export function validateMesh(mesh: FeaMesh) {
  if(!mesh || !Array.isArray(mesh.nodes)||mesh.nodes.length<4||mesh.nodes.length>30000||!mesh.nodes.every(vector)||!Array.isArray(mesh.tetrahedra)||!mesh.tetrahedra.length||mesh.tetrahedra.length>100000) throw new Error('Malha inválida.');
  const index=(n:number)=>Number.isInteger(n)&&n>=0&&n<mesh.nodes.length;
  const arity=mesh.elementType==='C3D10'?10:4;
  if(!mesh.tetrahedra.every(t=>Array.isArray(t)&&t.length===arity&&new Set(t).size===arity&&t.every(index)))throw new Error('Conectividade volumétrica inválida.');
  if(!Array.isArray(mesh.faces)||!mesh.faces.length||mesh.faces.length>10000||new Set(mesh.faces.map(f=>f.id)).size!==mesh.faces.length)throw new Error('Faces inválidas.');
  for(const f of mesh.faces)if(!Number.isInteger(f.id)||f.id<=0||!finite(f.area)||f.area<=0||!vector(f.center)||!Array.isArray(f.triangles)||!f.triangles.length||!f.triangles.every(t=>Array.isArray(t)&&t.length===3&&t.every(index))||!Array.isArray(f.elements)||f.elements.length!==f.triangles.length||!f.elements.every(e=>Number.isInteger(e)&&e>=0&&e<mesh.tetrahedra.length))throw new Error('Superfície de malha inválida.');
  if(mesh.faces.some(f=>(f.bodyId!==undefined&&(!Number.isInteger(f.bodyId)||f.bodyId<1))||(f.normal!==undefined&&!vector(f.normal))))throw new Error('Identificação de face inválida.');
  if(mesh.elementType==='C3D10')for(const f of mesh.faces){
    if(!Array.isArray(f.loadTriangles)||!f.loadTriangles.length||!f.loadTriangles.every(t=>Array.isArray(t)&&t.length===6&&new Set(t).size===6&&t.every(index)))throw new Error('Superfície quadrática inválida.');
  }
  if(mesh.regions!==undefined){
    if(!Array.isArray(mesh.regions)||new Set(mesh.regions.map(r=>r.id)).size!==mesh.regions.length)throw new Error('Regiões inválidas.');
    const assigned=new Set<number>();
    for(const r of mesh.regions){
      if(!Number.isInteger(r.id)||r.id<1||!finite(r.volume)||r.volume<=0||!vector(r.center)||!Array.isArray(r.elements)||!r.elements.length)throw new Error('Região inválida.');
      for(const e of r.elements){if(!Number.isInteger(e)||e<0||e>=mesh.tetrahedra.length||assigned.has(e))throw new Error('Região com elementos inválidos.');assigned.add(e);}
    }
    if(mesh.regions.length&&assigned.size!==mesh.tetrahedra.length)throw new Error('Regiões incompletas.');
  }
  if(mesh.preparationReport!==undefined){
    const r=mesh.preparationReport;
    if(!r||![r.originalBodies,r.preparedBodies,r.originalVolume,r.preparedVolume,r.volumeChangePercent,r.tolerance].every(finite)||!Number.isInteger(r.originalBodies)||r.originalBodies<1||!Number.isInteger(r.preparedBodies)||r.preparedBodies<1||r.originalVolume<=0||r.preparedVolume<=0||r.tolerance<=0)throw new Error('Relatório de preparação inválido.');
  }
  if(mesh.quality&&[mesh.quality.p05,mesh.quality.belowTarget,mesh.quality.target].some(v=>v!==undefined&&!finite(v)))throw new Error('Diagnóstico de qualidade inválido.');
  if(!mesh.quality||!finite(mesh.quality.minimum)||!finite(mesh.quality.mean)||!finite(mesh.volume)||mesh.volume<=0||!['C3D4','C3D10'].includes(mesh.elementType))throw new Error('Qualidade de malha inválida.');
}
export function validateGeneratedMesh(mesh:FeaMesh,study:Study){
  validateMesh(mesh);
  if(mesh.elementType!==(study.elementType??'C3D4')||(study.materialMode==='regions'&&!mesh.regions?.length))throw new Error('O serviço retornou uma formulação incompatível. Reinicie ou atualize o serviço FEA.');
}
export function validateResults(result:FeaResults,mesh:FeaMesh,contacts:Contact[]=[]){
  if(!result||!Array.isArray(result.displacements)||result.displacements.length!==mesh.nodes.length||!result.displacements.every(vector))throw new Error('Deslocamentos inválidos.');
  for(const field of [result.displacementMagnitude,result.nodalVonMises])if(!Array.isArray(field)||field.length!==mesh.nodes.length||!field.every(finite))throw new Error('Campo de resultado inválido.');
  if(!Array.isArray(result.elementVonMises)||result.elementVonMises.length!==mesh.tetrahedra.length||!result.elementVonMises.every(finite)||!Array.isArray(result.reactions)||result.reactions.length!==mesh.nodes.length||!result.reactions.every(vector))throw new Error('Resultados incompatíveis com a malha.');
  for(const field of [result.elementStress,result.elementStrain])if(!Array.isArray(field)||field.length!==mesh.tetrahedra.length||!field.every(v=>Array.isArray(v)&&v.length===6&&v.every(finite)))throw new Error("Tensões ou deformações inválidas.");
  if(result.elementType!==undefined&&result.elementType!==mesh.elementType)throw new Error('Tipo de elemento incompatível.');
  if(result.summary?.strainEnergy!==undefined&&(!finite(result.summary.strainEnergy)||result.summary.strainEnergy<0))throw new Error('Energia inválida.');
  if(result.contacts!==undefined&&(!Array.isArray(result.contacts)||result.contacts.length>100||new Set(result.contacts.map(c=>c?.id)).size!==result.contacts.length||result.contacts.some(c=>!c||typeof c.id!=='string'||(c.kind!==undefined&&!['bonded','frictionless'].includes(c.kind))||!Number.isInteger(c.bondedNodes)||(c.kind==='frictionless'?c.bondedNodes!==0:c.bondedNodes<3)||![c.maxInitialGap,c.maxRelativeDisplacement].every(v=>finite(v)&&v>=0)||!vector(c.slaveForce)||!vector(c.masterForce))))throw new Error('Resultados de contato inválidos.');
  if(result.nodalContactForces!==undefined&&(!Array.isArray(result.nodalContactForces)||(result.nodalContactForces.length!==0&&result.nodalContactForces.length!==mesh.nodes.length)||!result.nodalContactForces.every(vector)))throw new Error('Forças de contato inválidas.');
  if(contacts.length&&(!result.contacts||result.contacts.length!==contacts.length||contacts.some(c=>!result.contacts!.some(r=>r.id===c.id&&(r.kind??'bonded')===c.kind))||result.nodalContactForces?.length!==mesh.nodes.length))throw new Error('O serviço não retornou os contatos solicitados. Atualize o serviço FEA.');
  if(result.contacts?.some(c=>c.kind==='frictionless'&&(!Number.isInteger(c.contactPoints)||c.contactPoints!<3||!Number.isInteger(c.activePoints)||c.activePoints!<0||c.activePoints!>c.contactPoints!||![c.maxOpening,c.maxPenetration,c.maxPressure,c.contactEnergy,c.maxTangentialSlip].every(v=>finite(v)&&v>=0))))throw new Error('Resultados de contato unilateral inválidos.');
  const history=result.nonlinearHistory;
  if(history!==undefined&&(!Array.isArray(history)||history.length>100||history.some((h,i)=>!h||!finite(h.loadFactor)||h.loadFactor<=0||h.loadFactor>1||(i>0&&h.loadFactor<=history[i-1].loadFactor)||!Number.isInteger(h.iterations)||h.iterations<1||h.iterations>30||!Number.isInteger(h.activePoints)||h.activePoints<0)))throw new Error('Histórico incremental inválido.');
  if((contacts.some(c=>c.kind==='frictionless')||result.contacts?.some(c=>c.kind==='frictionless'))&&(!history?.length||history.at(-1)!.loadFactor!==1))throw new Error('O contato não atingiu a carga total.');
  const summary=result.summary;
  if(summary&&((summary.momentBalanceError!==undefined&&!finite(summary.momentBalanceError))||[summary.appliedMoment,summary.reactionMoment].some(v=>v!==undefined&&!vector(v))))throw new Error('Equilíbrio de momentos inválido.');
  if(!summary||![summary.maxDisplacement,summary.maxVonMises,summary.balanceError,summary.freeResidualRelative].every(finite)||!(summary.minSafetyFactor===null||finite(summary.minSafetyFactor))||!vector(summary.reaction)||!vector(summary.appliedForce))throw new Error('Resumo de resultados inválido.');
}
export function serializeStudy(study:Study){return JSON.stringify({format:'eksteel-fea',version:1,study});}
export function parseStudy(json:string):Study {
  const data=JSON.parse(json);
  if(data?.format!=='eksteel-fea'||data.version!==1||!data.study)throw new Error('Arquivo de simulação não reconhecido.');
  const s=data.study as Study;
  if(typeof s.name!=='string'||typeof s.sourceName!=='string'||typeof s.step!=='string'||s.step.length>12000000||(s.step&&!s.step.includes('ISO-10303-21;'))||!finite(s.size)||s.size<0.01)throw new Error('Geometria ou configuração inválida.');
  if(s.geometryMode!==undefined&&!['part','assemblyBonded'].includes(s.geometryMode))throw new Error('Tipo de geometria inválido.');
  if(s.components!==undefined&&(!Array.isArray(s.components)||s.components.length>128||s.components.some(c=>!c||typeof c.id!=='string'||typeof c.label!=='string')))throw new Error('Componentes da simulação inválidos.');
  if(s.preparation!==undefined){
    const p=s.preparation;
    if(!p||!['heal','removeSmall','closeGaps','unite'].every(k=>typeof p[k as keyof typeof p]==='boolean')||!finite(p.tolerance)||p.tolerance<1e-7||p.tolerance>1||(p.closeGaps&&!p.unite))throw new Error('Preparação geométrica inválida.');
  }
  if(s.meshControls!==undefined){
    const c=s.meshControls;
    if(!c||![c.minimumSize,c.curvature,c.qualityTarget].every(finite)||c.minimumSize<0.01||c.minimumSize>s.size||c.curvature<0||c.curvature>100||c.qualityTarget<0.01||c.qualityTarget>0.9)throw new Error('Controles de malha inválidos.');
  }
  if(s.elementType!==undefined&&!['C3D4','C3D10'].includes(s.elementType))throw new Error('Tipo de elemento inválido.');
  if(s.convergence!==undefined){
    const c=s.convergence;
    if(!c||!finite(c.tolerance)||c.tolerance<=0||c.tolerance>100||!Array.isArray(c.runs)||c.runs.length>8||c.runs.some(r=>!r||![r.size,r.nodes,r.elements,r.displacement,r.stress,r.energy].every(v=>finite(v)&&v>=0)||[r.displacementChange,r.stressChange,r.energyChange].some(v=>v!==null&&(!finite(v)||v<0))))throw new Error('Histórico de convergência inválido.');
  }
  if(s.materialMode!==undefined&&!['uniform','regions'].includes(s.materialMode))throw new Error('Modo de materiais inválido.');
  if(s.regionMaterials!==undefined){
    if(!s.regionMaterials||typeof s.regionMaterials!=='object'||Array.isArray(s.regionMaterials)||Object.keys(s.regionMaterials).length>128)throw new Error('Materiais por corpo inválidos.');
    for(const [id,m] of Object.entries(s.regionMaterials)){
      if(!/^[1-9][0-9]*$/.test(id)||!m||typeof m.name!=='string'||![m.young,m.poisson,m.density,m.yieldStress].every(finite)||m.young<=0||m.poisson<=-1||m.poisson>.49||m.density<0||m.yieldStress<=0)throw new Error('Material de corpo inválido.');
      if(s.materialMode!=='regions'||(s.mesh&&!s.mesh.regions?.some(r=>String(r.id)===id)))throw new Error('Material sem região correspondente.');
    }
  }
  const m=s.material;
  if(!m||typeof m.name!=='string'||![m.young,m.poisson,m.density,m.yieldStress].every(finite)||m.young<=0||m.poisson<=-1||m.poisson>0.49||m.density<0||m.yieldStress<=0)throw new Error('Material inválido.');
  if(!Array.isArray(s.supports)||s.supports.length>100||!Array.isArray(s.loads)||s.loads.length>100||!Array.isArray(s.refinements)||s.refinements.length>100)throw new Error('Condições inválidas.');
  const faceIds=(ids:number[])=>Array.isArray(ids)&&ids.every(id=>Number.isInteger(id)&&id>0);
  if(s.supports.some(v=>!v||typeof v.id!=='string'||!faceIds(v.faceIds)||!v.faceIds.length||!Array.isArray(v.axes)||v.axes.length!==3||!v.axes.every(a=>typeof a==='boolean')||!v.axes.some(Boolean)))throw new Error('Fixações inválidas.');
  if(s.loads.some(v=>v&&(v.direction!==undefined&&!['vector','normal'].includes(v.direction)||v.inverted!==undefined&&typeof v.inverted!=='boolean'||v.direction==='normal'&&(v.kind!=='force'||!finite(v.magnitude)||v.magnitude!<=0))))throw new Error('Direção ou intensidade de força inválida.');
  if(s.loads.some(v=>!v||typeof v.id!=='string'||!['force','pressure','gravity'].includes(v.kind)||!faceIds(v.faceIds)||(v.kind!=='gravity'&&!v.faceIds.length)||!vector(v.vector)||!finite(v.pressure)))throw new Error('Cargas inválidas.');
  if(s.contacts!==undefined){
    if(!Array.isArray(s.contacts)||s.contacts.length>100||new Set(s.contacts.map(c=>c?.id)).size!==s.contacts.length||s.contacts.some(c=>!c||typeof c.id!=='string'||!c.id||!['bonded','frictionless'].includes(c.kind)||(c.kind==='frictionless'&&(!finite(c.normalStiffness)||c.normalStiffness<1||c.normalStiffness>1e9||!finite(c.searchDistance)||c.searchDistance<0||c.searchDistance>10))||!faceIds([c.masterFaceId,c.slaveFaceId])||c.masterFaceId===c.slaveFaceId))throw new Error('Contatos inválidos.');
    if(s.mesh&&s.contacts.some(c=>![c.masterFaceId,c.slaveFaceId].every(id=>s.mesh!.faces.some(f=>f.id===id))))throw new Error('Contato referencia uma face inexistente.');
  }
  if(s.refinements.some(r=>!r||!Number.isInteger(r.faceId)||r.faceId<=0||!finite(r.size)||r.size<0.01||r.size>s.size))throw new Error('Refinamentos inválidos.');
  if(s.mesh){validateMesh(s.mesh);const faces=new Set(s.mesh.faces.map(f=>f.id));if([...s.supports,...s.loads].some(c=>c.faceIds.some(id=>!faces.has(id))))throw new Error('Uma condição referencia uma face inexistente.');}
  if(s.results){if(!s.mesh)throw new Error('Resultado sem malha.');validateResults(s.results,s.mesh,s.contacts);}
  return {...emptyStudy(),...s,elementType:s.elementType??s.mesh?.elementType??'C3D4'};
}
