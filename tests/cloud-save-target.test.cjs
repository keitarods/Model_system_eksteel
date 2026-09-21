const {test}=require('node:test');const assert=require('node:assert/strict');
const {currentSaveTarget,selectSaveTarget}=require('../src/lib/project/cloudSaveTarget.ts');
test('selecting an existing project enables a destination without opening or writing its content',async()=>{
 let reads=0;
 const provider={current:async(folder,project)=>{reads++;assert.equal(folder,'Parts');assert.equal(project,'Part');return {json:'cloud document',token:'revision-1'};}};
 const target=await selectSaveTarget(provider,'Parts','Part',null,4);
 assert.deepEqual(target,{folder:'Parts',project:'Part',token:'revision-1',documentEpoch:4});
 assert.equal(currentSaveTarget(target,4),target);
 // Preserve the initial token: reselecting must not hide a concurrent edit.
 assert.equal(await selectSaveTarget(provider,'Parts','Part',target,4),target);assert.equal(reads,1);
 assert.equal(currentSaveTarget(target,5),null);
 assert.equal(await selectSaveTarget(provider,'Parts','',target,4),null);
});
test('legacy revision-only project creates its current record using a null compare-and-swap token',async()=>{
 const target=await selectSaveTarget({current:async()=>null},'Parts','Legacy',null,0);
 assert.equal(target.token,null);
});
