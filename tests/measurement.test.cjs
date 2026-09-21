const {test}=require('node:test');
const assert=require('node:assert/strict');
const {measureSelections,closestCircleCenter,closestEdgeEndpoint,closestFaceEdge}=require('../src/lib/replicad/measurement.ts');
test('measure topology faces and edge endpoints with global XYZ components',async()=>{
 await require('./kernel.cjs')();
 const r=require('replicad');
 const solid=r.makeBox([0,0,0],[20,30,40]);
 const faces=solid.faces;
 const faceAt=(axis,value)=>faces.find(f=>{const c=f.center;const yes=Math.abs(c.toTuple()[axis]-value)<1e-6;c.delete();return yes;});
 const selection=f=>({kind:'face',faceId:f.hashCode});
 try {
  const left=selection(faceAt(0,0)),right=selection(faceAt(0,20));
  const edge=closestFaceEdge(solid,right.faceId,[20,0,15]);
  assert.equal(edge.kind,'edge');
  assert.equal(measureSelections(solid,left,edge).angleDegrees,null);
  const mixed=measureSelections(solid,left,edge);
  assert.ok(Math.abs(mixed.distance-20)<1e-6);
  assert.ok(Math.abs(mixed.delta[0]-20)<1e-6);
  assert.ok(Math.abs(measureSelections(solid,edge,left).delta[0]+20)<1e-6);
  const oppositeEdge=closestFaceEdge(solid,left.faceId,[0,0,15]);
  assert.ok(Math.abs(measureSelections(solid,edge,oppositeEdge).distance-20)<1e-6);
  assert.throws(()=>measureSelections(solid,edge,edge),/arestas diferentes/);
  const result=measureSelections(solid,left,right);
  assert.ok(Math.abs(result.distance-20)<1e-6);
  assert.ok(Math.abs(result.angleDegrees)<1e-6);
  assert.ok(Math.abs(measureSelections(solid,left,selection(faceAt(1,0))).angleDegrees-90)<1e-6);
  assert.ok(Math.abs(result.delta[0]-20)<1e-6);
  assert.ok(Math.abs(result.delta[1])<1e-6&&Math.abs(result.delta[2])<1e-6);
  assert.ok(measureSelections(solid,left,selection(faceAt(1,0))).distance<1e-6);
  assert.throws(()=>measureSelections(solid,left,left),/diferentes/);
  assert.throws(()=>measureSelections(solid,left,{kind:'face',faceId:-1}),/geometria mudou/);
  const start=closestEdgeEndpoint(solid,left.faceId,[0,1,1]);
  const end=closestEdgeEndpoint(solid,right.faceId,[20,29,39]);
  assert.deepEqual(start.point,[0,0,0]);assert.deepEqual(end.point,[20,30,40]);
  const diagonal=measureSelections(solid,start,end);
  assert.deepEqual(diagonal.delta,[20,30,40]);
  assert.ok(Math.abs(diagonal.distance-Math.hypot(20,30,40))<1e-6);
  assert.ok(Math.abs(measureSelections(solid,start,right).distance-20)<1e-6);
  const clone=solid.clone();
  try {assert.ok(Math.abs(measureSelections(clone,left,right).distance-20)<1e-6);}finally{clone.delete();}
 } finally {faces.forEach(f=>f.delete());solid.delete();}
 const cylinder=r.makeCylinder(5,10);const cylinderFaces=cylinder.faces;
 try {
  const cap=cylinderFaces.find(f=>f.geomType==='PLANE');
  const curved=cylinderFaces.find(f=>f.geomType!=='PLANE');
  assert.equal(measureSelections(cylinder,selection(cap),selection(curved)).angleDegrees,null);
  assert.throws(()=>closestEdgeEndpoint(cylinder,cap.hashCode,[0,0,0]),/extremidades/);
  const circular=closestFaceEdge(cylinder,cap.hashCode,[0,0,0]);
  assert.equal(circular.kind,'edge');
  assert.ok(measureSelections(cylinder,{kind:'face',faceId:cap.hashCode},circular).distance<1e-6);
 } finally {cylinderFaces.forEach(f=>f.delete());cylinder.delete();}
 const box=r.makeBox([0,0,0],[10,10,10]);
 const tilted=r.makeBox([0,0,0],[10,10,10]).rotate(30,[0,0,0],[0,0,1]).translate([30,0,0]);
 const compound=r.makeCompound([box,tilted]);const angledFaces=compound.faces;
 try {
  const vertical=angledFaces.find(f=>{const n=f.normalAt();try{return Math.abs(n.x-1)<1e-6;}finally{n.delete();}});
  const inclined=angledFaces.find(f=>{const n=f.normalAt();try{return Math.abs(n.x-Math.cos(Math.PI/6))<1e-6&&Math.abs(n.y-0.5)<1e-6;}finally{n.delete();}});
  assert.ok(Math.abs(measureSelections(compound,selection(vertical),selection(inclined)).angleDegrees-30)<1e-6);
  assert.ok(Math.abs(measureSelections(compound,selection(inclined),selection(vertical)).angleDegrees-30)<1e-6);
 } finally {angledFaces.forEach(f=>f.delete());compound.delete();}
 const stock=r.makeBox([0,0,0],[40,30,10]);
 const cutter=r.makeCylinder(3,10,[20,15,0]);
 const drilled=stock.cut(cutter);stock.delete();cutter.delete();
 const holeFaces=drilled.faces;
 try {
  const wall=holeFaces.find(f=>f.geomType!=='PLANE');
  const circle=closestCircleCenter(drilled,wall.hashCode,[23,15,0]);
  assert.equal(circle.kind,'circle');assert.ok(Math.abs(circle.radius-3)<1e-6);
  assert.ok(Math.hypot(...circle.point.map((v,i)=>v-[20,15,0][i]))<1e-6);
  const side=holeFaces.find(f=>{const c=f.center;try{return Math.abs(c.x)<1e-6;}finally{c.delete();}});
  const measured=measureSelections(drilled,circle,selection(side));
  assert.ok(Math.abs(measured.distance-20)<1e-6);
  assert.ok(Math.abs(measured.delta[0]+20)<1e-6);
  assert.ok(Math.abs(measureSelections(drilled,selection(side),circle).distance-20)<1e-6);
  assert.throws(()=>closestCircleCenter(drilled,side.hashCode,[0,0,0]),/Nenhuma aresta circular/);
  // Near a rim, fallback can recover the circle even if a neighboring face was hit.
  const nearby=closestCircleCenter(drilled,side.hashCode,[23.05,15,0]);
  assert.equal(nearby.kind,'circle');assert.ok(Math.abs(nearby.radius-3)<1e-6);
  assert.ok(Math.hypot(...nearby.point.map((v,i)=>v-[20,15,0][i]))<1e-6);
 } finally {holeFaces.forEach(f=>f.delete());drilled.delete();}
});
