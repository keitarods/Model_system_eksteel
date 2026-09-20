const {test}=require('node:test');const assert=require('node:assert/strict');
const {importBody}=require('../src/lib/replicad/exchangeImport.ts');
const {rebuildModel}=require('../src/lib/replicad/build-model.ts');
const {serializeProject,parseProject}=require('../src/lib/project/nativeFormat.ts');
const {useFeatureStore:f}=require('../src/lib/features/store.ts');const {undoModel,redoModel,useUndoStore:h}=require('../src/lib/history/store.ts');
const tick=()=>new Promise(r=>queueMicrotask(r));
test('STEP and STL import, native save/reopen, boolean cut and history with real kernel',async()=>{
 await require('./kernel.cjs')();const r=require('replicad'),source=r.makeBox([0,0,0],[10,20,30]);
 try{
  for(const [name,blob] of [['box.step',source.blobSTEP()],['box.stl',source.blobSTL({binary:true})]]){
   const imported=await importBody(blob,name,'imported');assert.ok(imported.brep.length>0);
   const saved=parseProject(serializeProject([imported])).features;const restored=rebuildModel(saved);
   assert.ok(Math.abs(r.measureVolume(restored)-6000)<1e-5);restored.delete();
   const cut={id:'cut',type:'extrude',label:'cut',profile:{kind:'circle',cx:5,cy:10,r:2},plane:{origin:[0,0,0],normal:[0,0,1],xDir:[1,0,0]},depth:30,cut:true};
   const machined=rebuildModel([...saved,cut]);assert.ok(Math.abs(r.measureVolume(machined)-(6000-120*Math.PI))<1e-4);machined.delete();
   f.getState().clear();await tick();h.setState({past:[],future:[]});f.getState().addFeature(imported);await tick();
   undoModel();assert.equal(f.getState().features.length,0);redoModel();assert.equal(f.getState().features[0].brep,imported.brep);
  }
 }finally{source.delete();}
 await assert.rejects(()=>importBody(new Blob(['x']),'unknown.dwg','x'),/STEP/);
});
