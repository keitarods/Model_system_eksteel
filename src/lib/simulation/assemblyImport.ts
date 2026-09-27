import * as THREE from 'three';
import { compoundShapes, type AnyShape, type ShapeMesh } from 'replicad';
import type { AssemblyDocument, ComponentInstance } from '@/lib/assembly/types';
import type { Feature } from '@/lib/features/types';
import { solveAssembly } from '@/lib/assembly/solver';
import { rebuildModel } from '@/lib/replicad/build-model';
import { parseProject } from '@/lib/project/nativeFormat';
import { resolveLinkedFile } from '@/lib/project/linkedFiles';

export type AssemblySnapshot = {step:string;preview:ShapeMesh;components:{id:string;label:string}[]};
type ReadPart = (instance:ComponentInstance)=>Promise<Feature[]>;
async function readPart(instance:ComponentInstance):Promise<Feature[]> {
  if(instance.embeddedPart)return parseProject(instance.embeddedPart).features;
  const part=await resolveLinkedFile(instance.linkKey);
  if(!part.ok)throw new Error(`Religue a peça "${instance.label}" na Montagem ou use um arquivo de montagem com peças incorporadas.`);
  return part.features;
}
/** Snapshot of ALL unsuppressed instances, including hidden ones. Never edits the CAD stores. */
export async function snapshotAssembly(doc:AssemblyDocument,read:ReadPart=readPart):Promise<AssemblySnapshot>{
  const active=doc.instances.filter(i=>!i.suppressed);
  if(!active.length)throw new Error('A montagem não possui componentes ativos. Abra ou crie uma montagem primeiro.');
  if(active.length>128)throw new Error('Esta versão permite até 128 componentes por estudo.');
  const solved=solveAssembly(doc.instances,doc.constraints);
  if(solved.unsatisfiedConstraintIds.length)throw new Error('Resolva as restrições conflitantes na Montagem antes de importar para a Simulação.');
  const solids:AnyShape[]=[];let compound:AnyShape|null=null;
  try{
    for(const instance of active){
      const features=await read(instance);
      let solid=rebuildModel([...features,...(instance.assemblyFeatures??[])]);
      if(!solid)throw new Error(`O componente "${instance.label}" não possui um sólido para simular.`);
      solids.push(solid);
      const placement=solved.placements[instance.id]??instance.placementSeed;
      if(!placement||placement.position.length!==3||placement.quaternion.length!==4||![...placement.position,...placement.quaternion].every(Number.isFinite))throw new Error(`Posição inválida do componente "${instance.label}".`);
      const q=new THREE.Quaternion(...placement.quaternion);
      if(q.length()<1e-12)throw new Error(`Rotação inválida do componente "${instance.label}".`);
      q.normalize();
      const angle=2*Math.acos(Math.max(-1,Math.min(1,q.w)));
      const sine=Math.sqrt(Math.max(0,1-q.w*q.w));
      if(sine>1e-10){solid=solid.rotate(angle*180/Math.PI,[0,0,0],[q.x/sine,q.y/sine,q.z/sine]);solids[solids.length-1]=solid;}
      solid=solid.translate(placement.position);
      solids[solids.length-1]=solid;
    }
    compound=compoundShapes(solids);
    solids.length=0; // compoundShapes consumes its input wrappers.
    if(!('mesh' in compound))throw new Error('A montagem não produziu geometria volumétrica.');
    const blob=compound.blobSTEP();
    if(blob.size>12_000_000)throw new Error('A montagem excede o limite de 12 MB de geometria. Simplifique os componentes.');
    return {step:await blob.text(),preview:compound.mesh(),components:active.map(({id,label})=>({id,label}))};
  }finally{
    compound?.delete();
    solids.forEach(s=>s.delete());
  }
}
