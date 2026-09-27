/** Canonical units are explicit; a missing property is null, never an invented zero. */
export const PHYSICAL_FIELDS = [
  ['density','Densidade','kg/m³'], ['young','Módulo de Young','MPa'],
  ['poisson','Coeficiente de Poisson',''], ['shear','Módulo de cisalhamento','MPa'],
  ['yieldStress','Limite de escoamento','MPa'], ['tensileStrength','Resistência à tração','MPa'],
  ['conductivity','Condutividade térmica','W/(m·K)'], ['expansion','Expansão linear','1/K'],
  ['specificHeat','Calor específico','J/(kg·K)'],
] as const;
export type PhysicalKey = typeof PHYSICAL_FIELDS[number][0];
export type Appearance = {color:string;metalness:number;roughness:number;opacity:number};
export type MaterialDefinition = {
  id:string;name:string;category:string;source:string;notes:string;modified?:boolean;
  behavior?:"isotropic"|"orthotropic"|"unknown";
  physical:Record<PhysicalKey,number|null>;
  appearance:Appearance;
};
export function blankPhysical():MaterialDefinition['physical'] {
  return Object.fromEntries(PHYSICAL_FIELDS.map(([key])=>[key,null])) as MaterialDefinition['physical'];
}
export const DEFAULT_APPEARANCE:Appearance={color:'#8b959e',metalness:.15,roughness:.55,opacity:1};
export function validateMaterial(raw:unknown):MaterialDefinition {
  if(!raw||typeof raw!=='object')throw new Error('Material inválido.');
  const m=raw as MaterialDefinition;
  for(const key of ['id','name','category','source','notes'] as const)if(typeof m[key]!=='string'||m[key].length>4000)throw new Error(`Material: ${key} inválido.`);
  if(!m.id.trim()||!m.name.trim()||!m.physical)throw new Error('Informe nome e propriedades do material.');
  const physical=blankPhysical();
  for(const [key,label] of PHYSICAL_FIELDS){
    const n=m.physical[key];
    if(n===null||n===undefined)continue;
    if(typeof n!=='number'||!Number.isFinite(n)||(key==='poisson'?(n<=-1||n>.5):key==='expansion'?Math.abs(n)>1:n<0))throw new Error(`${label}: valor inválido.`);
    physical[key]=n;
  }
  if(m.behavior!==undefined&&!["isotropic","orthotropic","unknown"].includes(m.behavior))throw new Error("Comportamento do material inválido.");
  const a=m.appearance;
  if(!a||!/^#[0-9a-f]{6}$/i.test(a.color)||![a.metalness,a.roughness,a.opacity].every(n=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=1))throw new Error('Aparência inválida.');
  return {id:m.id,name:m.name,category:m.category,source:m.source,notes:m.notes,behavior:m.behavior??"unknown",physical,appearance:{color:a.color,metalness:a.metalness,roughness:a.roughness,opacity:a.opacity},...(m.modified?{modified:true}:{})};
}
export function parseMaterialLibrary(json:string):MaterialDefinition[]{
  if(json.length>15_000_000)throw new Error('Biblioteca acima de 15 MB.');
  const data=JSON.parse(json.replace(/^\uFEFF/,''));
  if(data?.format!=='eksteel-materials'||data.version!==1||!Array.isArray(data.materials)||!data.materials.length||data.materials.length>10000)throw new Error('Importe uma biblioteca JSON exportada para Eksteel ou um arquivo .adsklib.');
  const materials=data.materials.map(validateMaterial);
  if(new Set(materials.map((m:MaterialDefinition)=>m.id)).size!==materials.length)throw new Error('A biblioteca possui identificadores duplicados.');
  return materials;
}
export function serializeMaterialLibrary(materials:MaterialDefinition[]){return JSON.stringify({format:'eksteel-materials',version:1,materials:materials.map(validateMaterial)},null,2);}
export function toSimulationMaterial(material:MaterialDefinition,density=material.physical.density){
  if(material.behavior!=="isotropic")throw new Error("Confirme o comportamento isotrópico do material nas propriedades da peça. Materiais ortotrópicos ainda não são suportados na Simulação.");
  const {young,poisson,yieldStress}=material.physical;
  if(young===null||young<=0||poisson===null||poisson<=-1||poisson>.49||yieldStress===null||yieldStress<=0||density===null||density<=0)throw new Error(`O material "${material.name}" precisa de densidade, E, Poisson e escoamento válidos para a Simulação.`);
  return {name:material.name,young,poisson,yieldStress,density};
}
