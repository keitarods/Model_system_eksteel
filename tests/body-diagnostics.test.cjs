const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readBodyDiagnostic,diagnosticSummary}=require('../src/lib/simulation/bodyDiagnostics.ts');
const body={bodyId:1,bodyCount:2,bounds:[0,0,0,1,1,1],status:'passed',message:'OK'};
test('diagnostic display rejects invalid geometry and mismatched body IDs',()=>{
 assert.deepEqual(readBodyDiagnostic(body,1),body);
 for(const value of [{...body,bounds:[0,0,0,Infinity,1,1]},{...body,bounds:[2,0,0,1,1,1]}, {...body,bodyId:2}, {...body,status:'safe'}])
  assert.throws(()=>readBodyDiagnostic(value,1));
});
test('passing individual bodies never certifies the whole assembly or blames interfaces',()=>{
 assert.match(diagnosticSummary([body]),/parcial/);
 assert.match(diagnosticSummary([body,{...body,bodyId:2}]),/não foi localizada/);
 assert.match(diagnosticSummary([{...body,status:'failed'}]),/1 corpo.*parcial/);
 assert.match(diagnosticSummary([body,{...body,bodyId:2,status:'inconclusive'}]),/inconclusivo/);
});
