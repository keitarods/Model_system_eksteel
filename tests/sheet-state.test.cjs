const {test}=require('node:test');const assert=require('node:assert/strict');
const {sheetIsUnfolded}=require('../src/lib/features/sheetState.ts');
const {rebuildModel}=require('../src/lib/replicad/build-model.ts');
const {serializeProject,parseProject}=require('../src/lib/project/nativeFormat.ts');
const r=require('replicad');
const base=[{id:'rule',type:'sheetMetal',thickness:2,label:'Regra'},{id:'base',type:'face',label:'Base',plane:{origin:[0,0,0],normal:[0,0,1],xDir:[1,0,0]},profile:{kind:'rect',x1:0,y1:0,x2:40,y2:30}},{id:'bend',type:'flange',label:'Dobra',parentId:'base',edgeStart:[0,0,2],edgeEnd:[40,0,2],length:12,angle:90,innerRadius:3,kFactor:.42}];
const unfold={id:'u',type:'unfold',label:'Desdobrar'},refold={id:'r',type:'refold',label:'Redobrar'};
test('sheet states validate order and refuse unsupported unfolded edits',()=>{
 assert.equal(sheetIsUnfolded([...base,unfold]),true);
 assert.equal(sheetIsUnfolded([...base,unfold,refold]),false);
 for(const invalid of [[unfold],[...base,refold],[...base,unfold,unfold],[...base,unfold,{...base[1],id:'cut',cut:true}]]) assert.throws(()=>sheetIsUnfolded(invalid));
});
test('unfold matches flat pattern and refold restores original solid after native round trip',async()=>{
 await require('./kernel.cjs')();
 const features=parseProject(serializeProject([...base,unfold,refold])).features;
 const solids=[rebuildModel(base),rebuildModel(base,{flatten:true}),rebuildModel(features.slice(0,-1)),rebuildModel(features)];
 try {
  assert.ok(Math.abs(r.measureVolume(solids[0])-r.measureVolume(solids[3]))<1e-6);
  assert.ok(Math.abs(r.measureVolume(solids[1])-r.measureVolume(solids[2]))<1e-6);
  assert.deepEqual(solids[0].boundingBox.bounds,solids[3].boundingBox.bounds);
  assert.deepEqual(solids[1].boundingBox.bounds,solids[2].boundingBox.bounds);
 } finally {solids.forEach(s=>s.delete());}
});
test('unfold and refold participate in global undo/redo',async()=>{
 const {useFeatureStore}=require('../src/lib/features/store.ts');
 const {undoModel,redoModel}=require('../src/lib/history/store.ts');
 useFeatureStore.setState({features:base});await Promise.resolve();
 useFeatureStore.getState().addFeature(unfold);await Promise.resolve();
 assert.equal(sheetIsUnfolded(useFeatureStore.getState().features),true);
 undoModel();assert.equal(sheetIsUnfolded(useFeatureStore.getState().features),false);
 redoModel();assert.equal(sheetIsUnfolded(useFeatureStore.getState().features),true);
 useFeatureStore.getState().addFeature(refold);await Promise.resolve();
 undoModel();assert.equal(sheetIsUnfolded(useFeatureStore.getState().features),true);
 redoModel();assert.equal(sheetIsUnfolded(useFeatureStore.getState().features),false);
});
