const {test}=require('node:test');const assert=require('node:assert/strict');
const {reconstructFaceSketch}=require('../src/lib/replicad/reconstructSketch.ts');
const {findProfileSources,profileToDrawing,extrudeProfile}=require('../src/lib/replicad/geometry.ts');
const {serializeProject,parseProject}=require('../src/lib/project/nativeFormat.ts');
const {useFeatureStore:features}=require('../src/lib/features/store.ts');
const {undoModel,redoModel,useUndoStore:history}=require('../src/lib/history/store.ts');
let serial=0;const id=()=>`reconstructed-${++serial}`;

test('STEP face reconstructs a closed sketch with measured reference dimensions, native persistence and undo',async()=>{
 await require('./kernel.cjs')();const r=require('replicad');
 const box=r.makeBox([0,0,0],[10,20,30]);const step=await r.importSTEP(box.blobSTEP());box.delete();
 try{
  const sketch=reconstructFaceSketch(step,[5,10,30],[0,0,1],id);
  assert.equal(sketch.shapes.length,4);assert.equal(Object.keys(sketch.points).length,4);
  assert.equal(sketch.dimensions.length,4);assert.ok(sketch.dimensions.every(d=>d.isReference));
  const restored=parseProject(serializeProject([sketch])).features[0];
  const profiles=findProfileSources(restored.shapes,restored.points,[]);
  assert.equal(profiles.length,1);
  const rebuilt=extrudeProfile(profileToDrawing(profiles[0]),30,{...restored.plane,origin:[...restored.plane.origin.slice(0,2),0]});
  assert.ok(Math.abs(r.measureVolume(rebuilt)-6000)<1e-5);rebuilt.delete();
  features.getState().clear();await new Promise(queueMicrotask);history.setState({past:[],future:[]});
  features.getState().addFeature(restored);undoModel();assert.equal(features.getState().features.length,0);
  redoModel();assert.equal(features.getState().features[0].dimensions.length,4);
 }finally{step.delete();}
});

test('face reconstruction retains a circular hole analytically and rejects curved faces',async()=>{
 await require('./kernel.cjs')();const r=require('replicad');
 const box=r.makeBox([0,0,0],[20,20,10]);const hole=r.drawCircle(2).sketchOnPlane('XY',[10,10,0]).extrude(10);
 const body=box.cut(hole);box.delete();hole.delete();
 try{
  const sketch=reconstructFaceSketch(body,[3,3,10],[0,0,1],id);
  assert.equal(sketch.shapes.filter(s=>s.type==='line').length,4);
  const circle=sketch.shapes.find(s=>s.type==='circle');assert.ok(circle);
  assert.ok(Math.abs(circle.radius-2)<1e-7);assert.ok(sketch.points[circle.center]);
  assert.ok(sketch.dimensions.some(d=>d.kind==='radius'&&d.isDiameter&&d.isReference));
  assert.throws(()=>reconstructFaceSketch(body,[12,10,5],[-1,0,0],id),/face plana/);
  assert.ok(Math.abs(r.measureVolume(body)-(4000-40*Math.PI))<1e-5);
 }finally{body.delete();}
});

test('face selection distinguishes coplanar bodies and supports an inclined planar face',async()=>{
 await require('./kernel.cjs')();const r=require('replicad');
 const compound=r.makeCompound([r.makeBox([0,0,0],[10,10,10]),r.makeBox([20,0,0],[40,10,10])]);
 try{
  const sketch=reconstructFaceSketch(compound,[25,5,10],[0,0,1],id);
  const lengths=sketch.shapes.map(s=>Math.hypot(sketch.points[s.p1].x-sketch.points[s.p2].x,sketch.points[s.p1].y-sketch.points[s.p2].y)).sort((a,b)=>a-b);
  assert.deepEqual(lengths,[10,10,20,20]);
 }finally{compound.delete();}
 const rotated=r.makeBox([0,0,0],[10,20,30]).rotate(45,[0,0,0],[1,0,0]);
 try{
  const q=Math.SQRT1_2;const sketch=reconstructFaceSketch(rotated,[5,-20*q,40*q],[0,-q,q],id);
  assert.equal(sketch.shapes.length,4);assert.ok(Math.abs(sketch.plane.normal[1]+q)<1e-7);
 }finally{rotated.delete();}
});


test('rounded edges remain exact arcs, unsupported elliptical contours fail without changing the solid',async()=>{
 await require('./kernel.cjs')();const r=require('replicad');
 const rounded=r.drawRoundedRectangle(20,10,2).sketchOnPlane('XY').extrude(5);
 try{
  const sketch=reconstructFaceSketch(rounded,[0,0,5],[0,0,1],id);
  assert.equal(sketch.shapes.filter(s=>s.type==='line').length,4);
  assert.ok(sketch.shapes.some(s=>s.type==='arc'));
  const profiles=findProfileSources(sketch.shapes,sketch.points,[]);
  assert.equal(profiles.length,1);
  const rebuilt=extrudeProfile(profileToDrawing(profiles[0]),5,sketch.plane);
  assert.ok(Math.abs(r.measureVolume(rebuilt)-r.measureVolume(rounded))<1e-5);rebuilt.delete();
 }finally{rounded.delete();}
 const ellipse=r.drawEllipse(10,5).sketchOnPlane('XY').extrude(5);
 try{
  assert.throws(()=>reconstructFaceSketch(ellipse,[0,0,5],[0,0,1],id),/ELLIPSE/);
  assert.ok(Math.abs(r.measureVolume(ellipse)-250*Math.PI)<1e-4);
 }finally{ellipse.delete();}
});
