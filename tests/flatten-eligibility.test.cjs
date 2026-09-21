const {test}=require('node:test');const assert=require('node:assert/strict');
const {flattenEligibility}=require('../src/lib/features/flattenEligibility.ts');
const rule={type:'sheetMetal'};
test('sheet conversion alone never presents an unchanged imported body as a flat pattern',()=>{
 assert.equal(flattenEligibility([rule,{type:'imported'}]),'imported');
 assert.equal(flattenEligibility([rule,{type:'extrude'}]),'unsupported');
 assert.equal(flattenEligibility([rule,{type:'face'}]),'flat');
 assert.equal(flattenEligibility([rule,{type:'face'},{type:'flange'}]),'native');
});

test('suppressed imported reference does not block native Face and Flange flattening',()=>{
 const native=[{id:'rule',type:'sheetMetal'},{id:'face',type:'face'},{id:'bend',type:'flange',parentId:'face'}];
 assert.equal(flattenEligibility([{id:'step',type:'imported',suppressed:true},...native]),'native');
 assert.equal(flattenEligibility([{id:'step',type:'imported',visible:false},...native]),'imported');
 assert.equal(flattenEligibility(native.map(f=>f.id==='bend'?{...f,suppressed:true}:f)),'flat');
});
