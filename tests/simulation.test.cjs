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
 const {runFeaJob,setFeaTarget}=require('../src/lib/simulation/client.ts');await setFeaTarget('server');const original=global.fetch;const calls=[];const c=new AbortController();
 global.fetch=async(url,options)=>{calls.push([url,options?.method]);if(options?.method==='POST'){c.abort();return {ok:true,json:async()=>({id:'job'})};}return {ok:true,json:async()=>({status:'cancelled'})};};
 try{await assert.rejects(runFeaJob({},c.signal,()=>{},()=>{}),{name:'AbortError'});assert.ok(calls.some(([url,method])=>url.includes('jobId=job')&&method==='DELETE'));}finally{global.fetch=original;}
});
test('preparation and mesh controls persist and reject unsafe tolerances',()=>{
 const s={...emptyStudy(),preparation:{heal:true,removeSmall:false,unite:true,closeGaps:true,tolerance:.001},meshControls:{minimumSize:1,curvature:20,qualityTarget:.3}};
 assert.deepEqual(parseStudy(serializeStudy(s)),s);
 assert.throws(()=>parseStudy(serializeStudy({...s,preparation:{...s.preparation,tolerance:10}})),/Preparação/);
 assert.throws(()=>parseStudy(serializeStudy({...s,preparation:{...s.preparation,unite:false}})),/Preparação/);
 assert.throws(()=>parseStudy(serializeStudy({...s,meshControls:{...s.meshControls,minimumSize:100}})),/Controles/);
});
test('quadratic study validates all midside nodes and preserves legacy linear studies',()=>{
 const old={...emptyStudy(),mesh};delete old.elementType;
 assert.equal(parseStudy(serializeStudy(old)).elementType,'C3D4');
 const q={...mesh,elementType:'C3D10',nodes:[...mesh.nodes,[.5,0,0],[.5,.5,0],[0,.5,0],[0,0,.5],[.5,0,.5],[0,.5,.5]],tetrahedra:[[0,1,2,3,4,5,6,7,8,9]],faces:[{...mesh.faces[0],triangles:[[0,6,4],[6,2,5],[4,5,1],[6,5,4]],elements:[0,0,0,0],loadTriangles:[[0,2,1,6,5,4]]}]};
 validateMesh(q);
 const study={...emptyStudy(),mesh:q};assert.deepEqual(parseStudy(serializeStudy(study)),study);
 assert.throws(()=>validateMesh({...q,tetrahedra:[[0,1,2,3]]}),/Conectividade/);
 assert.throws(()=>validateMesh({...q,faces:[{...q.faces[0],loadTriangles:undefined}]}),/quadrática/);
});
test('material regions partition the mesh and validate overrides',()=>{
 const regionMesh={...mesh,regions:[{id:1,elements:[0],volume:1/6,center:[.25,.25,.25]}]};
 const study={...emptyStudy(),materialMode:'regions',regionMaterials:{'1':emptyStudy().material},mesh:regionMesh};
 assert.deepEqual(parseStudy(serializeStudy(study)),study);
 assert.throws(()=>validateMesh({...regionMesh,regions:[...regionMesh.regions,{id:2,elements:[0],volume:1,center:[0,0,0]}]}),/elementos/);
 assert.throws(()=>parseStudy(serializeStudy({...study,regionMaterials:{'99':study.material}})),/região/);
});
test('normal force persists, reverses and uses current mesh area without altering legacy forces',()=>{
 const {solverLoads}=require('../src/lib/simulation/loads.ts');
 const load={id:'n',kind:'force',faceIds:[1],vector:[0,0,0],pressure:0,direction:'normal',magnitude:100,inverted:false};
 const study={...emptyStudy(),mesh,loads:[load]};
 assert.deepEqual(parseStudy(serializeStudy(study)).loads,[load]);
 assert.equal(solverLoads([load],mesh)[0].pressure,200);
 assert.equal(solverLoads([{...load,inverted:true}],mesh)[0].pressure,-200);
 const scaled={...mesh,nodes:mesh.nodes.map(p=>p.map(v=>v*2))};
 assert.equal(solverLoads([load],scaled)[0].pressure,50);
 const legacy={...load,direction:undefined,vector:[100,0,0]};
 assert.deepEqual(solverLoads([legacy],mesh),[legacy]);
 assert.equal(load.kind,'force');
 assert.throws(()=>solverLoads([{...load,faceIds:[999]}],mesh),/Face/);
 assert.throws(()=>parseStudy(serializeStudy({...study,loads:[{...load,magnitude:-1}]})),/intensidade/);
});
test('normal force distributes magnitude across selected faces and quadratic integration facets',()=>{
 const {solverLoads}=require('../src/lib/simulation/loads.ts');
 const load={id:'n',kind:'force',faceIds:[1,2],vector:[0,0,0],pressure:0,direction:'normal',magnitude:300};
 const multiple={...mesh,faces:[mesh.faces[0],{...mesh.faces[0],id:2,triangles:[[0,1,3]]}]};
 assert.equal(solverLoads([load],multiple)[0].pressure,300);
 const quadratic={...mesh,faces:[{...mesh.faces[0],triangles:[],loadTriangles:[[0,2,1,4,5,6]]}]};
 assert.equal(solverLoads([{...load,faceIds:[1]}],quadratic)[0].pressure,600);
});
