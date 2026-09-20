const {test}=require('node:test');const assert=require('node:assert/strict');
const r=require('replicad');const {recognizeOperations,compareReconstruction}=require('../src/lib/replicad/recognizeOperations.ts');
const {rebuildModel}=require('../src/lib/replicad/build-model.ts');
let n=0;const id=()=>`recognition-${++n}`;
const source=s=>({id:id(),type:'imported',label:'STEP',format:'step',brep:s.serialize()});
test('extrusion and blind/through holes reproduce occupied geometry, survive saving and remain editable',async()=>{
 await require('./kernel.cjs')();
 for(const through of [false,true]){
 const box=r.makeBox([0,0,0],[40,30,10]),tool=r.drawCircle(3).sketchOnPlane('XY',[10,10,through?0:6]).extrude(through?10:4),body=box.cut(tool);box.delete();tool.delete();
 try{const result=recognizeOperations(source(body),'extrude',id);assert.ok(result.features.some(f=>f.type==='hole'));assert.ok(result.features.some(f=>f.type==='extrude'));
 const restored=JSON.parse(JSON.stringify(result.features));const rebuilt=rebuildModel(restored);assert.ok(Math.abs(r.measureVolume(rebuilt)-r.measureVolume(body))<1e-5);rebuilt.delete();
 const hole=result.features.find(f=>f.type==='hole');assert.equal(hole.through,through);
 }finally{body.delete();}}
});
test('revolution recognizes a stepped hollow shaft using an exact half-section',async()=>{
 await require('./kernel.cjs')();
 const a=r.drawCircle(8).sketchOnPlane('XY').extrude(20),b=r.drawCircle(12).sketchOnPlane('XY',20).extrude(10),c=a.fuse(b);a.delete();b.delete();const tool=r.drawCircle(3).sketchOnPlane('XY').extrude(30),body=c.cut(tool);c.delete();tool.delete();
 try{const result=recognizeOperations(source(body),'revolve',id);assert.ok(result.features.some(f=>f.type==='revolve'));assert.ok(result.differenceVolume<=result.toleranceVolume);}finally{body.delete();}
});
test('flat sheet is recognized but bent sheet with missing process information is rejected',async()=>{
 await require('./kernel.cjs')();const body=r.makeBox([0,0,0],[40,30,2]);
 try{const result=recognizeOperations(source(body),'sheetMetal',id);assert.equal(result.features.find(f=>f.type==='sheetMetal').thickness,2);assert.ok(result.features.some(f=>f.type==='face'));}finally{body.delete();}
 const plane={origin:[0,0,0],normal:[0,0,1],xDir:[1,0,0]};const bent=rebuildModel([{id:'rule',type:'sheetMetal',thickness:2,label:'rule'},{id:'base',type:'face',label:'base',plane,profile:{kind:'rect',x1:0,y1:0,x2:40,y2:30}},{id:'bend',type:'flange',label:'bend',parentId:'base',edgeStart:[0,0,2],edgeEnd:[40,0,2],length:12,angle:90}]);
 try{assert.throws(()=>recognizeOperations(source(bent),'sheetMetal',id),/fator K/);}finally{bent.delete();}
});
test('equal volume at a different position cannot pass reconstruction verification',async()=>{
 await require('./kernel.cjs')();const body=r.makeBox([0,0,0],[10,10,10]);try{assert.throws(()=>compareReconstruction(body,[{id:'x',type:'extrude',label:'bad',plane:{origin:[30,0,0],normal:[0,0,1],xDir:[1,0,0]},profile:{kind:'rect',x1:0,y1:0,x2:10,y2:10},depth:10,cut:false}]),/tolerância/);}finally{body.delete();}
});
test('explicit bent-sheet data reconstructs and unfolds; missing K, mismatched dimensions and bad parents fail',async()=>{
 await require('./kernel.cjs')();const {recognizeSheetRecipe}=require('../src/lib/replicad/recognizeOperations.ts');
 const plane={origin:[0,0,0],normal:[0,0,1],xDir:[1,0,0]};
 const features=[{id:'rule',type:'sheetMetal',thickness:2,label:'Regra'},{id:'base',type:'face',label:'Base',plane,profile:{kind:'rect',x1:0,y1:0,x2:40,y2:30}},{id:'bend',type:'flange',label:'Dobra',parentId:'base',edgeStart:[0,0,2],edgeEnd:[40,0,2],length:12,angle:90,innerRadius:3,kFactor:.42}];
 const body=rebuildModel(features),payload=fs=>JSON.stringify({format:'eksteel-sheet-reconstruction',version:1,features:fs});
 try{
 const result=recognizeSheetRecipe(source(body),payload(features),id);assert.ok(result.features.some(f=>f.type==='flange'&&f.innerRadius===3&&f.kFactor===.42));
 const flat=rebuildModel(result.features,{flatten:true});assert.ok(r.measureVolume(flat)>0);flat.delete();
 const bad=structuredClone(features);delete bad[2].kFactor;assert.throws(()=>recognizeSheetRecipe(source(body),payload(bad),id),/kFactor/);
 bad[2].kFactor=.42;bad[2].length=13;assert.throws(()=>recognizeSheetRecipe(source(body),payload(bad),id),/tolerância/);
 bad[2].parentId='missing';assert.throws(()=>recognizeSheetRecipe(source(body),payload(bad),id),/pai/);
 }finally{body.delete();}
});
test('recognition is non-mutating and applying a proposal is a single undo/redo step',async()=>{
 await require('./kernel.cjs')();const {useFeatureStore:s}=require('../src/lib/features/store.ts');const {undoModel,redoModel,useUndoStore:h}=require('../src/lib/history/store.ts');
 const box=r.makeBox([0,0,0],[30,20,5]);try{
 const imported=source(box);s.setState({features:[imported]});await new Promise(queueMicrotask);h.setState({past:[],future:[]});const before=s.getState().features;
 const result=recognizeOperations(imported,'extrude',id);assert.equal(s.getState().features,before);
 s.setState({features:result.features});undoModel();assert.equal(s.getState().features[0].id,imported.id);redoModel();assert.ok(s.getState().features.some(f=>f.type==='extrude'));
 }finally{box.delete();}
});
test('a rotated STEP round-trip reconstructs in its original world placement',async()=>{
 await require('./kernel.cjs')();const {importBodies}=require('../src/lib/replicad/exchangeImport.ts');const {serializeProject,parseProject}=require('../src/lib/project/nativeFormat.ts');
 const original=r.makeBox([0,0,0],[40,30,4]).rotate(37,[0,0,0],[1,1,0]).translate([50,-30,80]);
 try{
 const imported=await importBodies(original.blobSTEP(),'rotated.step',id);assert.equal(imported.features.length,1);
 const result=recognizeOperations(imported.features[0],'extrude',id);
 const saved=parseProject(serializeProject(result.features)).features;
 assert.ok(compareReconstruction(original,saved).differenceVolume<1e-5);
 }finally{original.delete();}
});
test('unsupported off-axis features are rejected rather than silently omitted',async()=>{
 await require('./kernel.cjs')();const a=r.drawCircle(8).sketchOnPlane('XY').extrude(20),b=r.makeBox([0,0,15],[15,5,25]),body=a.fuse(b);a.delete();b.delete();
 try{assert.throws(()=>recognizeOperations(source(body),'revolve',id),/Revolução não reconhecida/);}finally{body.delete();}
});
