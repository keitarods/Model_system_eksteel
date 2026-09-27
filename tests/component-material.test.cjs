const {test}=require('node:test');const assert=require('node:assert/strict');
const {withPartProperties,savePartProperties,sameSourceInstanceIds}=require('../src/lib/assembly/componentMaterial.ts');
const {serializeProject,parseProject}=require('../src/lib/project/nativeFormat.ts');
const {serializeAssembly,parseAssembly}=require('../src/lib/project/assemblyFormat.ts');
const {createEmptyPartProperties}=require('../src/lib/project/partProperties.ts');
const {blankPhysical,DEFAULT_APPEARANCE}=require('../src/lib/materials/library.ts');

const feature={id:'f1',type:'sketch',name:'Esboço',visible:true,plane:'XY',entities:[],constraints:[],dimensions:[]};
const sheet={id:'s1',name:'Folha 1'};
const part=serializeProject([feature],[sheet],createEmptyPartProperties());
const brass={id:'lib:brass',name:'Latão amarelo macio',category:'Metal',source:'Fixture de teste',notes:'',behavior:'isotropic',physical:{...blankPhysical(),density:8470,young:109600,poisson:.331,yieldStress:103.4},appearance:{...DEFAULT_APPEARANCE,color:'#c9a44c'}};
const withBrass={...createEmptyPartProperties(),material:brass.name,density:brass.physical.density,materialDefinition:brass};
const instance=(id,embeddedPart)=>({id,label:id,linkKey:`k-${id}`,sourceFileName:'peca.eks3d',grounded:false,suppressed:false,visible:true,placementSeed:{position:[0,0,0],quaternion:[0,0,0,1]},...(embeddedPart?{embeddedPart}:{})});

test('component material is written to the part and keeps geometry and drawing sheets',()=>{
  const updated=parseProject(withPartProperties(part,withBrass));
  assert.deepEqual(updated.features,[feature]);assert.deepEqual(updated.drawingSheets,[sheet]);
  assert.deepEqual(updated.properties,withBrass);
});

test('embedded copies of the same part change together, other parts stay untouched',async()=>{
  const other=serializeProject([{...feature,id:'f2'}],[],createEmptyPartProperties());
  const list=[instance('a',part),instance('b',part),instance('c',other)];
  assert.deepEqual(await sameSourceInstanceIds(list,list[0]),['a','b']);
  const patches=await savePartProperties(list,list[1],withBrass);
  assert.deepEqual(Object.keys(patches),['a','b']);
  assert.equal(parseProject(patches.a.embeddedPart).properties.material,'Latão amarelo macio');
  assert.equal(patches.a.embeddedPart,patches.b.embeddedPart);
});

test('appearance override is saved per occurrence in the assembly and validated',()=>{
  const override={...DEFAULT_APPEARANCE,color:'#ff0000',name:'Vermelho'};
  const json=serializeAssembly([{...instance('a',part),appearanceOverride:override},instance('b',part)],[],[]);
  const back=parseAssembly(json);
  assert.deepEqual(back.instances[0].appearanceOverride,override);assert.equal(back.instances[1].appearanceOverride,undefined);
  const bad=JSON.parse(json);bad.instances[0].appearanceOverride.color='url(x)';
  assert.throws(()=>parseAssembly(JSON.stringify(bad)),/Aparência de componente/);
});
