const {test}=require('node:test');const assert=require('node:assert/strict');
const {zipSync,strToU8}=require('fflate');
const {parseAdsklib,unzipAdsklib,readRecords}=require('../src/lib/materials/adsklib.ts');
const {toSimulationMaterial}=require('../src/lib/materials/library.ts');

// Synthetic package following the .adsklib layout; values are test fixtures, not Autodesk data.
const schema=(uid,base,props)=>`<?xml version="1.0"?><AssetSchema><UID val="${uid}"/>${base?`<Base val="${base}"/>`:''}<Integer id="SchemaVersion" public="false" readonly="true" val="1"/><String id="localname" public="false" readonly="true" val="x"/>${props}</AssetSchema>`;
const SCHEMAS={
  CommonSchema:schema('CommonSchema',null,'<String id="description" val=""/>'),
  PhysMatSchema:schema('PhysMatSchema','CommonSchema','<String id="physmat_class" val=""/>'),
  StructuralCommonSchema:schema('StructuralCommonSchema','CommonSchema','<Choice id="common_Shared_Asset" val="common_shared"><ChoiceValue id="common_shared" val="0"/></Choice><Float id="structural_Density" unit="KilogramPerCubicMeter" val="1"/><Float id="structural_Specific_heat" unit="JoulePerGramCelsius" val="1"/><Float id="structural_Thermal_conductivity" unit="WattPerMeterKelvin" val="1"/>'),
  StructuralAdvancedSchema:schema('StructuralAdvancedSchema','StructuralCommonSchema','<Choice id="structural_Behavior" val="structural_isotropic"/><Float id="structural_Minimum_yield_stress" unit="Kilopascal" val="1"/><Float id="structural_Poisson_ratio" unit="Unitless" val="0"/><Float id="structural_Thermal_expansion_coefficient" unit="MicrometerPerMeterCelsius" val="1"/><Float id="structural_Young_modulus" unit="Kilopascal" val="1"/><String id="structural_source" val=""/>'),
  StructuralMetalSchema:schema('StructuralMetalSchema','StructuralAdvancedSchema','<Boolean id="structural_Thermally_treated" val="false"/>'),
  RenderMaterialSchema:schema('RenderMaterialSchema','CommonSchema','<Choice id="common_Shared_Asset" val="common_shared"/><Color id="common_Tint_color" valR="1" valG="1" valB="1" valA="1"/><String id="swatch" public="false" val=""/>'),
  GenericSchema:schema('GenericSchema','RenderMaterialSchema','<Color id="generic_diffuse" allowconnectedassets="single" valR="0" valG="0" valB="0" valA="1"/><Float id="generic_glossiness" allowconnectedassets="single" val="0.5"/><Boolean id="generic_is_metal" val="false"/><Float id="generic_transparency" allowconnectedassets="single" val="0"/>'),
};
const UNIT={Unitless:0x0010,KilogramPerCubicMeter:0x0110,Kilopascal:0x0210,WattPerMeterKelvin:0x0450,MicrometerPerMeterCelsius:0x0430,JoulePerGramCelsius:0x0460};
class Writer{
  constructor(){this.parts=[];}
  bytes(b){this.parts.push(Uint8Array.from(b));return this;}
  u32(n){const b=new Uint8Array(4);new DataView(b.buffer).setInt32(0,n,true);return this.bytes(b);}
  f64(n){const b=new Uint8Array(8);new DataView(b.buffer).setFloat64(0,n,true);return this.bytes(b);}
  str(s){const b=strToU8(s);return this.u32(b.length).bytes(b);}
  float(unit,n){if(unit)this.bytes([1,UNIT[unit]&255,UNIT[unit]>>8,0]);return this.f64(n);}
  done(){const size=this.parts.reduce((n,p)=>n+p.length,0),out=new Uint8Array(size);let at=0;for(const p of this.parts){out.set(p,at);at+=p.length;}return out;}
}
const LIB='00000000-TEST-LIB';
const instance=(schemaName,name,write,deps=[])=>{const w=new Writer().str(schemaName).str(name).str(LIB).u32(0);deps.forEach(d=>w.str(d));w.str('');write(w);return w.done();};
const definition=(schemaName,id,categories,description)=>{const w=new Writer().str(schemaName).bytes([0]).str(id).str(id).u32(categories.length);categories.forEach(c=>w.str(c));return w.str(description).done();};
// Stored in reverse block order to exercise the chain links rather than file order.
function blocks(records){
  const chunks=records.map(r=>{const c=[];for(let i=0;i<r.length;i+=128)c.push(r.subarray(i,i+128));return c.length?c:[new Uint8Array(0)];});
  const total=chunks.reduce((n,c)=>n+c.length,0),out=new Uint8Array(16+total*136),view=new DataView(out.buffer);
  view.setUint32(0,0x88,true);view.setInt32(4,-1,true);view.setInt32(8,-1,true);
  let slot=total;
  for(const c of chunks){
    const slots=c.map(()=>--slot);
    c.forEach((part,k)=>{const o=16+slots[k]*136;view.setInt32(o,k+1<c.length?slots[k+1]:-1,true);view.setUint16(o+4,part.length,true);view.setUint16(o+6,k===0?1:0,true);out.set(part,o+8);});
  }
  return out;
}
const steel=(name,{youngUnit='Kilopascal',behavior=0}={})=>instance('StructuralMetalSchema',name,w=>w
  .u32(0).u32(behavior).float('KilogramPerCubicMeter',7850).float('Kilopascal',250000).float('Unitless',.3)
  .float('JoulePerGramCelsius',.48).float('WattPerMeterKelvin',45).float('MicrometerPerMeterCelsius',12)
  .bytes([0]).float(youngUnit,210000000).str('Test fixture'));
const look=(name,connected=0)=>instance('GenericSchema',name,w=>w
  .f64(1).f64(1).f64(1).f64(1).f64(.2).f64(.4).f64(.6).f64(1).bytes([connected]).f64(.7).bytes([0]).bytes([1]).f64(.25).bytes([0]).str('Swatch-Sphere'),['Mats/texture.png']);
function pack(extra=[]){
  const records=[
    [definition('PhysMatSchema','Mat-1',['Metal','physical material'],'Test steel'),instance('PhysMatSchema','Mat-1',w=>w.str(''))],
    [definition('StructuralMetalSchema','Steel-1',['Metal'],'Test steel structural'),steel('Mat-1_physmat_aspects_1:Steel-1')],
    [definition('GenericSchema','Look-1',['Metal'],'Generic material.'),look('Mat-1_physmat_aspects:Look-1')],
    ...extra,
  ];
  const files={'LIB/AssetData/DefinitionIteratorProperties.bin':blocks(records.map(r=>r[0])),'LIB/AssetData/InstanceProperties.bin':blocks(records.map(r=>r[1]))};
  for(const [k,v] of Object.entries(SCHEMAS))files[`LIB/Schemas/${k}.xml`]=strToU8(v);
  return zipSync(files);
}

test('adsklib import converts Inventor units, links physical and appearance aspects',()=>{
  const [m]=parseAdsklib(unzipAdsklib(pack()),'Test.adsklib');
  assert.equal(m.id,`adsk:${LIB}:Mat-1`);assert.equal(m.name,'Test steel');assert.equal(m.category,'Metal');assert.equal(m.behavior,'isotropic');
  assert.deepEqual(m.physical,{density:7850,young:210000,poisson:.3,shear:null,yieldStress:250,tensileStrength:null,conductivity:45,expansion:12e-6,specificHeat:480});
  assert.deepEqual(m.appearance,{color:'#336699',metalness:.85,roughness:.3,opacity:.75});
  assert.match(m.source,/Test\.adsklib · Mat-1 · Steel-1/);
  assert.deepEqual(toSimulationMaterial(m),{name:'Test steel',young:210000,poisson:.3,yieldStress:250,density:7850});
});

test('adsklib import leaves unexpected units empty and flags orthotropic or textured assets',()=>{
  const extra=[
    [definition('PhysMatSchema','Mat-2',['Wood','physical material'],'Physical material.'),instance('PhysMatSchema','Mat-2',w=>w.str(''))],
    [definition('StructuralMetalSchema','Steel-2',['Wood'],'Wood structural asset.'),steel('Mat-2_physmat_aspects_1:Steel-2',{youngUnit:'WattPerMeterKelvin',behavior:1})],
    [definition('GenericSchema','Look-2',['Wood'],'Generic material.'),look('Mat-2_physmat_aspects:Look-2',1)],
  ];
  const m=parseAdsklib(unzipAdsklib(pack(extra))).find(v=>v.id.endsWith('Mat-2'));
  assert.equal(m.physical.young,null);assert.equal(m.physical.density,7850);
  assert.equal(m.behavior,'orthotropic');assert.match(m.notes,/ortotrópico/);
  assert.equal(m.name,'Wood Mat-2');
  assert.equal(m.appearance.color,'#a8743f');
  assert.throws(()=>toSimulationMaterial(m),/isotrópico/);
});

test('adsklib import names duplicates distinctly and rejects invalid packages',()=>{
  const extra=[
    [definition('PhysMatSchema','Mat-3',['Metal','physical material'],'Test steel'),instance('PhysMatSchema','Mat-3',w=>w.str(''))],
    [definition('StructuralMetalSchema','Steel-3',['Metal'],'Test steel structural'),steel('Mat-3_physmat_aspects_1:Steel-3')],
  ];
  assert.deepEqual(parseAdsklib(unzipAdsklib(pack(extra))).map(m=>m.name).sort(),['Test steel (Mat-1)','Test steel (Mat-3)']);
  assert.throws(()=>unzipAdsklib(strToU8('not a zip')),/ZIP/);
  assert.throws(()=>parseAdsklib({}),/InstanceProperties/);
  assert.throws(()=>readRecords(new Uint8Array(20)),/tamanho/);
});

const {blankPhysical,DEFAULT_APPEARANCE}=require('../src/lib/materials/library.ts');
const fixture=(id,name,extra={})=>({id,name,category:'Metal',source:'Fixture de teste, não é dado Autodesk',notes:'',behavior:'isotropic',
  physical:{...blankPhysical(),density:7850,young:210000,poisson:.3,yieldStress:207},appearance:{...DEFAULT_APPEARANCE},...extra});

test('built-in library merges with user materials and only user changes are stored locally',()=>{
  const {withDefaultMaterials,userMaterials}=require('../src/lib/materials/defaults.ts');
  const builtIn=[fixture('lib:1','Aço'),fixture('lib:2','Latão')];
  const edited={...builtIn[0],name:'Aço da obra',modified:true},own=fixture('user:1','Meu aço');
  const merged=withDefaultMaterials(builtIn,[edited,own]);
  assert.deepEqual(merged.map(m=>m.name),['Aço da obra','Latão','Meu aço']);
  assert.deepEqual(userMaterials(merged,builtIn),[edited,own]);
  assert.deepEqual(userMaterials(builtIn,builtIn),[]);
});

test('simulation presets are alphabetical and new studies default to Inventor steel without the database',()=>{
  const {simulationPresets}=require('../src/lib/materials/defaults.ts');
  const {emptyStudy}=require('../src/lib/simulation/types.ts');
  const presets=simulationPresets([fixture('b','Zinco'),fixture('a','Ácido'),fixture('c','Borracha',{physical:{...blankPhysical(),density:900,young:3,poisson:.5,yieldStress:10}}),fixture('d','Madeira',{behavior:'orthotropic'})]);
  assert.deepEqual(presets.map(m=>m.name),['Ácido','Zinco']);
  assert.deepEqual(emptyStudy().material,{name:'Aço',young:210000,poisson:.3,yieldStress:207,density:7850});
});

test('database rows become validated materials and SQL keeps data private to authenticated users',()=>{
  const {parseMaterialRows}=require('../src/lib/materials/builtInLibrary.ts');
  const {materialsSql}=require('../src/lib/materials/materialsSql.ts');
  assert.deepEqual(parseMaterialRows([{definition:fixture('a','Aço')},{definition:{id:'x'}},null]).map(m=>m.id),['a']);
  assert.throws(()=>parseMaterialRows({}),/inesperada/);
  const sql=materialsSql([fixture("o'1","Aço d'água")],'Teste.adsklib','Teste.adsklib');
  assert.match(sql,/grant select on public\.eksteel_materials to authenticated;/);
  assert.match(sql,/revoke all on public\.eksteel_materials from anon, authenticated;/);
  assert.match(sql,/'Aço d''água'/);assert.match(sql,/\('o''1', /);
  assert.throws(()=>materialsSql([],'Teste','Teste'),/Nenhum/);
  assert.throws(()=>materialsSql([fixture('a','A')],"x'; drop table y;--",'x'),/inválido/);
});
