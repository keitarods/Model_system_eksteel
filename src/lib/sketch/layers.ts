import type { SketchLayer, SketchShape, SketchPoint } from "./types";
import { shapePointIds } from "./modify";
export const DEFAULT_LAYERS: SketchLayer[] = [{id:"0",name:"Geometria",visible:true,locked:false}];
export function layerFor(shape:SketchShape,layers:SketchLayer[]):SketchLayer {
  return layers.find(l=>l.id===(shape.layerId??"0"))??DEFAULT_LAYERS[0];
}
export function layerGeometry(state:{shapes:SketchShape[];points:Record<string,SketchPoint>;layers:SketchLayer[]},editable=false){
  const shapes=state.shapes.filter(s=>{const l=layerFor(s,state.layers);return l.visible&&(!editable||!l.locked);});
  const visibleSet=new Set(shapes);
  const included=new Set(shapes.flatMap(shapePointIds));
  const excluded=new Set(state.shapes.filter(s=>!visibleSet.has(s)).flatMap(shapePointIds));
  const points=Object.fromEntries(Object.entries(state.points).filter(([id])=>id==="origin"||included.has(id)||!excluded.has(id)));
  return {shapes,points};
}
export function lockedLayerPoints(shapes:SketchShape[],layers:SketchLayer[]):Set<string>{
  return new Set(shapes.filter(s=>layerFor(s,layers).locked).flatMap(shapePointIds));
}

/** Conservative reference check for dimension annotations and constraints. */
export function referencesGeometry(value: unknown, ids: ReadonlySet<string>): boolean {
  if(typeof value==="string")return ids.has(value);
  return !!value && typeof value==="object" && Object.values(value).some(v=>referencesGeometry(v,ids));
}
