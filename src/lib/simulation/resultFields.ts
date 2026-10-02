import type {Study} from './types';
export const resultFields={
  stress:'Tensão equivalente · von Mises (MPa)',
  stressX:'Tensão normal σxx (MPa)',stressY:'Tensão normal σyy (MPa)',stressZ:'Tensão normal σzz (MPa)',
  shearXY:'Cisalhamento τxy (MPa)',shearYZ:'Cisalhamento τyz (MPa)',shearXZ:'Cisalhamento τxz (MPa)',
  displacement:'Deslocamento total (mm)',displacementX:'Deslocamento X (mm)',displacementY:'Deslocamento Y (mm)',displacementZ:'Deslocamento Z (mm)',
  safety:'Fator de segurança · escoamento / von Mises',strainX:'Deformação εxx (mm/mm)',
} as const;
export type ResultField=keyof typeof resultFields;
export const SAFETY_DISPLAY_LIMIT=10;
export function resultValues(study:Study,field:ResultField):{values:number[];nodal:boolean}{
  const r=study.results;if(!r)return {values:[],nodal:false};
  if(field==='displacement')return {values:r.displacementMagnitude,nodal:true};
  if(field==='displacementX'||field==='displacementY'||field==='displacementZ'){
    const axis={displacementX:0,displacementY:1,displacementZ:2}[field];
    return {values:r.displacements.map(v=>v[axis]),nodal:true};
  }
  if(field==='stress')return {values:r.elementVonMises,nodal:false};
  if(field==='strainX')return {values:r.elementStrain.map(v=>v[0]),nodal:false};
  if(field==='safety'){
    const yieldStress=r.elementVonMises.map(()=>study.material.yieldStress);
    for(const region of study.mesh?.regions??[]){
      const material=study.regionMaterials?.[String(region.id)]??study.material;
      for(const index of region.elements)yieldStress[index]=material.yieldStress;
    }
    return {values:r.elementVonMises.map((v,i)=>v>1e-12?Math.min(SAFETY_DISPLAY_LIMIT,yieldStress[i]/v):SAFETY_DISPLAY_LIMIT),nodal:false};
  }
  const component={stressX:0,stressY:1,stressZ:2,shearXY:3,shearYZ:4,shearXZ:5}[field];
  return {values:r.elementStress.map(v=>v[component]),nodal:false};
}
export function fieldRange(study:Study,field:ResultField):[number,number]{
  const {values}=resultValues(study,field);if(!values.length)return [0,0];
  if(field==='safety')return [0,SAFETY_DISPLAY_LIMIT];
  let min=Infinity,max=-Infinity;for(const v of values){min=Math.min(min,v);max=Math.max(max,v);}return [min,max];
}
/** Low safety is red; signed fields retain their sign in the legend. */
export function fieldHue(value:number,min:number,max:number,field:ResultField){
  if(field==='safety')return value<1?0:Math.min(1,(value-1)/9)*0.33;
  return (1-(max===min?0:Math.max(0,Math.min(1,(value-min)/(max-min)))))*0.66;
}

export type ColorRange={min:number;max:number};
export function validColorRange(range:ColorRange|null|undefined):range is ColorRange{
  return !!range&&Number.isFinite(range.min)&&Number.isFinite(range.max)&&range.min<range.max;
}
export function displayRange(study:Study,field:ResultField,range?:ColorRange|null):[number,number]{
  return field!=='safety'&&validColorRange(range)?[range.min,range.max]:fieldRange(study,field);
}
/** Surface markers identify the displayed element/node, not an interpolated stress peak. */
export function surfaceExtrema(study:Study,field:ResultField,scale:number,visibleBody?:number|null){
  if(!study.mesh||!study.results)return [];
  const mesh=study.mesh,data=resultValues(study,field);
  type Sample={value:number;position:[number,number,number];index:number;nodal:boolean};
  let min:Sample|undefined,max:Sample|undefined;
  const point=(nodes:number[])=>[0,1,2].map(axis=>nodes.reduce((sum,n)=>sum+mesh.nodes[n][axis]+study.results!.displacements[n][axis]*scale,0)/nodes.length) as [number,number,number];
  for(const face of mesh.faces){
    if(visibleBody&&face.bodyId!==visibleBody)continue;
    face.triangles.forEach((tri,i)=>{
      for(const index of data.nodal?tri:[face.elements[i]]){
        const value=data.values[index];
        if(!Number.isFinite(value))continue;
        if(!min||value<min.value){min={value,position:point(data.nodal?[index]:tri),index,nodal:data.nodal};}
        if(!max||value>max.value){max={value,position:point(data.nodal?[index]:tri),index,nodal:data.nodal};}
      }
    });
  }
  if(!min||!max)return [];
  return min.value===max.value?[{...max,label:'Mín/Máx'}]:[{...min,label:'Mín'},{...max,label:'Máx'}];
}
