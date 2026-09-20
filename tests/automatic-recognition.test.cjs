const {test}=require('node:test');const assert=require('node:assert/strict');
const r=require('replicad');const {automaticallyRecognize,automaticallyRecognizeBodies}=require('../src/lib/replicad/automaticRecognition.ts');
const {rebuildModel}=require('../src/lib/replicad/build-model.ts');const {serializeProject,parseProject}=require('../src/lib/project/nativeFormat.ts');
let serial=0;const id=()=>`auto-${++serial}`;const source=s=>({id:id(),type:'imported',label:'STEP',format:'step',brep:s.serialize(),preserveBody:true});
test('automatic recognition tries alternatives and preserves unsupported BREP exactly',async()=>{
 await require('./kernel.cjs')();const box=r.makeBox([0,0,0],[20,30,10]);
 try{const result=automaticallyRecognize(source(box),id);assert.equal(result.status,'reconstructed');assert.equal(result.method,'extrude');}finally{box.delete();}
 const a=r.drawCircle(8).sketchOnPlane('XY').extrude(20),b=r.drawCircle(12).sketchOnPlane('XY',20).extrude(10),shaft=a.fuse(b);a.delete();b.delete();
 try{const result=automaticallyRecognize(source(shaft),id);assert.equal(result.status,'reconstructed');assert.equal(result.method,'revolve');}finally{shaft.delete();}
 const sphere=r.makeSphere(10);try{const original=source(sphere),result=automaticallyRecognize(original,id);assert.equal(result.status,'solid');assert.equal(result.features[0],original);assert.equal(result.features[0].brep,original.brep);assert.equal(result.attempts.length,2);}finally{sphere.delete();}
});
test('mixed imports preserve separate bodies and isolate a recognized through hole from a neighbouring body',async()=>{
 await require('./kernel.cjs')();const box=r.makeBox([0,0,0],[20,20,10]),tool=r.drawCircle(2).sketchOnPlane('XY',[10,10,0]).extrude(10),plate=box.cut(tool);box.delete();tool.delete();
 const sphere=r.makeSphere(5).translate([10,10,25]);
 try{
 const sources=[source(plate),source(sphere)],progress=[];const result=await automaticallyRecognizeBodies(sources,id,(n,total)=>progress.push([n,total]));
 assert.deepEqual(result.results.map(x=>x.status),['reconstructed','solid']);assert.deepEqual(progress,[[1,2],[2,2]]);
 const saved=parseProject(serializeProject(result.features)).features,body=rebuildModel(saved);
 try{assert.ok(Math.abs(r.measureVolume(body)-(r.measureVolume(plate)+r.measureVolume(sphere)))<1e-5);const solids=Array.from(r.iterTopo(body.wrapped,'solid'));assert.equal(solids.length,2);solids.forEach(x=>x.delete());}finally{body.delete();}
 // Reverse ordering too: an existing body must not be cut by the next group's through hole.
 const reversed=await automaticallyRecognizeBodies([...sources].reverse(),id);const combined=rebuildModel(reversed.features);
 try{assert.ok(Math.abs(r.measureVolume(combined)-(r.measureVolume(plate)+r.measureVolume(sphere)))<1e-5);}finally{combined.delete();}
 }finally{plate.delete();sphere.delete();}
});
test('automatic import and fallback participate in one undo transaction',async()=>{
 await require('./kernel.cjs')();const {useFeatureStore:s}=require('../src/lib/features/store.ts');const {useUndoStore:h,undoModel,redoModel}=require('../src/lib/history/store.ts');const box=r.makeBox([0,0,0],[20,30,5]);
 try{s.getState().clear();await new Promise(queueMicrotask);h.setState({past:[],future:[]});const result=await automaticallyRecognizeBodies([source(box)],id);assert.equal(s.getState().features.length,0);s.setState({features:result.features});undoModel();assert.equal(s.getState().features.length,0);redoModel();assert.ok(s.getState().features.some(f=>f.type==='extrude'&&f.bodyGroupId));}finally{box.delete();}
});
test('editing a grouped operation preserves body isolation and rebuilt geometry',async()=>{
 await require('./kernel.cjs')();const {useFeatureStore:s}=require('../src/lib/features/store.ts');const box=r.makeBox([0,0,0],[20,30,5]);
 try{const result=await automaticallyRecognizeBodies([source(box)],id);s.setState({features:result.features});const extrusion=result.features.find(f=>f.type==='extrude');const {bodyGroupId,...edit}=extrusion;s.getState().updateFeature(extrusion.id,{...edit,depth:10});assert.equal(s.getState().features.find(f=>f.id===extrusion.id).bodyGroupId,bodyGroupId);const rebuilt=rebuildModel(s.getState().features);try{assert.ok(Math.abs(r.measureVolume(rebuilt)-6000)<1e-5);}finally{rebuilt.delete();}}finally{box.delete();}
});
