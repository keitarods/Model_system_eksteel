const {test}=require('node:test');
const assert=require('node:assert/strict');
const {editOperationSketch}=require('../src/lib/features/editOperationSketch.ts');
const {resolveSketchDependencies}=require('../src/lib/features/sketchDependencies.ts');
const {rebuildModel}=require('../src/lib/replicad/build-model.ts');
const {serializeProject,parseProject}=require('../src/lib/project/nativeFormat.ts');
const plane={origin:[0,0,0],normal:[0,0,1],xDir:[1,0,0]};
let n=0;const id=()=>`recovered-${++n}`;
const circle={kind:'circle',cx:10,cy:0,r:2};
const op=(profile=circle)=>({id:'e',type:'extrude',label:'Extrusão antiga',plane,profile,depth:10,cut:false});
test('legacy operation with no sketch opens an editable original profile; kernel result remains identical',async()=>{
 await require('./kernel.cjs')();const {measureVolume}=require('replicad');
 for (const profile of [circle,{kind:'rect',x1:0,y1:0,x2:10,y2:5},{kind:'slot',c1:{x:0,y:0},c2:{x:10,y:0},r:2},
  {kind:'region',outer:{kind:'rect',x1:0,y1:-5,x2:20,y2:5},holes:[circle]},[circle,{kind:'circle',cx:20,cy:0,r:3}]]) {
  const original=[op(profile)];const result=editOperationSketch(original,'e',id);
  assert.equal(original.length,1);assert.equal(result.features[0].type,'sketch');
  const before=rebuildModel(original),after=rebuildModel(result.features);
  try{assert.ok(Math.abs(measureVolume(before)-measureVolume(after))<1e-6);}finally{before.delete();after.delete();}
  const reopened=editOperationSketch(parseProject(serializeProject(result.features)).features,'e',id);
  assert.equal(reopened.features.length,2);assert.equal(reopened.sketch.id,result.sketch.id);
 }
});
test('editing a recovered profile updates existing operation and preserves IDs/body groups',()=>{
 const operation={...op(),bodyGroupId:'body'};
 const result=editOperationSketch([operation],'e',id);
 const changed={...result.sketch,shapes:result.sketch.shapes.map(s=>({...s,radius:5}))};
 const rebuilt=resolveSketchDependencies([changed,result.features[1]]);
 assert.equal(rebuilt[1].id,'e');assert.equal(rebuilt[1].profile.r,5);assert.equal(changed.bodyGroupId,'body');
});
test('revolve recovers its axis and holes recover every circle',()=>{
 const revolve={...op(),type:'revolve',angle:360,axisOrigin:{x:0,y:0},axisDirection:{x:0,y:1}};
 const result=editOperationSketch([revolve],'e',id);
 assert.ok(result.sketch.shapes.some(s=>s.isCenterLine));
 assert.deepEqual(resolveSketchDependencies(result.features)[1].axisDirection,{x:0,y:1});
 const hole={id:'h',label:'Furos',type:'hole',plane,center:{x:5,y:5},radius:2,extraHoles:[{center:{x:10,y:5},radius:1}],through:false,depth:5};
 const holes=editOperationSketch([hole],'h',id);
 assert.equal(holes.sketch.shapes.length,2);assert.deepEqual(resolveSketchDependencies(holes.features)[1].extraHoles,hole.extraHoles);
});
test('missing explicit source is reported instead of silently replacing a broken dependency',()=>{
 assert.throws(()=>editOperationSketch([{...op(),sketchReference:{sketchId:'missing',profileShapeIds:['c']}}],'e',id),/removido/);
 assert.throws(()=>editOperationSketch([{id:'i',type:'imported',label:'STEP'}],'i',id),/não utiliza/);
});
test('opened native sheet Face recovers its sketch and resizing changes the sheet volume',async()=>{
 await require('./kernel.cjs')();const {measureVolume}=require('replicad');
 const stored=parseProject(serializeProject([
  {id:'rule',type:'sheetMetal',label:'Chapa',thickness:2},
  {id:'face',type:'face',label:'Face',plane,profile:{kind:'rect',x1:0,y1:0,x2:10,y2:20}}
 ])).features;
 const result=editOperationSketch(stored,'face',id);
 const before=rebuildModel(result.features);
 const rect=result.sketch.shapes[0];
 const edited={...result.sketch,points:{...result.sketch.points,[rect.p2]:{...result.sketch.points[rect.p2],x:30}}};
 const after=rebuildModel(result.features.map(f=>f.id===edited.id?edited:f));
 try { assert.ok(Math.abs(measureVolume(before)-400)<1e-6);assert.ok(Math.abs(measureVolume(after)-1200)<1e-6); }
 finally {before.delete();after.delete();}
});
test('a recovered Face profile accepts actual sketch pointer dragging and rebuilds at its new size',async()=>{
 await require('./kernel.cjs')();const {measureVolume}=require('replicad');
 const {useSketchStore:store}=require('../src/lib/sketch/store.ts');
 const result=editOperationSketch([{id:'rule',type:'sheetMetal',label:'Chapa',thickness:2},{id:'face',type:'face',label:'Face',plane,profile:{kind:'rect',x1:100,y1:100,x2:200,y2:200}}],'face',id);
 store.getState().clear();store.setState({...result.sketch,activePlane:plane,layers:[{id:'0',name:'Geometria',visible:true,locked:false}],activeLayerId:'0'});
 store.getState().setTool('select');
 store.getState().handleRawDown({x:200,y:200});store.getState().handleRawMove({x:250,y:200});store.getState().handleRawUp({x:250,y:200});
 const state=store.getState();const corner=result.sketch.shapes[0].p2;
 assert.equal(state.points[corner].x,250);
 const solid=rebuildModel(result.features.map(f=>f.id===result.sketch.id?{...f,points:state.points,shapes:state.shapes}:f));
 try{assert.ok(Math.abs(measureVolume(solid)-30000)<1e-5);}finally{solid.delete();}
});
