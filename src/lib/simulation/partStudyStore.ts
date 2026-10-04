import {create} from 'zustand';
import type {Study} from './types';
import type {PartSimulations} from './partStudies';
export const usePartStudiesStore=create<{document:PartSimulations;load:(document?:PartSimulations)=>void;record:(study:Study,sourceFeatures?:string)=>boolean}>(set=>({
  document:{id:crypto.randomUUID(),studies:[]},
  load:document=>set({document:document??{id:crypto.randomUUID(),studies:[]}}),
  record:(study,sourceFeatures)=>{
    let saved=false;
    set(state=>{
      const link=study.sourcePart;if(!link||link.documentId!==state.document.id)return state;
      const old=state.document.studies.find(s=>s.id===link.studyId);
      if(!old&&sourceFeatures===undefined)return state;
      if(!old&&state.document.studies.length>=20)throw new Error('Limite de 20 estudos por peça.');
      const entry={id:link.studyId,sourceFeatures:old?.sourceFeatures??sourceFeatures!,study};saved=true;
      return {document:{...state.document,studies:old?state.document.studies.map(s=>s.id===entry.id?entry:s):[...state.document.studies,entry]}};
    });
    return saved;
  },
}));
