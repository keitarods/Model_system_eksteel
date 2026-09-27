import { emptyStudy, type Study, type FeaMesh, type FeaResults } from './types';
const finite = (n:unknown):n is number => typeof n==='number'&&Number.isFinite(n);
const vector = (v:unknown):v is number[] => Array.isArray(v)&&v.length===3&&v.every(finite);
export function validateMesh(mesh: FeaMesh) {
  if(!mesh || !Array.isArray(mesh.nodes)||mesh.nodes.length<4||mesh.nodes.length>30000||!mesh.nodes.every(vector)||!Array.isArray(mesh.tetrahedra)||!mesh.tetrahedra.length||mesh.tetrahedra.length>100000) throw new Error('Malha inválida.');
  const index=(n:number)=>Number.isInteger(n)&&n>=0&&n<mesh.nodes.length;
  if(!mesh.tetrahedra.every(t=>Array.isArray(t)&&t.length===4&&new Set(t).size===4&&t.every(index)))throw new Error('Conectividade volumétrica inválida.');
  if(!Array.isArray(mesh.faces)||!mesh.faces.length||mesh.faces.length>10000||new Set(mesh.faces.map(f=>f.id)).size!==mesh.faces.length)throw new Error('Faces inválidas.');
  for(const f of mesh.faces)if(!Number.isInteger(f.id)||f.id<=0||!finite(f.area)||f.area<=0||!vector(f.center)||!Array.isArray(f.triangles)||!f.triangles.length||!f.triangles.every(t=>Array.isArray(t)&&t.length===3&&t.every(index))||!Array.isArray(f.elements)||f.elements.length!==f.triangles.length||!f.elements.every(e=>Number.isInteger(e)&&e>=0&&e<mesh.tetrahedra.length))throw new Error('Superfície de malha inválida.');
  if(!mesh.quality||!finite(mesh.quality.minimum)||!finite(mesh.quality.mean)||!finite(mesh.volume)||mesh.volume<=0||mesh.elementType!=='C3D4')throw new Error('Qualidade de malha inválida.');
}
export function validateResults(result:FeaResults,mesh:FeaMesh){
  if(!result||!Array.isArray(result.displacements)||result.displacements.length!==mesh.nodes.length||!result.displacements.every(vector))throw new Error('Deslocamentos inválidos.');
  for(const field of [result.displacementMagnitude,result.nodalVonMises])if(!Array.isArray(field)||field.length!==mesh.nodes.length||!field.every(finite))throw new Error('Campo de resultado inválido.');
  if(!Array.isArray(result.elementVonMises)||result.elementVonMises.length!==mesh.tetrahedra.length||!result.elementVonMises.every(finite)||!Array.isArray(result.reactions)||result.reactions.length!==mesh.nodes.length||!result.reactions.every(vector))throw new Error('Resultados incompatíveis com a malha.');
  for(const field of [result.elementStress,result.elementStrain])if(!Array.isArray(field)||field.length!==mesh.tetrahedra.length||!field.every(v=>Array.isArray(v)&&v.length===6&&v.every(finite)))throw new Error("Tensões ou deformações inválidas.");
  const summary=result.summary;
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
  const m=s.material;
  if(!m||typeof m.name!=='string'||![m.young,m.poisson,m.density,m.yieldStress].every(finite)||m.young<=0||m.poisson<=-1||m.poisson>0.49||m.density<0||m.yieldStress<=0)throw new Error('Material inválido.');
  if(!Array.isArray(s.supports)||s.supports.length>100||!Array.isArray(s.loads)||s.loads.length>100||!Array.isArray(s.refinements)||s.refinements.length>100)throw new Error('Condições inválidas.');
  const faceIds=(ids:number[])=>Array.isArray(ids)&&ids.every(id=>Number.isInteger(id)&&id>0);
  if(s.supports.some(v=>!v||typeof v.id!=='string'||!faceIds(v.faceIds)||!v.faceIds.length||!Array.isArray(v.axes)||v.axes.length!==3||!v.axes.every(a=>typeof a==='boolean')||!v.axes.some(Boolean)))throw new Error('Fixações inválidas.');
  if(s.loads.some(v=>!v||typeof v.id!=='string'||!['force','pressure','gravity'].includes(v.kind)||!faceIds(v.faceIds)||(v.kind!=='gravity'&&!v.faceIds.length)||!vector(v.vector)||!finite(v.pressure)))throw new Error('Cargas inválidas.');
  if(s.refinements.some(r=>!r||!Number.isInteger(r.faceId)||r.faceId<=0||!finite(r.size)||r.size<0.01||r.size>s.size))throw new Error('Refinamentos inválidos.');
  if(s.mesh){validateMesh(s.mesh);const faces=new Set(s.mesh.faces.map(f=>f.id));if([...s.supports,...s.loads].some(c=>c.faceIds.some(id=>!faces.has(id))))throw new Error('Uma condição referencia uma face inexistente.');}
  if(s.results){if(!s.mesh)throw new Error('Resultado sem malha.');validateResults(s.results,s.mesh);}
  return {...emptyStudy(),...s};
}
