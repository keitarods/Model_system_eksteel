const {test}=require('node:test');const assert=require('node:assert/strict');
const {editOperationSketch}=require('../src/lib/features/editOperationSketch.ts');
const {updateSketchWithDependents}=require('../src/lib/features/updateSketchWithDependents.ts');
const {rebuildModel}=require('../src/lib/replicad/build-model.ts');
const plane={origin:[0,0,0],normal:[0,0,1],xDir:[1,0,0]};
const base=[{id:'rule',type:'sheetMetal',label:'Chapa',thickness:2},{id:'base',type:'face',label:'Face',plane,profile:{kind:'rect',x1:0,y1:0,x2:30,y2:40}},{id:'bend',type:'flange',label:'Flange',parentId:'base',edgeStart:[30,40,2],edgeEnd:[0,40,2],length:12,angle:90}];
let serial=0;const id=()=>`s${++serial}`;
test('editing a Face sketch moves the flange to the resized boundary rather than leaving it inside the sheet',async()=>{
 await require('./kernel.cjs')();const result=editOperationSketch(base,'base',id);
 const corner=result.sketch.shapes[0].p2;
 const replacement={...result.sketch,points:{...result.sketch.points,[corner]:{...result.sketch.points[corner],x:50,y:60}}};
 const updated=updateSketchWithDependents(result.features,replacement);
 const bend=updated.find(f=>f.id==='bend');assert.deepEqual(bend.edgeStart,[50,60,2]);assert.deepEqual(bend.edgeEnd,[0,60,2]);
 const solid=rebuildModel(updated);try{assert.ok(solid.mesh().triangles.length);}finally{solid.delete();}
 assert.deepEqual(base.at(-1).edgeStart,[30,40,2]);
});
test('topology replacement requires repair instead of silently reattaching a bend to a different edge',async()=>{
 await require('./kernel.cjs')();const result=editOperationSketch(base,'base',id);
 const corner=result.sketch.shapes[0].p2;
 const replacement={...result.sketch,shapes:result.sketch.shapes.map(s=>({...s,p2:'new'})),points:{...result.sketch.points,new:{...result.sketch.points[corner],id:'new',x:50,y:60}}};
 assert.throws(()=>updateSketchWithDependents(result.features,replacement),/topologia/);
});
