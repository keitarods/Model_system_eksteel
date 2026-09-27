const {test}=require('node:test');const assert=require('node:assert/strict');
const {emptyStudy}=require('../src/lib/simulation/types.ts');
const {parseStudy,serializeStudy,validateMesh,validateResults}=require('../src/lib/simulation/format.ts');
const mesh={nodes:[[0,0,0],[1,0,0],[0,1,0],[0,0,1]],tetrahedra:[[0,1,2,3]],faces:[{id:1,triangles:[[0,2,1]],elements:[0],area:.5,center:[.33,.33,0]}],quality:{minimum:.8,mean:.8},volume:1/6,size:1,refinements:[],elementType:'C3D4'};
test('simulation native study roundtrip preserves geometry, loads, supports and mesh',()=>{
 const s={...emptyStudy(),step:'ISO-10303-21;',mesh,supports:[{id:'s',faceIds:[1],axes:[true,true,true]}],loads:[{id:'l',kind:'force',faceIds:[1],vector:[100,0,0],pressure:0}]};
 assert.deepEqual(parseStudy(serializeStudy(s)),s);
 assert.throws(()=>parseStudy(serializeStudy({...s,supports:[{...s.supports[0],faceIds:[999]}]})),/inexistente/);
 assert.throws(()=>parseStudy(serializeStudy({...s,material:{...s.material,poisson:.5}})),/Material/);
});
test('simulation import rejects invalid connectivity and incomplete result tensors',()=>{
 assert.throws(()=>validateMesh({...mesh,tetrahedra:[[0,1,2,8]]}),/Conectividade/);
 assert.throws(()=>validateMesh({...mesh,faces:[{...mesh.faces[0],elements:[99]}]}),/Superfície/);
 assert.throws(()=>validateResults({displacements:[[0,0,0]]},mesh),/Deslocamentos/);
 assert.throws(()=>parseStudy(JSON.stringify({format:'eksteel-fea',version:999,study:emptyStudy()})),/reconhecido/);
});
test('FEA cancellation while submitting cancels the created job instead of orphaning it',async()=>{
 const {runFeaJob}=require('../src/lib/simulation/client.ts');const original=global.fetch;const calls=[];const c=new AbortController();
 global.fetch=async(url,options)=>{calls.push([url,options?.method]);if(options?.method==='POST'){c.abort();return {ok:true,json:async()=>({id:'job'})};}return {ok:true,json:async()=>({status:'cancelled'})};};
 try{await assert.rejects(runFeaJob({},c.signal,()=>{},()=>{}),{name:'AbortError'});assert.ok(calls.some(([url,method])=>url.includes('jobId=job')&&method==='DELETE'));}finally{global.fetch=original;}
});
