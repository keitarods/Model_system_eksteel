const {test}=require('node:test');const assert=require('node:assert/strict');
const {blankPhysical,DEFAULT_APPEARANCE,validateMaterial,parseMaterialLibrary,serializeMaterialLibrary,toSimulationMaterial}=require('../src/lib/materials/library.ts');
const {serializeProject,parseProject}=require('../src/lib/project/nativeFormat.ts');
const {createEmptyPartProperties}=require('../src/lib/project/partProperties.ts');
const sample=()=>({id:'test:steel',name:'Steel test fixture',category:'Test',source:'Synthetic unit test, not Autodesk data',notes:'',behavior:'isotropic',physical:{...blankPhysical(),density:7850,young:210000,poisson:.3,shear:80769,yieldStress:250,tensileStrength:400,conductivity:45,expansion:12e-6,specificHeat:470},appearance:{...DEFAULT_APPEARANCE,color:'#ccbbaa',metalness:.8,roughness:.2,opacity:.9}});
test('materials preserve physical, thermal and appearance properties in libraries and parts',()=>{
 const m=sample();assert.deepEqual(parseMaterialLibrary(serializeMaterialLibrary([m])),[m]);
 const props={...createEmptyPartProperties(),material:m.name,density:m.physical.density,materialDefinition:m};
 assert.deepEqual(parseProject(serializeProject([],[],props)).properties,props);
 assert.equal(parseProject(serializeProject([])).properties.materialDefinition,undefined);
 assert.deepEqual(toSimulationMaterial(m),{name:m.name,young:210000,poisson:.3,yieldStress:250,density:7850});
});
test('missing properties remain unknown and incompatible materials cannot enter the isotropic solver',()=>{
 const m=sample();m.physical.young=null;
 assert.equal(parseMaterialLibrary(serializeMaterialLibrary([m]))[0].physical.young,null);
 assert.throws(()=>toSimulationMaterial(m),/precisa/);
 assert.throws(()=>toSimulationMaterial({...sample(),behavior:'orthotropic'}),/isotrópico/);
 assert.throws(()=>toSimulationMaterial({...sample(),behavior:'unknown'}),/isotrópico/);
 const rubber=sample();rubber.physical.poisson=.5;validateMaterial(rubber);assert.throws(()=>toSimulationMaterial(rubber),/precisa/);
});
test('library rejects invalid values, duplicate IDs, unsafe colors and unsupported formats',()=>{
 for(const n of [-1,Infinity,NaN]){const m=sample();m.physical.density=n;assert.throws(()=>validateMaterial(m),/Densidade/);}
 assert.throws(()=>parseMaterialLibrary(serializeMaterialLibrary([sample(),sample()])),/duplicados/);
 const m=sample();m.appearance.color='url(https://example.com)';assert.throws(()=>validateMaterial(m),/Aparência/);
 assert.throws(()=>parseMaterialLibrary('{"format":"adsklib","materials":[]}'),/exportada/);
 assert.deepEqual(parseMaterialLibrary('\ufeff'+serializeMaterialLibrary([sample()])),[sample()]);
});
