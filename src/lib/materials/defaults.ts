/**
 * Regras da biblioteca padrão (Inventor Material Library). Os dados ficam na tabela
 * public.eksteel_materials do Supabase de login — ver builtInLibrary.ts e
 * scripts/build-inventor-materials.cjs — e não no repositório.
 */
import {toSimulationMaterial,type MaterialDefinition} from './library';

/** Estudo novo da Simulação: valores do "Steel" padrão do Inventor, disponíveis mesmo sem o banco. */
export const DEFAULT_SIMULATION_MATERIAL={name:'Aço',young:210000,poisson:.3,density:7850,yieldStress:207};

const same=(a:MaterialDefinition,b:MaterialDefinition)=>JSON.stringify(a)===JSON.stringify(b);

/** Materiais padrão primeiro, com as versões salvas pelo usuário substituindo-os por id, depois os do usuário. */
export function withDefaultMaterials(builtIn:MaterialDefinition[],saved:MaterialDefinition[]):MaterialDefinition[]{
  const merged=new Map(builtIn.map(m=>[m.id,m]));
  for(const m of saved)merged.set(m.id,m);
  return [...merged.values()];
}

/** Só o que difere da biblioteca padrão precisa ir para o armazenamento local, para que atualizações dela cheguem aos usuários. */
export function userMaterials(library:MaterialDefinition[],builtIn:MaterialDefinition[]):MaterialDefinition[]{
  const byId=new Map(builtIn.map(m=>[m.id,m]));
  return library.filter(m=>{const d=byId.get(m.id);return !d||!same(d,m);});
}

/** Ordem alfabética dos seletores, pelas regras do português (acentos, maiúsculas). */
export const byName=(a:{name:string},b:{name:string})=>a.name.localeCompare(b.name,'pt-BR',{sensitivity:'base',numeric:true});

/** Materiais isotrópicos com todos os valores que o solver estático exige, em ordem alfabética. */
export function simulationPresets(library:MaterialDefinition[]){
  return library.flatMap(m=>{
    try{return [toSimulationMaterial(m)];}catch{return [];}
  }).sort(byName);
}
