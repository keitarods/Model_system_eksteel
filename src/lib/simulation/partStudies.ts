import type {Study} from './types';
import {parseStudy,serializeStudy} from './format';
export type PartStudy={id:string;sourceFeatures:string;study:Study};
export type PartSimulations={id:string;studies:PartStudy[]};
export function parsePartSimulations(value:unknown):PartSimulations|undefined{
  if(value===undefined)return undefined;
  const data=value as PartSimulations;
  if(!data||typeof data.id!=='string'||!data.id||data.id.length>100||!Array.isArray(data.studies)||data.studies.length>20)throw new Error('Simulações incorporadas inválidas.');
  const ids=new Set<string>();
  const studies=data.studies.map(entry=>{
    if(!entry||typeof entry.id!=='string'||!entry.id||entry.id.length>100||ids.has(entry.id)||typeof entry.sourceFeatures!=='string')throw new Error('Estudo incorporado inválido.');
    ids.add(entry.id);
    const study=parseStudy(serializeStudy(entry.study));
    return {...entry,study:{...study,sourcePart:{documentId:data.id,studyId:entry.id}}};
  });
  return {id:data.id,studies};
}
