const {test}=require('node:test');const assert=require('node:assert/strict');
const {activeFeatures}=require('../src/lib/features/suppression.ts');
const {rebuildModel}=require('../src/lib/replicad/build-model.ts');
const {serializeProject,parseProject}=require('../src/lib/project/nativeFormat.ts');
const {useFeatureStore}=require('../src/lib/features/store.ts');
const {undoModel,redoModel}=require('../src/lib/history/store.ts');
test('suppression cascades through named bend dependencies, reactivation restores stored features',()=>{
 const chain=[{id:'rule',type:'sheetMetal',suppressed:true},{id:'base',type:'face'},{id:'b',type:'flange',parentId:'base'},{id:'u',type:'unfold'},{id:'r',type:'refold'}];
 assert.deepEqual(activeFeatures(chain),[]);
 assert.equal(activeFeatures(chain.map(f=>({...f,suppressed:false}))).length,5);
});
test('suppression changes geometry but visibility does not; metadata survives saving and undo',async()=>{
 await require('./kernel.cjs')();const r=require('replicad');
 const base={id:'base',type:'extrude',label:'Base',plane:{origin:[0,0,0],normal:[0,0,1],xDir:[1,0,0]},profile:{kind:'rect',x1:0,y1:0,x2:20,y2:20},depth:5,cut:false};
 const cut={...base,id:'cut',cut:true,profile:{kind:'circle',cx:10,cy:10,r:2}};
 const full=rebuildModel([base,cut]), hidden=rebuildModel([{...base,visible:false},cut]), suppressed=rebuildModel([base,{...cut,suppressed:true}]);
 try{assert.ok(r.measureVolume(suppressed)>r.measureVolume(full));assert.ok(Math.abs(r.measureVolume(hidden)-r.measureVolume(full))<1e-6);}finally{[full,hidden,suppressed].forEach(s=>s.delete());}
 const saved=parseProject(serializeProject([base,{...cut,suppressed:true,visible:false}])).features;
 assert.equal(saved[1].suppressed,true);assert.equal(saved[1].visible,false);
 useFeatureStore.setState({features:[base,cut]});await Promise.resolve();
 useFeatureStore.getState().updateFeature('cut',{...cut,suppressed:true});await Promise.resolve();
 undoModel();assert.equal(useFeatureStore.getState().features[1].suppressed,undefined);
 redoModel();assert.equal(useFeatureStore.getState().features[1].suppressed,true);
});
