/**
 * Reads Autodesk material libraries (.adsklib) directly, without Inventor.
 *
 * An .adsklib is a ZIP package. Asset values live in AssetData/InstanceProperties.bin and
 * names/categories in AssetData/DefinitionIteratorProperties.bin. Both are chains of
 * 136-byte blocks (8-byte header: next block index or -1, used length, record-start flag).
 * A record holds its schema name, asset name, library GUID, a list of dependency paths ended
 * by an empty string and then one value per schema property, sorted by property id (ordinal),
 * across the schema inheritance chain below CommonSchema. The Schemas/*.xml files give the
 * property types and units. Layout validated against InventorMaterialLibrary.adsklib
 * (AssetLibVersion 1.0, InstanceProperties 3.2).
 */
import {unzipSync} from 'fflate';
import {blankPhysical,DEFAULT_APPEARANCE,validateMaterial,type Appearance,type MaterialDefinition,type PhysicalKey} from './library';

type Prop={id:string;type:string;unit:string|null;connectable:boolean};
type Schema={base:string|null;props:Prop[]};
type Value=number|string|number[]|null;
type Asset={schema:string;name:string;library:string;values:Map<string,Value>;untrusted:Set<string>;complete:boolean};

const BLOCK=136;
const decoder=new TextDecoder('utf-8');

/** Units as declared by the schemas, with the code stored beside each float and the factor to Eksteel units. */
const UNITS:Record<string,{code:number;factor:number}>={
  Unitless:{code:0x0010,factor:1},
  KilogramPerCubicMeter:{code:0x0110,factor:1},
  Kilopascal:{code:0x0210,factor:1e-3},
  WattPerMeterKelvin:{code:0x0450,factor:1},
  MicrometerPerMeterCelsius:{code:0x0430,factor:1e-6},
  JoulePerGramCelsius:{code:0x0460,factor:1000},
};
const STRUCTURAL:[PhysicalKey,string][]=[
  ['density','structural_Density'],['young','structural_Young_modulus'],['poisson','structural_Poisson_ratio'],
  ['shear','structural_Shear_modulus'],['yieldStress','structural_Minimum_yield_stress'],['tensileStrength','structural_Minimum_tensile_strength'],
  ['conductivity','structural_Thermal_conductivity'],['expansion','structural_Thermal_expansion_coefficient'],['specificHeat','structural_Specific_heat'],
];
const THERMAL:[PhysicalKey,string][]=[['density','thermal_Density'],['conductivity','thermal_Thermal_conductivity'],['specificHeat','thermal_Specific_heat']];

class Reader{
  private view:DataView;offset=0;
  constructor(private bytes:Uint8Array){this.view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);}
  private need(n:number){if(this.offset+n>this.bytes.length)throw new Error('Registro truncado.');}
  u8(){this.need(1);return this.bytes[this.offset++];}
  u16At(at:number){return this.view.getUint16(at,true);}
  i32(){this.need(4);const v=this.view.getInt32(this.offset,true);this.offset+=4;return v;}
  f64(){this.need(8);const v=this.view.getFloat64(this.offset,true);this.offset+=8;return v;}
  str(){const n=this.i32();if(n<0||n>100_000)throw new Error('Texto inválido.');this.need(n);const s=decoder.decode(this.bytes.subarray(this.offset,this.offset+n));this.offset+=n;return s;}
  skip(n:number){this.need(n);this.offset+=n;}
}

export function readRecords(bin:Uint8Array):Uint8Array[]{
  if(bin.length<16||(bin.length-16)%BLOCK)throw new Error('Arquivo de ativos .adsklib com tamanho inesperado.');
  const view=new DataView(bin.buffer,bin.byteOffset,bin.byteLength);
  const count=(bin.length-16)/BLOCK;
  const records:Uint8Array[]=[];
  for(let k=0;k<count;k++){
    if(view.getUint16(16+k*BLOCK+6,true)!==1)continue;
    const parts:Uint8Array[]=[];let size=0;const seen=new Set<number>();
    for(let j=k;;){
      if(j<0||j>=count||seen.has(j))throw new Error('Cadeia de blocos inválida no .adsklib.');
      seen.add(j);
      const o=16+j*BLOCK,next=view.getInt32(o,true),len=view.getUint16(o+4,true);
      if(len>BLOCK-8)throw new Error('Bloco inválido no .adsklib.');
      parts.push(bin.subarray(o+8,o+8+len));size+=len;
      if(next<0)break;
      j=next;
    }
    const out=new Uint8Array(size);let at=0;for(const p of parts){out.set(p,at);at+=p.length;}
    records.push(out);
  }
  return records;
}

export function parseSchemaXml(xml:string):[string,Schema]{
  const uid=/<UID val="(\w+)"/.exec(xml)?.[1];
  if(!uid)throw new Error('Schema sem UID.');
  const props:Prop[]=[];
  for(const m of xml.matchAll(/<(\w+)\s+id="(\w+)"([^>]*)>/g)){
    const [,type,id,attrs]=m;
    if(type==='ChoiceValue'||type==='ui'||type==='URL'||id==='SchemaVersion')continue;
    if(attrs.includes('readonly="true"')&&attrs.includes('public="false"'))continue;
    props.push({id,type,unit:/unit="(\w+)"/.exec(attrs)?.[1]??null,connectable:attrs.includes('allowconnectedassets')});
  }
  return [uid,{base:/<Base val="(\w+)"/.exec(xml)?.[1]??null,props}];
}

function inherits(schemas:Map<string,Schema>,name:string,ancestor:string){
  for(let s:string|null=name,guard=0;s&&guard<20;s=schemas.get(s)?.base??null,guard++)if(s===ancestor)return true;
  return false;
}
function serializedProps(schemas:Map<string,Schema>,name:string):Prop[]{
  const byId=new Map<string,Prop>();
  for(let s:string|null=name,guard=0;s&&s!=='CommonSchema'&&guard<20;guard++){
    const schema=schemas.get(s);
    if(!schema)throw new Error(`Schema ${s} ausente no .adsklib.`);
    for(const p of schema.props)if(!byId.has(p.id))byId.set(p.id,p);
    s=schema.base;
  }
  // Appearance assets do not serialize the sharing choice inherited from RenderMaterialSchema.
  if(inherits(schemas,name,'RenderMaterialSchema'))byId.delete('common_Shared_Asset');
  return [...byId.values()].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
}

export function parseInstance(record:Uint8Array,schemas:Map<string,Schema>):Asset{
  const r=new Reader(record);
  const schema=r.str(),name=r.str(),library=r.str();
  r.skip(4);
  while(r.str()!=='');
  const values=new Map<string,Value>(),untrusted=new Set<string>();
  let trusted=true,complete=true;
  if(!schemas.has(schema))return {schema,name,library,values,untrusted,complete:false};
  try{
    for(const p of serializedProps(schemas,schema)){
      let v:Value;
      switch(p.type){
        case 'Choice':case 'Integer':v=r.i32();break;
        case 'Boolean':v=r.u8();break;
        case 'String':v=r.str();break;
        case 'Color':v=[r.f64(),r.f64(),r.f64(),r.f64()];break;
        case 'Reference':r.skip(4);v=null;break;
        case 'Float':{
          if(p.unit){
            const code=r.u16At(r.offset+1);r.skip(4);
            const unit=UNITS[p.unit];
            v=r.f64();
            // A value stored in a unit other than the schema's is not converted blindly.
            if(!unit||unit.code!==code){untrusted.add(p.id);v=null;}
          }else v=r.f64();
          break;
        }
        default:throw new Error(`Tipo ${p.type} não suportado.`);
      }
      if(p.connectable&&r.u8()!==0)trusted=false;
      if(!trusted)untrusted.add(p.id);
      values.set(p.id,v);
    }
  }catch{complete=false;}
  return {schema,name,library,values,untrusted,complete};
}

type Definition={categories:string[];description:string};
export function parseDefinition(record:Uint8Array):[string,Definition]{
  const r=new Reader(record);
  r.str();r.skip(1);
  const id=r.str();r.str();
  const n=r.i32();
  if(n<0||n>100)throw new Error('Definição inválida.');
  const categories=Array.from({length:n},()=>r.str());
  return [id,{categories,description:r.str()}];
}

function number(asset:Asset|undefined,id:string){
  if(!asset||asset.untrusted.has(id))return null;
  const v=asset.values.get(id);
  return typeof v==='number'&&Number.isFinite(v)?v:null;
}
function convert(asset:Asset|undefined,id:string,schemas:Map<string,Schema>){
  const v=number(asset,id);
  if(v===null||!asset)return null;
  const prop=serializedProps(schemas,asset.schema).find(p=>p.id===id);
  const factor=prop?.unit?UNITS[prop.unit]?.factor:1;
  // Round away binary noise from the unit conversion (e.g. 6.890000000000001 MPa).
  return factor===undefined?null:Number((v*factor).toPrecision(12));
}

const hex=(c:number)=>Math.round(Math.min(1,Math.max(0,c))*255).toString(16).padStart(2,'0');
const clamp=(n:number,lo:number,hi:number)=>Math.min(hi,Math.max(lo,n));
const round3=(n:number)=>Math.round(n*1000)/1000;
const METAL_COLORS:[RegExp,string][]=[
  [/gold/i,'#d4af37'],[/copper|cobre/i,'#b87333'],[/brass|lat[aã]o/i,'#c9a44c'],[/bronze/i,'#a97142'],
  [/silver|prata/i,'#d6d6d6'],[/titan/i,'#8f8f94'],[/galvan/i,'#a9adb0'],[/stainless|inox/i,'#b8bcc0'],
  [/alumin/i,'#c8ccd0'],[/lead|chumbo/i,'#6f7478'],[/monel|nickel/i,'#a8a497'],
];
const CATEGORY_LOOKS:[RegExp,Appearance][]=[
  [/plastic/i,{color:'#d8d8d8',metalness:0,roughness:.45,opacity:1}],
  [/wood/i,{color:'#a8743f',metalness:0,roughness:.7,opacity:1}],
  [/glass/i,{color:'#cfe8f0',metalness:0,roughness:.05,opacity:.35}],
  [/liquid/i,{color:'#3b7dd8',metalness:0,roughness:.1,opacity:.5}],
  [/concrete/i,{color:'#a7a39b',metalness:0,roughness:.9,opacity:1}],
  [/ceramic/i,{color:'#d0cdc6',metalness:0,roughness:.5,opacity:1}],
  [/metal/i,{color:'#9aa0a6',metalness:.85,roughness:.35,opacity:1}],
];

function appearanceOf(look:Asset|undefined,name:string,category:string):{appearance:Appearance;exact:boolean}{
  if(look?.schema==='GenericSchema'){
    const c=look.values.get('generic_diffuse');
    if(Array.isArray(c)&&!look.untrusted.has('generic_diffuse')&&c.slice(0,3).every(v=>v>=0&&v<=1)){
      const gloss=number(look,'generic_glossiness'),transparency=number(look,'generic_transparency');
      return {exact:true,appearance:{
        color:`#${hex(c[0])}${hex(c[1])}${hex(c[2])}`,
        metalness:look.values.get('generic_is_metal')===1?.85:.05,
        roughness:gloss===null?DEFAULT_APPEARANCE.roughness:round3(clamp(1-gloss,.05,1)),
        opacity:transparency===null?1:round3(clamp(1-transparency,.15,1)),
      }};
    }
  }
  const base=CATEGORY_LOOKS.find(([re])=>re.test(category))?.[1]??DEFAULT_APPEARANCE;
  if(look?.schema==='MetalSchema'||/metal/i.test(category)){
    const finish=number(look,'metal_finish');
    const color=METAL_COLORS.find(([re])=>re.test(name))?.[1]??'#9aa0a6';
    return {exact:false,appearance:{color,metalness:.9,opacity:1,roughness:finish===null?.35:[.12,.25,.4,.5][finish]??.35}};
  }
  return {exact:false,appearance:{...base}};
}

/** Aspect instances are named "<material>_physmat_aspects_N:<asset>"; definitions use the asset id. */
const assetId=(a:Asset)=>a.name.slice(a.name.lastIndexOf(':')+1);
const GENERIC_TEXT=/^(physical material\.?|generic|(metal|plastic|wood|generic|concrete) structural asset\.?)$/i;

export type AdsklibFiles=Record<string,Uint8Array>;

export function unzipAdsklib(bytes:Uint8Array):AdsklibFiles{
  try{return unzipSync(bytes,{filter:f=>/(Schemas\/[^/]+\.xml|AssetData\/(InstanceProperties|DefinitionIteratorProperties)\.bin)$/.test(f.name)});}
  catch{throw new Error('Arquivo .adsklib inválido: não é um pacote ZIP da Autodesk.');}
}

/** Converts the files of an .adsklib package into Eksteel material definitions. */
export function parseAdsklib(files:AdsklibFiles,fileName='biblioteca.adsklib'):MaterialDefinition[]{
  const entries=Object.entries(files);
  const find=(suffix:string)=>entries.find(([k])=>k.replace(/\\/g,'/').endsWith(suffix))?.[1];
  const instances=find('AssetData/InstanceProperties.bin'),definitions=find('AssetData/DefinitionIteratorProperties.bin');
  if(!instances||!definitions)throw new Error('O .adsklib não contém AssetData/InstanceProperties.bin e DefinitionIteratorProperties.bin.');
  const schemas=new Map<string,Schema>();
  for(const [k,v] of entries)if(/Schemas\/[^/]+Schema\.xml$/.test(k.replace(/\\/g,'/')))schemas.set(...parseSchemaXml(decoder.decode(v)));
  if(!schemas.has('PhysMatSchema'))throw new Error('O .adsklib não contém os schemas de materiais físicos.');

  const defs=new Map<string,Definition>();
  for(const rec of readRecords(definitions)){try{const [id,d]=parseDefinition(rec);defs.set(id,d);}catch{/* non-material record layout */}}
  const assets=readRecords(instances).map(rec=>{try{return parseInstance(rec,schemas);}catch{return null;}}).filter((a):a is Asset=>a!==null);
  const aspects=new Map<string,Asset[]>();
  for(const a of assets){
    const at=a.name.indexOf('_physmat_aspects');
    if(at<=0)continue;
    const owner=a.name.slice(0,at);
    aspects.set(owner,[...(aspects.get(owner)??[]),a]);
  }

  const drafts=assets.filter(a=>a.schema==='PhysMatSchema').flatMap(mat=>{
    const linked=aspects.get(mat.name)??[];
    const structural=linked.find(a=>inherits(schemas,a.schema,'StructuralCommonSchema'));
    const thermal=linked.find(a=>inherits(schemas,a.schema,'ThermalCommonSchema'));
    const look=linked.find(a=>inherits(schemas,a.schema,'RenderMaterialSchema'));
    if(!structural&&!thermal)return [];
    const def=defs.get(mat.name);
    const category=def?.categories.find(c=>c!=='physical material')??'Autodesk';
    const structuralText=structural?defs.get(assetId(structural))?.description??'':'';
    const description=def?.description??'';
    const name=!GENERIC_TEXT.test(description)&&description?description:!GENERIC_TEXT.test(structuralText)&&structuralText?structuralText:`${category} ${mat.name}`;
    const physical=blankPhysical();
    const warnings:string[]=[];
    for(const [key,id] of STRUCTURAL)if(structural)physical[key]=convert(structural,id,schemas);
    for(const [key,id] of THERMAL)if(physical[key]===null)physical[key]=convert(thermal,id,schemas);
    if(structural&&!structural.complete)warnings.push('Ativo estrutural lido parcialmente; confira os valores no Inventor.');
    const behaviorCode=structural?.values.get('structural_Behavior');
    const behavior:MaterialDefinition['behavior']=behaviorCode===0?'isotropic':behaviorCode===1?'orthotropic':'unknown';
    if(behaviorCode===1)warnings.push('Material ortotrópico: somente os valores principais foram importados; os direcionais ficaram no Inventor.');
    if(behaviorCode===2)warnings.push('Material transversalmente isotrópico no Inventor; comportamento marcado como não confirmado.');
    const {appearance,exact}=appearanceOf(look,`${name} ${structuralText}`,category);
    return [{
      id:`adsk:${mat.library}:${mat.name}`,name,category,behavior,appearance,
      source:`Autodesk ${fileName} · ${mat.name}${structural?` · ${assetId(structural)}`:''}`,
      notes:[
        structuralText&&structuralText!==name?`Ativo estrutural: ${structuralText}.`:'',
        'Valores do ativo físico (estrutural) da biblioteca; propriedades térmicas completadas pelo ativo térmico quando ausentes.',
        exact?'Aparência genérica convertida (sem texturas).':'Aparência aproximada pela categoria; ajuste se necessário.',
        ...warnings,
      ].filter(Boolean).join(' '),
      physical,
    } satisfies MaterialDefinition];
  });
  // Several Inventor materials share a description; keep names distinguishable in the picker.
  const counts=new Map<string,number>();
  for(const d of drafts)counts.set(d.name,(counts.get(d.name)??0)+1);
  const materials=drafts.map(d=>validateMaterial(counts.get(d.name)!>1?{...d,name:`${d.name} (${d.id.split(':').pop()})`}:d));
  if(!materials.length)throw new Error('Nenhum material físico encontrado no .adsklib.');
  return materials;
}
