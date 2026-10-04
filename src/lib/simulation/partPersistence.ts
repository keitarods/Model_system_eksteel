import {useFeatureStore} from '@/lib/features/store';
import {useDrawingStore} from '@/lib/drawing/store';
import {usePartPropertiesStore} from '@/lib/features/propertiesStore';
import {usePartStudiesStore} from './partStudyStore';
import {parseProject,serializeProject} from '@/lib/project/nativeFormat';
import {loadDraft,scheduleDraftSave,flushDraftSave} from '@/lib/project/autosave';
import type {Study} from './types';
export async function restoreSimulationPart(){
  if(useFeatureStore.getState().features.length)return;
  const draft=await loadDraft('modelador');
  if(!draft||useFeatureStore.getState().features.length)return;
  const part=parseProject(draft);
  useFeatureStore.setState({features:part.features});
  useDrawingStore.getState().loadSheets(part.drawingSheets);
  usePartPropertiesStore.getState().load(part.properties);
  usePartStudiesStore.getState().load(part.simulations);
}
export function currentPartFile(){
  return serializeProject(useFeatureStore.getState().features,useDrawingStore.getState().sheets,usePartPropertiesStore.getState().properties,usePartStudiesStore.getState().document);
}
export function persistPartStudy(study:Study,flush=false){
  if(!usePartStudiesStore.getState().record(study))return false;
  const save=flush?flushDraftSave:scheduleDraftSave;
  save('modelador',currentPartFile());return true;
}
