const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createModelHandoff}=require('../src/lib/replicad/preparedModel.ts');
test('validated import transfers once without rebuilding or deleting the consumed model',()=>{
 const handoff=createModelHandoff();const features=[];let deleted=0;const model={delete(){deleted++;}};
 handoff.put(features,model);
 assert.equal(handoff.take(features),model);
 assert.equal(handoff.take(features),null);
 handoff.clear();assert.equal(deleted,0);
 model.delete();assert.equal(deleted,1);
});
test('different history, flattened preview, replacement and abandoned import dispose unused geometry',()=>{
 const handoff=createModelHandoff();const features=[];let deleted=0;
 const model=()=>({delete(){deleted++;}});
 handoff.put(features,model());assert.equal(handoff.take([...features]),null);assert.equal(deleted,1);
 handoff.put(features,model());assert.equal(handoff.take(features,true),null);assert.equal(deleted,2);
 handoff.put(features,model());handoff.put(features,model());assert.equal(deleted,3);
 handoff.clear();handoff.clear();assert.equal(deleted,4);
});
