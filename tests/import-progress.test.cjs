const {test}=require('node:test');
const assert=require('node:assert/strict');
const {importBodies}=require('../src/lib/replicad/exchangeImport.ts');
const {rebuildModel}=require('../src/lib/replicad/build-model.ts');
test('STEP progress keeps every validated body and its original geometry',async()=>{
 await require('./kernel.cjs')();
 const r=require('replicad');
 const a=r.makeBox([0,0,0],[10,20,30]),b=r.makeBox([50,0,0],[60,20,30]);
 const compound=r.compoundShapes([a,b]);
 try {
  let id=0;const progress=[];
  const result=await importBodies(compound.blobSTEP(),'assembly.step',()=>`body-${++id}`,{onProgress:message=>progress.push(message)});
  assert.equal(result.features.length,2);
  assert.ok(progress.some(message=>message.includes('1 de 2')));
  assert.ok(progress.some(message=>message.includes('2 de 2')));
  assert.ok(result.features.every(f=>f.type==='imported'&&f.preserveBody));
  const restored=rebuildModel(result.features);
  try{assert.ok(Math.abs(r.measureVolume(restored)-12000)<1e-4);}finally{restored.delete();}
 } finally {compound.delete();}
});
