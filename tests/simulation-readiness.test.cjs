const {test}=require('node:test');const assert=require('node:assert/strict');
const {analysisRequirements}=require('../src/lib/simulation/readiness.ts');
const {emptyStudy}=require('../src/lib/simulation/types.ts');
const configured=()=>({...emptyStudy(),step:'ISO-10303-21;',mesh:{},supports:[{id:'s',faceIds:[1],axes:[true,true,true]}],loads:[{id:'l',kind:'force',faceIds:[2],vector:[10,0,0],pressure:0}]});
test('saved mesh with supports and loads explains why solving is unavailable',()=>{
 const missing=analysisRequirements(configured(),null);
 assert.deepEqual(missing.map(r=>r.id),['mesh-session']);
 assert.equal(missing[0].tab,'Malha');assert.match(missing[0].message,/gerada novamente/);
 assert.deepEqual(analysisRequirements(configured(),'active-job'),[]);
});
test('missing setup steps direct the user to the corresponding panel',()=>{
 assert.deepEqual(analysisRequirements(emptyStudy(),null).map(r=>r.id),['geometry','mesh','supports','loads']);
 const study=configured();study.supports=[];study.loads=[];
 const missing=analysisRequirements(study,'active-job');
 assert.deepEqual(missing.map(r=>r.tab),['Fixações','Cargas']);
 assert.match(missing[0].message,/Adicionar fixação/);assert.match(missing[1].message,/Adicionar carga/);
});
