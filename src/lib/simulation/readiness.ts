import type {Study} from './types';
export type AnalysisRequirement={id:string;tab:'Geometria'|'Malha'|'Fixações'|'Cargas';message:string;action:string};

/** These are preparation checks; the solver still checks physical stability. */
export function analysisRequirements(study:Study,meshId:string|null):AnalysisRequirement[]{
  const missing:AnalysisRequirement[]=[];
  if(!study.step)missing.push({id:'geometry',tab:'Geometria',message:'Importe uma peça ou montagem para iniciar o estudo.',action:'Ver geometria'});
  if(!study.mesh)missing.push({id:'mesh',tab:'Malha',message:'Gere a malha da geometria antes de resolver.',action:'Configurar malha'});
  else if(!meshId)missing.push({id:'mesh-session',tab:'Malha',message:'A malha exibida precisa ser gerada novamente para calcular. Isso ocorre ao reabrir o estudo, reconectar o comunicador ou alterar as configurações de malha.',action:'Atualizar malha'});
  if(!study.supports.length)missing.push({id:'supports',tab:'Fixações',message:'Adicione uma fixação: selecione a face, marque os deslocamentos e clique em “Adicionar fixação”.',action:'Definir fixação'});
  if(!study.loads.length)missing.push({id:'loads',tab:'Cargas',message:'Adicione uma carga: selecione a face, informe a intensidade e clique em “Adicionar carga”.',action:'Definir carga'});
  return missing;
}
