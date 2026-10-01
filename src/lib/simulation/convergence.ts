import type {ConvergenceRun, FeaMesh, FeaResults, Study} from './types';

export function convergenceRow(mesh:FeaMesh,results:FeaResults,previous?:ConvergenceRun):ConvergenceRun {
  const {maxDisplacement:displacement,maxVonMises:stress,strainEnergy:energy}=results.summary;
  if(energy===undefined)throw new Error('O serviço não retornou energia de deformação. Atualize o serviço FEA.');
  const change=(value:number,old:number|undefined)=>old===undefined?null:100*Math.abs(value-old)/Math.max(Math.abs(value),Math.abs(old),1e-15);
  return {size:mesh.size,nodes:mesh.nodes.length,elements:mesh.tetrahedra.length,displacement,stress,energy,
    displacementChange:change(displacement,previous?.displacement),stressChange:change(stress,previous?.stress),energyChange:change(energy,previous?.energy)};
}
/** Two successive refinements must meet all criteria; a single small change is insufficient. */
export function hasConverged(runs:ConvergenceRun[],tolerance:number):boolean {
  return runs.length>=3&&runs.slice(-2).every(r=>[r.displacementChange,r.stressChange,r.energyChange].every(v=>v!==null&&v<=tolerance));
}
export function refinedStudy(study:Study):Study {
  const size=study.size*.7;
  if(size<.01)throw new Error('O refinamento atingiu o tamanho mínimo permitido.');
  return {...study,size,mesh:null,results:null,
    meshControls:study.meshControls?{...study.meshControls,minimumSize:Math.max(.01,study.meshControls.minimumSize*.7)}:undefined,
    refinements:study.refinements.map(r=>({...r,size:Math.max(.01,r.size*.7)}))};
}
/** Stable CAD face tags plus geometric checks before reusing boundary conditions. */
export function verifyFaceReferences(previous:FeaMesh,next:FeaMesh,study:Study){
  for(const id of Object.keys(study.regionMaterials??{})){
    const before=previous.regions?.find(r=>String(r.id)===id),after=next.regions?.find(r=>String(r.id)===id);
    if(!before||!after||Math.abs(before.volume-after.volume)>Math.max(before.volume,1)*1e-7||before.center.some((v,i)=>Math.abs(v-after.center[i])>Math.max(Math.abs(v),1)*1e-7))throw new Error('Os corpos mudaram durante o refinamento. Redefina os materiais.');
  }
  const ids=new Set([...study.supports,...study.loads,...(study.contacts??[]).map(c=>({faceIds:[c.masterFaceId,c.slaveFaceId]})),...study.refinements.map(r=>({faceIds:[r.faceId]}))].flatMap(c=>c.faceIds));
  for(const id of ids){
    const before=previous.faces.find(f=>f.id===id),after=next.faces.find(f=>f.id===id);
    if(!before||!after||Math.abs(before.area-after.area)>Math.max(before.area,1)*1e-7||before.center.some((v,i)=>Math.abs(v-after.center[i])>Math.max(Math.abs(v),1)*1e-7))throw new Error('As faces mudaram durante o refinamento. Redefina as condições.');
  }
}
