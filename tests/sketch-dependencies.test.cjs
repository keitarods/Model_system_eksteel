const {test}=require('node:test');
const assert=require('node:assert/strict');
const {bindSketchDependencies:bind,resolveSketchDependencies:resolve}=require('../src/lib/features/sketchDependencies.ts');
const {rebuildModel}=require('../src/lib/replicad/build-model.ts');
const {activeFeatures}=require('../src/lib/features/suppression.ts');
const {serializeProject,parseProject}=require('../src/lib/project/nativeFormat.ts');
const plane={origin:[0,0,0],normal:[0,0,1],xDir:[1,0,0]};
const sketch={id:'s',type:'sketch',label:'Esboço',plane,shapes:[{id:'c',type:'circle',center:'p',radius:2}],points:{p:{id:'p',x:5,y:0}},dimensions:[]};
const extrude={id:'e',type:'extrude',label:'Extrusão',plane,profile:{kind:'circle',cx:5,cy:0,r:2},depth:10,cut:false};
const edited=s=>({...s,shapes:s.shapes.map(p=>({...p,radius:3}))});
test('saved references drive actual kernel volume and dependent patterns after sketch edit',async()=>{
 await require('./kernel.cjs')();const r=require('replicad');
 const pattern={id:'p',type:'pattern',label:'Padrão',sourceFeatureId:'e',kind:'rectangular',dir1:[1,0,0],count1:2,spacing1:20};
 const linked=bind([sketch,extrude,pattern]);
 const restored=parseProject(serializeProject(linked)).features;
 const before=rebuildModel(restored);
 const after=rebuildModel([edited(restored[0]),...restored.slice(1)]);
 try {assert.ok(Math.abs(r.measureVolume(before)-80*Math.PI)<1e-5);assert.ok(Math.abs(r.measureVolume(after)-180*Math.PI)<1e-5);} finally {before.delete();after.delete();}
});
test('missing profile fails explicitly and never switches to a replacement circle',()=>{
 const linked=bind([sketch,extrude]);
 assert.throws(()=>resolve([{...sketch,shapes:[{...sketch.shapes[0],id:'replacement'}]},linked[1]]),/Extrusão.*removido/);
 assert.throws(()=>resolve([linked[1]]),/ausente/);
 assert.equal(activeFeatures([{...linked[0],suppressed:true},linked[1]]).length,0);
});
test('migration leaves ambiguous and unrelated snapshots alone',()=>{
 const duplicate={...sketch,id:'other'};
 assert.equal(bind([sketch,duplicate,extrude])[2].sketchReference,undefined);
 assert.equal(bind([sketch,{...extrude,profile:{kind:'circle',cx:9,cy:0,r:2}}])[1].sketchReference,undefined);
});
test('face, sweep, helix, revolve and hole follow planes, profile dimensions and axis identity',()=>{
 const axis={id:'axis',type:'line',isCenterLine:true,p1:'a',p2:'b'};
 const s={...sketch,shapes:[...sketch.shapes,axis],points:{...sketch.points,a:{x:0,y:0},b:{x:0,y:10}}};
 for(const type of ['face','sweep','helix','revolve','hole']) {
  const feature=type==='hole'?{id:type,type,label:type,plane,center:{x:5,y:0},radius:2,depth:10,through:false}:{...extrude,id:type,type,label:type,axisOrigin:{x:0,y:0},axisDirection:{x:0,y:1},angle:360};
  const linked=bind([s,feature]);assert.ok(linked[1].sketchReference,type);
  const changed={...edited(s),plane:{...plane,origin:[0,0,7]},points:{...s.points,b:{x:10,y:0}}};
  const result=resolve([changed,linked[1]])[1];
  assert.equal(type==='hole'?result.radius:result.profile.r,3);assert.deepEqual(result.plane.origin,[0,0,7]);
  if(type==='helix'||type==='revolve')assert.deepEqual(result.axisDirection,{x:1,y:0});
 }
});
test('store captures legacy associations before edits; undo/redo restores both geometry and references',async()=>{
 const {useFeatureStore:store}=require('../src/lib/features/store.ts');
 const {undoModel,redoModel,useUndoStore:history}=require('../src/lib/history/store.ts');
 store.setState({features:[sketch,extrude]});await new Promise(queueMicrotask);history.setState({past:[],future:[]});
 store.getState().updateFeature('s',edited(sketch));await new Promise(queueMicrotask);
 assert.equal(resolve(store.getState().features)[1].profile.r,3);
 undoModel();assert.equal(resolve(bind(store.getState().features))[1].profile.r,2);
 redoModel();assert.equal(resolve(store.getState().features)[1].profile.r,3);
 store.getState().updateFeature('e',{...extrude,depth:20});
 assert.equal(resolve(store.getState().features)[1].profile.r,3);
 store.getState().removeFeature('s');assert.throws(()=>rebuildModel(store.getState().features),/ausente/);
});
test('multi-profile selection stays attached when unrelated geometry is added',()=>{
 const s={...sketch,shapes:[...sketch.shapes,{id:'c2',type:'circle',center:'p2',radius:1}],points:{...sketch.points,p2:{x:15,y:0}}};
 const e={...extrude,profile:[extrude.profile,{kind:'circle',cx:15,cy:0,r:1}]};
 const linked=bind([s,e]);
 const changed={...edited(s),shapes:[...edited(s).shapes,{id:'c3',type:'circle',center:'p',radius:100}]};
 const result=resolve([changed,linked[1]])[1];
 assert.deepEqual(result.profile.map(p=>p.r),[3,3]);
});
